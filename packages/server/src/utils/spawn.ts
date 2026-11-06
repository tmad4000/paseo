import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readdirSync } from "node:fs";
import { extname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { createExternalCommandProcessEnv, type ProcessEnvRecord } from "../server/paseo-env.js";
import {
  isWindowsCommandScript,
  quoteWindowsArgument,
  quoteWindowsCommand,
} from "./windows-command.js";

const execFileAsync = promisify(execFile);

interface ExternalEnvOptions {
  baseEnv?: ProcessEnvRecord;
  envMode?: "external" | "internal";
  env?: ProcessEnvRecord;
  envOverlay?: ProcessEnvRecord;
}

export type SpawnProcessOptions = Omit<SpawnOptions, "env"> & ExternalEnvOptions;

interface ExecCommandOptions extends ExternalEnvOptions {
  cwd?: string;
  encoding?: BufferEncoding;
  killSignal?: NodeJS.Signals;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean | string;
  signal?: AbortSignal;
}

interface ExecCommandResult {
  stdout: string;
  stderr: string;
}

/**
 * Node raises RLIMIT_NOFILE far above macOS OPEN_MAX (10240), but posix_spawn's
 * file actions reject any descriptor >= OPEN_MAX with EBADF. When the process
 * briefly holds more than ~10k descriptors, every spawn then fails with
 * `spawn EBADF` (instead of EMFILE) until the burst drains.
 */
const MACOS_SPAWN_OPEN_MAX = 10240;
const DESCRIPTOR_PRESSURE_CODES = new Set(["EBADF", "EMFILE", "ENFILE"]);
export const SPAWN_DESCRIPTOR_RETRY_DELAYS_MS = [250, 1000, 3000] as const;

/** A spawn that never started because the descriptor table was exhausted. */
export class SpawnDescriptorPressureError extends Error {
  readonly code: string;
  readonly errno: number | undefined;
  readonly syscall: string;
  readonly openDescriptors: number | null;

  constructor(cause: NodeJS.ErrnoException, command: string) {
    const openDescriptors = countOpenDescriptors();
    const count = openDescriptors === null ? "unknown" : String(openDescriptors);
    super(
      `spawn ${cause.code} for ${command}: the process has too many open file descriptors ` +
        `(${count} open; macOS posix_spawn rejects descriptors >= ${MACOS_SPAWN_OPEN_MAX}). ` +
        "The child was not started.",
      { cause },
    );
    this.name = "SpawnDescriptorPressureError";
    this.code = cause.code ?? "EBADF";
    this.errno = cause.errno;
    this.syscall = cause.syscall ?? "spawn";
    this.openDescriptors = openDescriptors;
  }
}

function countOpenDescriptors(): number | null {
  try {
    return readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
  } catch {
    return null;
  }
}

function isSpawnErrno(error: unknown): error is NodeJS.ErrnoException {
  if (!(error instanceof Error) || !("code" in error)) return false;
  const { code, syscall } = error as NodeJS.ErrnoException;
  return (
    typeof code === "string" &&
    DESCRIPTOR_PRESSURE_CODES.has(code) &&
    typeof syscall === "string" &&
    syscall.startsWith("spawn")
  );
}

export function isSpawnDescriptorPressureError(error: unknown): boolean {
  return error instanceof SpawnDescriptorPressureError || isSpawnErrno(error);
}

/**
 * Retries work whose child process never started because of a transient
 * descriptor burst. Safe for any command: nothing ran, so nothing repeats.
 */
export async function retryOnSpawnDescriptorPressure<T>(
  run: () => Promise<T>,
  delaysMs: readonly number[] = SPAWN_DESCRIPTOR_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const wait = delaysMs[attempt];
      if (wait === undefined || !isSpawnDescriptorPressureError(error)) throw error;
      await delay(wait);
    }
  }
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function shouldUseWindowsShell(
  command: string,
  requestedShell?: boolean | string,
): boolean | string {
  if (isWindowsCommandScript(command)) {
    return true;
  }
  if (requestedShell !== undefined) {
    return requestedShell;
  }
  return process.platform === "win32" && !hasPathSeparator(command) && !extname(command);
}

export function spawnProcess(
  command: string,
  args: string[],
  options?: SpawnProcessOptions,
): ChildProcess {
  const { baseEnv, env, envOverlay, ...spawnOptions } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const isWindows = process.platform === "win32";
  const shell = shouldUseWindowsShell(command, spawnOptions.shell);

  const shouldQuoteForShell = isWindows && shell !== false;
  const resolvedCommand = shouldQuoteForShell ? quoteWindowsCommand(command) : command;
  const resolvedArgs = shouldQuoteForShell ? args.map(quoteWindowsArgument) : args;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );

  try {
    return spawn(resolvedCommand, resolvedArgs, {
      ...spawnOptions,
      env: childEnv,
      shell,
      signal: options?.signal,
      windowsHide: true,
    });
  } catch (error) {
    if (isSpawnErrno(error)) throw new SpawnDescriptorPressureError(error, command);
    throw error;
  }
}

export async function execCommand(
  command: string,
  args: string[],
  options?: ExecCommandOptions,
): Promise<ExecCommandResult> {
  const { baseEnv, env, envOverlay } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const isWindows = process.platform === "win32";
  const shell = shouldUseWindowsShell(command, options?.shell);
  const shouldQuoteForShell = isWindows && shell !== false;
  const resolvedCommand = shouldQuoteForShell ? quoteWindowsCommand(command) : command;
  const resolvedArgs = shouldQuoteForShell ? args.map(quoteWindowsArgument) : args;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );

  const run = async () => {
    try {
      return (await execFileAsync(resolvedCommand, resolvedArgs, {
        cwd: options?.cwd,
        env: childEnv,
        encoding: options?.encoding ?? "utf8",
        killSignal: options?.killSignal,
        timeout: options?.timeout,
        maxBuffer: options?.maxBuffer,
        shell,
        windowsHide: true,
      })) as ExecCommandResult;
    } catch (error) {
      if (isSpawnErrno(error)) throw new SpawnDescriptorPressureError(error, command);
      throw error;
    }
  };
  return retryOnSpawnDescriptorPressure(run);
}
