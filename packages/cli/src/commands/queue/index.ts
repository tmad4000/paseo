import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runQueueLsCommand } from "./ls.js";

export function createQueueCommand(): Command {
  const queue = new Command("queue").description(
    "Inspect message delivery: host queue, deliveries, and device-reported unsent messages",
  );

  addJsonAndDaemonHostOptions(
    queue
      .command("ls")
      .description("Show what waits on the host, what was delivered, and what devices still hold")
      .argument("<agent>", "Agent ID (or prefix)")
      .option("--limit <n>", "Rows per delivered/receipt section (default 10)"),
  ).action(withOutput(runQueueLsCommand));

  return queue;
}
