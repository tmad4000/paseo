import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runOpenTabCommand } from "./open-tab.js";

export function createUiCommand(): Command {
  const ui = new Command("ui").description("Drive the Paseo app UI from outside it");

  addJsonAndDaemonHostOptions(
    ui
      .command("open-tab")
      .description("Open a tab in a workspace view on every attached app client")
      .requiredOption("--workspace <id>", "Workspace ID, unambiguous ID prefix, or exact name")
      .option("--agent <id>", "Open an agent tab")
      .option("--subagent <id>", "Open a provider subagent tab (requires --subagent-of)")
      .option("--subagent-of <id>", "Parent agent ID for --subagent")
      .option("--terminal <id>", "Open a terminal tab")
      .option("--browser <id>", "Open a browser tab")
      .option("--file <path>", "Open a file tab")
      .option("--line <n>", "Line to focus when used with --file")
      .option("--diff", "Open the working diff tab")
      .option("--commit <sha>", "Open a commit diff tab")
      .option("--setup", "Open the workspace setup tab")
      .option("--draft", "Open a new draft tab")
      .option("--no-focus", "Open the tab without focusing it or navigating to the workspace"),
  ).action(withOutput(runOpenTabCommand));

  return ui;
}
