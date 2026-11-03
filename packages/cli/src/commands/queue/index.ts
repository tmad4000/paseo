import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runQueueLsCommand } from "./ls.js";
import {
  runQueueClearCommand,
  runQueueDrainCommand,
  runQueueRemoveCommand,
  runQueueSendNowCommand,
} from "./actions.js";

export function createQueueCommand(): Command {
  const queue = new Command("queue").description(
    "Inspect and manage message delivery: host queue, deliveries, and device-reported unsent messages",
  );

  addJsonAndDaemonHostOptions(
    queue
      .command("ls")
      .description("Show what waits on the host, what was delivered, and what devices still hold")
      .argument("<agent>", "Agent ID (or prefix)")
      .option("--limit <n>", "Rows per delivered/receipt section (default 10)"),
  ).action(withOutput(runQueueLsCommand));

  addJsonAndDaemonHostOptions(
    queue
      .command("drain")
      .description(
        "Deliver queued messages now if the agent is idle (head now, the rest one per turn)",
      )
      .argument("<agent>", "Agent ID (or prefix)"),
  ).action(withOutput(runQueueDrainCommand));

  addJsonAndDaemonHostOptions(
    queue
      .command("send-now")
      .description("Send one queued message immediately, steering it into an active turn")
      .argument("<agent>", "Agent ID (or prefix)")
      .argument("<item>", "Queued item ID (see: paseo queue ls)"),
  ).action(withOutput(runQueueSendNowCommand));

  addJsonAndDaemonHostOptions(
    queue
      .command("rm")
      .description("Remove one queued message without sending it")
      .argument("<agent>", "Agent ID (or prefix)")
      .argument("<item>", "Queued item ID (see: paseo queue ls)"),
  ).action(withOutput(runQueueRemoveCommand));

  addJsonAndDaemonHostOptions(
    queue
      .command("clear")
      .description("Remove every queued message without sending (items being submitted stay)")
      .argument("<agent>", "Agent ID (or prefix)"),
  ).action(withOutput(runQueueClearCommand));

  return queue;
}
