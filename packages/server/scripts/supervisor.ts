import { execFile, fork, spawn, type ChildProcess } from "child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  createStream as createRotatingFileStream,
  type RotatingFileStream,
} from "rotating-file-stream";
import { signalProcessTree } from "../src/utils/tree-kill.js";
import {
  createWorkerStallDetector,
  resolveWorkerUnresponsiveRestartMs,
} from "./worker-stall-detector.js";

const WORKER_HEARTBEAT_INTERVAL_MS = 1_000;
const WORKER_TERMINATION_GRACE_MS = 10_000;
const WEDGE_PS_TIMEOUT_MS = 5_000;
const WEDGE_SAMPLE_SECONDS = 2;
const WEDGE_SAMPLE_TIMEOUT_MS = 8_000;

interface SupervisorLogFileOptions {
  path: string;
  rotate: {
    maxSize: string;
    maxFiles: number;
  };
}

type WorkerLifecycleMessage =
  | {
      type: "paseo:shutdown";
      reason?: string;
    }
  | {
      type: "paseo:ready";
      listen: string;
      serverId: string;
    }
  | {
      type: "paseo:restart";
      reason?: string;
    };

interface SupervisorHeartbeatMessage {
  type: "paseo:supervisor-heartbeat";
}

interface WorkerHeartbeatMessage {
  type: "paseo:worker-heartbeat";
}

interface SupervisorGracefulShutdownMessage {
  type: "paseo:graceful-shutdown";
  reason: string;
}

interface SupervisorOptions {
  name: string;
  startupMessage: string;
  resolveWorkerEntry: () => string;
  workerArgs?: string[];
  workerEnv?: NodeJS.ProcessEnv;
  workerExecArgv?: string[];
  resolveWorkerSpawnSpec?: (workerEntry: string) => {
    command: string;
    args: string[];
    env?: NodeJS.ProcessEnv;
  } | null;
  onWorkerReady?: (message: { listen: string; serverId: string }) => Promise<void> | void;
  onWorkerExit?: () => Promise<void> | void;
  restartOnCrash?: boolean;
  onSupervisorExit?: () => Promise<void> | void;
  logFile?: SupervisorLogFileOptions;
  /**
   * How long a ready worker that has been sending heartbeats may stay silent, while
   * the supervisor itself keeps running, before it is treated as wedged and restarted.
   * Defaults to PASEO_WORKER_UNRESPONSIVE_RESTART_MS or five minutes; 0 disables.
   */
  workerUnresponsiveRestartMs?: number;
}

export interface SupervisorController {
  requestShutdown(reason: string): void;
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  return signal ?? (typeof code === "number" ? `code ${code}` : "unknown");
}

function parseLifecycleMessage(msg: unknown): WorkerLifecycleMessage | null {
  if (typeof msg !== "object" || msg === null || !("type" in msg)) {
    return null;
  }
  const type = (msg as { type?: unknown }).type;
  if (type === "paseo:shutdown") {
    const reason = (msg as { reason?: unknown }).reason;
    return {
      type: "paseo:shutdown",
      ...(typeof reason === "string" && reason.trim().length > 0 ? { reason } : {}),
    };
  }
  if (type === "paseo:ready") {
    const { listen, serverId } = msg as { listen?: unknown; serverId?: unknown };
    if (typeof listen !== "string" || listen.trim().length === 0) {
      return null;
    }
    if (typeof serverId !== "string" || serverId.trim().length === 0) {
      return null;
    }
    return { type: "paseo:ready", listen, serverId };
  }
  if (type === "paseo:restart") {
    const reason = (msg as { reason?: unknown }).reason;
    return {
      type: "paseo:restart",
      ...(typeof reason === "string" && reason.trim().length > 0 ? { reason } : {}),
    };
  }
  return null;
}

function isWorkerHeartbeatMessage(msg: unknown): msg is WorkerHeartbeatMessage {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "type" in msg &&
    (msg as { type?: unknown }).type === "paseo:worker-heartbeat"
  );
}

