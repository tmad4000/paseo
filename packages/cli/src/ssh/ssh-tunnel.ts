import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import { buildSshTunnelArgs, type SshTransportTarget } from "@getpaseo/protocol/ssh-transport";

const SSH_STDERR_LIMIT = 8192;
/** Upper bound on how long a graceful close waits for the forwarded connection to finish. */
export const SSH_TUNNEL_CLOSE_GRACE_MS = 2000;

export interface SshTunnel {
  endpoint: string;
  /** Tear the tunnel down immediately, discarding anything still in flight. */
  close(): void;
  /**
   * Let the forwarded connection finish (the WebSocket close handshake travels through
   * ssh), then tear the tunnel down. Killing ssh as soon as the client starts closing
   * drops frames that were written just before the close. Bounded by `graceMs`.
   */
  closeGracefully(graceMs?: number): Promise<void>;
  failureDetail(): string | null;
}

function formatSshFailure(
  stderr: string,
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  const detail = stderr.trim();
  if (detail) return detail;
  if (signal) return `ssh exited with signal ${signal}`;
  return `ssh exited with code ${code ?? "unknown"}`;
}

export function resolveSshFailureDetail(failure: string | null, stderr: string): string | null {
  return failure ?? (stderr.trim() || null);
}

export function createSshTunnel(target: SshTransportTarget): Promise<SshTunnel> {
  let server: Server | null = null;
  let socket: Socket | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let stderr = "";
  let failure: string | null = null;

  function close(): void {
    server?.close();
    server = null;
    socket?.destroy();
    socket = null;
    if (child && !child.killed) child.kill();
    child = null;
  }

  async function closeGracefully(graceMs = SSH_TUNNEL_CLOSE_GRACE_MS): Promise<void> {
    // Wait for ssh itself to exit, not just for the local socket to close: bytes the client
    // wrote last have been handed to ssh's stdin by then but may not have crossed yet, and
    // ssh exits on its own once stdin reaches EOF and everything is forwarded.
    const running = child;
    if (running && running.exitCode === null && running.signalCode === null) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onExit: (() => void) | undefined;
      await Promise.race([
        new Promise<void>((resolve) => {
          onExit = resolve;
          running.once("exit", onExit);
        }),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, graceMs);
        }),
      ]);
      clearTimeout(timer);
      if (onExit) running.off("exit", onExit);
    }
    close();
  }

  return new Promise((resolve, reject) => {
    server = createServer((acceptedSocket) => {
      socket = acceptedSocket;
      server?.close();
      server = null;

      child = spawn("ssh", buildSshTunnelArgs(target), {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-SSH_STDERR_LIMIT);
      });
      child.on("error", (error) => {
        failure = error.message;
        acceptedSocket.destroy(error);
      });
      child.on("exit", (code, signal) => {
        if (code !== 0 || signal) failure = formatSshFailure(stderr, code, signal);
        acceptedSocket.destroy(failure ? new Error(failure) : undefined);
      });
      acceptedSocket.on("error", () => undefined);
      // When the local side closes, let ssh drain what it was already given: the pipe ends
      // its stdin, and ssh exits after forwarding the rest. Kill it only if it lingers.
      const spawned = child;
      acceptedSocket.on("close", () => {
        if (spawned.exitCode !== null || spawned.signalCode !== null) return;
        spawned.stdin.end();
        const lingerTimer = setTimeout(() => {
          if (spawned.exitCode === null && spawned.signalCode === null) spawned.kill();
        }, SSH_TUNNEL_CLOSE_GRACE_MS);
        lingerTimer.unref?.();
        spawned.once("exit", () => clearTimeout(lingerTimer));
      });
      acceptedSocket.pipe(child.stdin);
      child.stdout.pipe(acceptedSocket);
    });
    server.once("error", (error) => {
      close();
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server?.address();
      if (!address || typeof address === "string") {
        close();
        reject(new Error("Failed to allocate the SSH tunnel port"));
        return;
      }
      resolve({
        endpoint: `127.0.0.1:${address.port}`,
        close,
        closeGracefully,
        failureDetail: () => resolveSshFailureDetail(failure, stderr),
      });
    });
  });
}
