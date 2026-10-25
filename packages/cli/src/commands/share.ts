import { Command } from "commander";
import {
  DEFAULT_REDACTION,
  type RedactionProfile,
  type ShareRecordPayload,
} from "@getpaseo/protocol/sharing";
import { connectToDaemon, resolveAgentId } from "../utils/client.js";
import { addJsonAndDaemonHostOptions } from "../utils/command-options.js";
import { withOutput, type CommandOptions, type OutputSchema } from "../output/index.js";

export function parseShareExpiry(value: string, now = Date.now()): string | null {
  if (value === "never") return null;
  const durations: Record<string, number> = {
    "24h": 86400000,
    "7d": 7 * 86400000,
    "30d": 30 * 86400000,
  };
  const duration = durations[value];
  if (!duration) throw new Error("Expiry must be never, 24h, 7d or 30d");
  return new Date(now + duration).toISOString();
}
export function parseShareRedaction(include = "", noScrub = ""): RedactionProfile {
  const profile = structuredClone(DEFAULT_REDACTION);
  for (const value of include.split(",").filter(Boolean)) {
    if (value === "tool-calls") profile.include.toolCalls = true;
    else if (value === "reasoning" || value === "errors") profile.include[value] = true;
    else throw new Error(`Unknown inclusion: ${value}`);
  }
  for (const value of noScrub.split(",").filter(Boolean)) {
    if (value !== "secrets" && value !== "hosts" && value !== "paths" && value !== "contacts")
      throw new Error(`Unknown scrubber: ${value}`);
    profile.scrub[value] = false;
  }
  return profile;
}
const schema: OutputSchema<ShareRecordPayload> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id" },
    { header: "TITLE", field: "title" },
    { header: "EXPIRES", field: "expiresAt" },
    { header: "REVOKED", field: "revokedAt" },
    { header: "VIEWS", field: "viewCount" },
  ],
};
type ShareClient = Awaited<ReturnType<typeof connectToDaemon>>;
async function withShareClient<T>(
  options: CommandOptions,
  operation: (client: ShareClient) => Promise<T>,
): Promise<T> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    // COMPAT(conversationSharingCli): fork v0.10.0-beta.17, remove after 2027-04-24.
    if (client.getLastServerInfoMessage()?.features?.conversationSharing !== true)
      throw new Error("Update the host to share conversations.");
    return await operation(client);
  } finally {
    await client.close();
  }
}
async function resolveAgent(client: ShareClient, input: string): Promise<string> {
  const payload = await client.fetchAgents({ filter: { includeArchived: true } });
  const id = resolveAgentId(
    input,
    payload.entries.map((entry) => entry.agent),
  );
  if (!id) throw new Error(`Agent not found: ${input}`);
  return id;
}
export function createShareCommand(): Command {
  const share = new Command("share").description("Create and manage read-only snapshot links");
  addJsonAndDaemonHostOptions(
    share
      .command("create")
      .argument("<agent>")
      .option("--expires <duration>", "never, 24h, 7d or 30d", "7d")
      .option("--include <items>", "tool-calls,reasoning,errors")
      .option("--no-scrub <items>", "secrets,hosts,paths,contacts")
      .option("--title <title>"),
  ).action(
    withOutput<Awaited<ReturnType<ShareClient["createShareLink"]>>, [string]>(
      async (
        agent: string,
        options: CommandOptions & {
          expires?: string;
          include?: string;
          scrub?: string | boolean;
          title?: string;
        },
        _command: Command,
      ) =>
        withShareClient(options, async (client) => {
          const result = await client.createShareLink({
            agentId: await resolveAgent(client, agent),
            title: options.title,
            expiresAt: parseShareExpiry(options.expires ?? "7d"),
            redaction: parseShareRedaction(
              options.include,
              typeof options.scrub === "string" ? options.scrub : "",
            ),
          });
          return {
            type: "single" as const,
            data: result,
            schema: {
              idField: "url" as const,
              columns: [{ header: "URL", field: "url" as const }],
              renderHuman: () => result.url,
            },
          };
        }),
    ),
  );
  addJsonAndDaemonHostOptions(share.command("ls").argument("[agent]")).action(
    withOutput<ShareRecordPayload, [string | undefined]>(
      async (agent: string | undefined, options: CommandOptions, _command: Command) =>
        withShareClient(options, async (client) => ({
          type: "list" as const,
          data: await client.listShareLinks(agent ? await resolveAgent(client, agent) : undefined),
          schema,
        })),
    ),
  );
  addJsonAndDaemonHostOptions(share.command("preview").argument("<agent>")).action(
    withOutput(async (agent: string, options: CommandOptions, _command: Command) =>
      withShareClient(options, async (client) => {
        const snapshot = await client.previewShareLink(await resolveAgent(client, agent));
        return {
          type: "single" as const,
          data: snapshot,
          schema: {
            idField: "title" as const,
            columns: [],
            renderHuman: () =>
              snapshot.messages
                .map((message) =>
                  message.kind === "omitted"
                    ? `[${message.count} ${message.reason} hidden]`
                    : message.text,
                )
                .join("\n\n"),
          },
        };
      }),
    ),
  );
  addJsonAndDaemonHostOptions(share.command("revoke").argument("<share-id>")).action(
    withOutput(async (id: string, options: CommandOptions, _command: Command) =>
      withShareClient(options, async (client) => ({
        type: "single" as const,
        data: await client.revokeShareLink(id),
        schema,
      })),
    ),
  );
  addJsonAndDaemonHostOptions(share.command("delete").argument("<share-id>")).action(
    withOutput(async (id: string, options: CommandOptions, _command: Command) =>
      withShareClient(options, async (client) => {
        await client.deleteShareLink(id);
        return {
          type: "single" as const,
          data: { id, deleted: true },
          schema: {
            idField: "id" as const,
            columns: [{ header: "DELETED", field: "id" as const }],
          },
        };
      }),
    ),
  );
  return share;
}
