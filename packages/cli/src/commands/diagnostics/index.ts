import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runDiagnosticsErrorsCommand } from "./errors.js";

export function createDiagnosticsCommand(): Command {
  const diagnostics = new Command("diagnostics").description(
    "Read errors devices reported to this host and host-side voice failures",
  );

  addJsonAndDaemonHostOptions(
    diagnostics
      .command("errors")
      .description("List reported client errors and GPT Realtime failures, newest first")
      .option("--limit <n>", "Most diagnostics to show (default 50, max 1000)")
      .option("--since <when>", "Only since a time: 30m, 2h, 1d or an ISO timestamp")
      .option("--source <source>", "toast, voice, rpc, global or host-voice"),
  ).action(withOutput(runDiagnosticsErrorsCommand));

  return diagnostics;
}