function runBounded(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout ?? ""}${stderr ?? ""}`.trim();
        resolve({ ok: !error, output: error && !output ? error.message : output });
      },
    );
  });
}

// Best-effort evidence for why a worker wedged, captured before it is killed. `ps`
// state shows whether the process was stopped (T) or blocked; on macOS a short
// native `sample` shows which threads and locks were stuck. Never throws.
async function captureWedgedWorkerDiagnostics(
  pid: number,
  diagnosticsDir: string | null,
): Promise<Record<string, unknown>> {
  if (process.platform === "win32") {
    return {};
  }
  const result: Record<string, unknown> = {};
  const ps = await runBounded(
    "ps",
    ["-o", "pid=,ppid=,stat=,etime=,rss=,time=,%cpu=", "-p", String(pid)],
    WEDGE_PS_TIMEOUT_MS,
  );
  result.workerProcessState = ps.output;
  if (
    process.platform === "darwin" &&
    diagnosticsDir &&
    process.env.PASEO_WORKER_WEDGE_SAMPLE !== "0"
  ) {
    try {
      await mkdir(diagnosticsDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const samplePath = path.join(diagnosticsDir, `worker-wedge-${pid}-${stamp}.txt`);
      const sample = await runBounded(
        "/usr/bin/sample",
        [String(pid), String(WEDGE_SAMPLE_SECONDS), "-file", samplePath],
        WEDGE_SAMPLE_TIMEOUT_MS,
      );
      result.nativeSamplePath = sample.ok ? samplePath : null;
      if (!sample.ok) {
        result.nativeSampleError = sample.output.slice(0, 500);
      }
    } catch (error) {
      result.nativeSampleError = error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

function toRotatingFileStreamSize(size: string): string {
  const trimmed = size.trim();
  const match = trimmed.match(/^(\d+)\s*([bBkKmMgG])?$/);
  if (!match) {
    return trimmed;
  }

  const value = match[1];
  const unit = (match[2] ?? "M").toUpperCase();
  return `${value}${unit}`;
}

// daemon.log is best effort: a full disk or a replaced log path must not take the
// supervisor, and with it the worker, down. A failed stream is dropped and a new one
// is opened on the next write, so logging resumes once the file is writable again.
function createDurableLog(
  options: SupervisorLogFileOptions | undefined,
  reportFailure: (message: string) => void,
) {
  let stream: RotatingFileStream | null = null;
  let failing = false;

  const open = (logFile: SupervisorLogFileOptions): RotatingFileStream => {
    const next = createRotatingFileStream(path.basename(logFile.path), {
      path: path.dirname(logFile.path),
      size: toRotatingFileStreamSize(logFile.rotate.maxSize),
      maxFiles: logFile.rotate.maxFiles,
    });
    next.on("error", (error) => {
      if (stream === next) {
        stream = null;
      }
      if (!failing) {
        failing = true;
        reportFailure(
          `Cannot write ${logFile.path}, will retry on the next log line: ${error.message}`,
        );
      }
    });
    return next;
  };

  return {
    write(chunk: string | Buffer): void {
      if (!options) {
        return;
      }
      stream ??= open(options);
      stream.write(chunk, (error) => {
        if (!error) {
          failing = false;
        }
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        if (!stream) {
          resolve();
          return;
        }
        stream.end(() => resolve());
      });
    },
  };
}

export function runSupervisor(options: SupervisorOptions): SupervisorController {
  const restartOnCrash = options.restartOnCrash ?? false;
  const workerArgs = options.workerArgs ?? process.argv.slice(2);
  const workerEnv = options.workerEnv ?? process.env;
  const workerExecArgv = options.workerExecArgv ?? ["--import", "tsx"];
  const resolveWorkerSpawnSpec = options.resolveWorkerSpawnSpec;
  const workerUnresponsiveRestartMs =
    options.workerUnresponsiveRestartMs ?? resolveWorkerUnresponsiveRestartMs(process.env);
  const diagnosticsDir = options.logFile
    ? path.join(path.dirname(options.logFile.path), "diagnostics")
    : null;

  let child: ChildProcess | null = null;
  let restarting = false;
  let shuttingDown = false;
  let exiting = false;
  let lifecycleFailed = false;
  let publication = Promise.resolve();
  let forceKillTimer: NodeJS.Timeout | null = null;
  const durableLog = createDurableLog(options.logFile, (message) => {
    process.stderr.write(`[${options.name}] ${message}\n`);
  });

  const writeDurableChunk = (chunk: string | Buffer): void => {
    durableLog.write(chunk);
  };

  const writeLifecycleLog = (message: string, fields: Record<string, unknown> = {}): void => {
    writeDurableChunk(
      `${JSON.stringify({
        level: "info",
        time: new Date().toISOString(),
        pid: process.pid,
        name: options.name,
        msg: message,
        ...fields,
      })}\n`,
    );
  };

  const log = (message: string): void => {
    process.stderr.write(`[${options.name}] ${message}\n`);
    writeLifecycleLog(message);
  };

  const closeLogStream = (): Promise<void> => durableLog.close();

  const exitSupervisor = (code: number): void => {
    if (exiting) {
      return;
    }
    exiting = true;
    Promise.resolve(options.onSupervisorExit?.())
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        log(`Supervisor exit cleanup failed: ${message}`);
      })
      .then(closeLogStream)
      .finally(() => {
        process.exit(code);
      });
  };

  const clearForceKillTimer = (): void => {
    if (forceKillTimer) {
      clearTimeout(forceKillTimer);
      forceKillTimer = null;
    }
  };

  const scheduleForceKill = (reason: string): void => {
    if (!child) {
      return;
    }
    const currentChild = child;
    clearForceKillTimer();
    forceKillTimer = setTimeout(() => {
      forceKillTimer = null;
      if (child !== currentChild) {
        return;
      }
      writeLifecycleLog(
        "Worker did not exit after graceful shutdown request; forcing process tree kill",
        {
          reason,
          supervisorPid: process.pid,
          workerPid: currentChild.pid ?? null,
        },
      );
      void signalProcessTree(currentChild, "SIGKILL").catch((error) => {
        writeLifecycleLog("Failed to force-kill worker process tree", {
          error: error instanceof Error ? error.message : String(error),
          supervisorPid: process.pid,
          workerPid: currentChild.pid ?? null,
        });
      });
    }, WORKER_TERMINATION_GRACE_MS);
    forceKillTimer.unref();
  };

  const spawnWorker = () => {
    let workerEntry: string;
    try {
      // Resolve at spawn time so restarts pick up current filesystem state.
      workerEntry = options.resolveWorkerEntry();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Failed to resolve worker entry: ${message}`);
      exitSupervisor(1);
      return;
    }

    const spawnSpec = resolveWorkerSpawnSpec?.(workerEntry) ?? null;
    writeLifecycleLog("Spawning worker", { workerEntry });
    if (spawnSpec) {
      child = spawn(spawnSpec.command, spawnSpec.args, {
        stdio: ["inherit", "pipe", "pipe", "ipc"],
        env: spawnSpec.env ?? workerEnv,
      });
    } else {
      child = fork(workerEntry, workerArgs, {
        stdio: ["inherit", "pipe", "pipe", "ipc"],
        env: workerEnv,
        execArgv: workerExecArgv,
      });
    }

    const currentChild = child;
    let reachedReady = false;
    let wedgeHandled = false;
    const stallDetector = createWorkerStallDetector({
      unresponsiveAfterMs: workerUnresponsiveRestartMs,
      monotonicNow: () => performance.now(),
      wallNow: () => Date.now(),
    });
    const checkWorkerLiveness = (): void => {
      if (wedgeHandled || child !== currentChild || restarting || shuttingDown) {
        return;
      }
      const verdict = stallDetector.tick();
      if (!verdict.stalled) {
        return;
      }
      wedgeHandled = true;
      const workerPid = currentChild.pid ?? null;
      const fields = {
        silentForMs: Math.round(verdict.silentForMs),
        lastHeartbeatAgoMs:
          verdict.lastHeartbeatAgoMs === null ? null : Math.round(verdict.lastHeartbeatAgoMs),
        thresholdMs: workerUnresponsiveRestartMs,
        supervisorPid: process.pid,
        workerPid,
      };
      process.stderr.write(
        `[${options.name}] Worker unresponsive for ${Math.round(verdict.silentForMs / 1000)}s while the supervisor stayed responsive. Restarting worker...\n`,
      );
      writeLifecycleLog("Worker unresponsive; restarting wedged worker", fields);
      // Capture runs inside the graceful-shutdown grace period, before the force kill.
      if (workerPid !== null) {
        void (async () => {
          const diagnostics = await captureWedgedWorkerDiagnostics(workerPid, diagnosticsDir);
          writeLifecycleLog("Wedged worker diagnostics", { ...fields, ...diagnostics });
        })();
      }
      requestRestart("worker_unresponsive");
    };
    // Serialize endpoint writes with exit/clear before allowing another worker to spawn.
    const heartbeat = setInterval(() => {
      checkWorkerLiveness();
      const message: SupervisorHeartbeatMessage = { type: "paseo:supervisor-heartbeat" };
      if (currentChild.connected) {
        currentChild.send?.(message, (error) => {
          if (error) {
            writeLifecycleLog("Worker heartbeat IPC send failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      } else {
        writeLifecycleLog("Worker heartbeat skipped because IPC channel is disconnected");
      }
    }, WORKER_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref();

    child.on("disconnect", () => {
      writeLifecycleLog("Worker IPC channel disconnected");
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
      writeDurableChunk(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      writeDurableChunk(chunk);
    });

    child.on("message", (msg: unknown) => {
      if (isWorkerHeartbeatMessage(msg)) {
        if (child === currentChild) {
          stallDetector.recordWorkerHeartbeat();
        }
        return;
      }
      const lifecycleMessage = parseLifecycleMessage(msg);
      if (!lifecycleMessage || child !== currentChild) {
        return;
      }

      if (lifecycleMessage.type === "paseo:ready") {
        reachedReady = true;
        stallDetector.markReady();
        writeLifecycleLog("Worker ready", { listen: lifecycleMessage.listen });
        publication = publication
          .then(() =>
            options.onWorkerReady?.({
              listen: lifecycleMessage.listen,
              serverId: lifecycleMessage.serverId,
            }),
          )
          .catch((error) => {
            lifecycleFailed = true;
            const message = error instanceof Error ? error.message : String(error);
            log(`Worker ready callback failed: ${message}`);
            requestShutdown("endpoint_publication_failed");
          });
        return;
      }

      if (lifecycleMessage.type === "paseo:shutdown") {
        const reason = lifecycleMessage.reason ?? "worker_requested_shutdown";
        writeLifecycleLog("Worker requested shutdown", { reason });
        requestShutdown(reason);
        return;
      }

      const reason = lifecycleMessage.reason ?? "worker_requested_restart";
      writeLifecycleLog("Worker requested restart", { reason });
      requestRestart(reason);
    });

    child.on("error", (error) => {
      lifecycleFailed = true;
      log(`Worker spawn failed: ${error.message}`);
      exitSupervisor(1);
    });

    child.on("exit", (code, signal) => {
      clearInterval(heartbeat);
      clearForceKillTimer();
      child = null;
      publication = publication
        .then(() => options.onWorkerExit?.())
        .catch((error) => {
          lifecycleFailed = true;
          log(`Worker exit callback failed: ${String(error)}`);
        });
      void publication.then(() => {
        const exitDescriptor = describeExit(code, signal);
        writeLifecycleLog("Worker exited", { code, signal, exit: exitDescriptor });

        if (lifecycleFailed || (!reachedReady && !shuttingDown)) {
          log(`Worker exited before successful readiness (${exitDescriptor}). Supervisor exiting.`);
          exitSupervisor(1);
          return;
        }

        if (shuttingDown) {
          log(`Worker exited (${exitDescriptor}). Supervisor shutting down.`);
          exitSupervisor(0);
          return;
        }

        const crashed =
          restartOnCrash &&
          ((code !== 0 && code !== null) || (signal !== null && signal !== "SIGTERM"));

        if (restarting || crashed) {
          restarting = false;
          log(
            crashed
              ? `Worker crashed (${exitDescriptor}). Restarting worker...`
              : `Worker exited (${exitDescriptor}). Restarting worker...`,
          );
          spawnWorker();
          return;
        }

        log(`Worker exited (${exitDescriptor}). Supervisor exiting.`);
        exitSupervisor(typeof code === "number" ? code : 1);
        return;
      });
    });
  };

  const requestWorkerShutdown = (reason: string): void => {
    if (!child) {
      return;
    }
    const currentChild = child;
    const message: SupervisorGracefulShutdownMessage = {
      type: "paseo:graceful-shutdown",
      reason,
    };
    writeLifecycleLog("Supervisor requesting graceful worker shutdown", {
      reason,
      supervisorPid: process.pid,
      workerPid: currentChild.pid ?? null,
    });
    if (!currentChild.connected) {
      writeLifecycleLog("Graceful worker shutdown IPC unavailable", {
        reason,
        supervisorPid: process.pid,
        workerPid: currentChild.pid ?? null,
      });
      return;
    }
    currentChild.send?.(message, (error) => {
      if (error) {
        writeLifecycleLog("Graceful worker shutdown IPC send failed", {
          error: error instanceof Error ? error.message : String(error),
          reason,
          supervisorPid: process.pid,
          workerPid: currentChild.pid ?? null,
        });
      }
    });
  };

  const requestRestart = (reason: string) => {
    if (!child || restarting || shuttingDown) {
      return;
    }
    restarting = true;
    writeLifecycleLog("Restart requested", { reason });
    log(`${reason}. Stopping worker for restart...`);
    requestWorkerShutdown(reason);
    scheduleForceKill(reason);
  };

  const requestShutdown = (reason: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    restarting = false;
    writeLifecycleLog("Supervisor shutdown requested", { reason });
    log(`${reason}. Stopping worker...`);
    if (!child) {
      void publication.then(() => {
        exitSupervisor(lifecycleFailed ? 1 : 0);
        return;
      });
      return;
    }
    requestWorkerShutdown(reason);
    scheduleForceKill(reason);
  };

  const forwardSignal = (signal: NodeJS.Signals) => {
    requestShutdown(`supervisor_received_${signal}`);
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  process.stdout.write(`[${options.name}] ${options.startupMessage}\n`);
  writeLifecycleLog(options.startupMessage);
  spawnWorker();

  return { requestShutdown };
}
