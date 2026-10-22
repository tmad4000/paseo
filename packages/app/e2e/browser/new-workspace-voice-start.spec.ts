import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  openNewWorkspaceComposer,
  selectWorkspaceIsolation,
} from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

// pspin-woh: a brand-new session must be able to start voice before any message is sent.
// The New workspace screen is the phone's new-session path; its composer used to offer no voice
// control until a typed first message had created the agent.

type WebSocketMessage = string | Buffer;
interface Envelope {
  type?: unknown;
  message?: Record<string, unknown>;
}

const CREATE_FAILURE = "Synthetic workspace creation failure";
const NEW_WORKSPACE_PATH = /\/new(?:\?.*)?$/;

function parseEnvelope(message: WebSocketMessage): Envelope | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(raw) as Envelope;
  } catch {
    return null;
  }
}

function sessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseEnvelope(message);
  return envelope?.type === "session" && envelope.message ? envelope.message : null;
}

function sendSessionMessage(
  ws: { send(message: string): void },
  message: Record<string, unknown>,
): void {
  ws.send(JSON.stringify({ type: "session", message }));
}

/** Advertise host voice so the voice button starts Paseo voice; GPT realtime stays off. */
function enableVoiceCapability(message: WebSocketMessage): WebSocketMessage {
  const envelope = parseEnvelope(message);
  const payload = envelope?.message?.payload as Record<string, unknown> | undefined;
  if (envelope?.message?.type !== "status" || payload?.status !== "server_info") {
    return message;
  }
  payload.capabilities = {
    voice: {
      dictation: { enabled: true, reason: "" },
      voice: { enabled: true, reason: "" },
    },
  };
  return JSON.stringify(envelope);
}

function createdAgentId(message: Record<string, unknown>): string | null {
  const payload = message.payload as Record<string, unknown> | undefined;
  if (!payload) return null;
  const agent = payload.agent as { id?: unknown } | undefined;
  if (typeof agent?.id === "string") return agent.id;
  const creation = payload.creation as { agentId?: unknown } | undefined;
  if (typeof creation?.agentId === "string") return creation.agentId;
  return typeof payload.agentId === "string" ? payload.agentId : null;
}

async function installSyntheticMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        return destination.stream;
      },
    });
  });
}

interface VoiceStartRecord {
  agentId: unknown;
  enabled: unknown;
  /** Page URL when the host received the request: proves whether the create screen had left. */
  url: string;
}

/** The seed client types only id/archivedAt; the host returns the full agent snapshot. */
interface AgentTurnFacts {
  id: string;
  status?: string;
  lastUserMessageAt?: string | null;
}

interface CreateRequestRecord {
  /** The wire request carries the initial agent itself; there is no separate flag. */
  hasAgent: boolean;
  initialPrompt: unknown;
  firstAgentPrompt: unknown;
}

/**
 * Proxies the real test daemon, recording the create and voice-start requests. The voice start is
 * acknowledged here so no host recognizer is needed. The final create response is held until the
 * New workspace screen has navigated away, so voice must start after that screen unmounted.
 */
async function installVoiceStartHarness(page: Page, options: { failCreate: boolean }) {
  const createRequests: CreateRequestRecord[] = [];
  const voiceStarts: VoiceStartRecord[] = [];
  const createdAgentIds: string[] = [];
  let heldCreateResponse: { send: () => void } | null = null;
  let createResponseReleasedAfterNavigation = false;

  const releaseHeldResponse = () => {
    const held = heldCreateResponse;
    heldCreateResponse = null;
    held?.send();
  };

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const request = sessionMessage(message);
      const type = request?.type;

      if (request && type === "workspace.create.request") {
        const agent = request.agent as { initialPrompt?: unknown } | undefined;
        const firstAgentContext = request.firstAgentContext as { prompt?: unknown } | undefined;
        createRequests.push({
          hasAgent: agent !== undefined,
          initialPrompt: agent?.initialPrompt,
          firstAgentPrompt: firstAgentContext?.prompt,
        });
        if (options.failCreate && typeof request.requestId === "string") {
          sendSessionMessage(ws, {
            type: "workspace.create.response",
            payload: {
              requestId: request.requestId,
              workspace: null,
              setupTerminalId: null,
              error: CREATE_FAILURE,
            },
          });
          return;
        }
      }

      if (request && type === "set_voice_mode") {
        voiceStarts.push({ agentId: request.agentId, enabled: request.enabled, url: page.url() });
        if (typeof request.requestId === "string") {
          sendSessionMessage(ws, {
            type: "set_voice_mode_response",
            payload: {
              requestId: request.requestId,
              enabled: request.enabled === true,
              agentId: typeof request.agentId === "string" ? request.agentId : null,
              accepted: true,
              error: null,
            },
          });
        }
        return;
      }
      // Voice is acknowledged locally, so its audio has nowhere to go on the real host.
      if (type === "voice_audio_chunk") return;

      server.send(message);
    });

    server.onMessage((message) => {
      const response = sessionMessage(message);
      if (response) {
        const type = response.type;
        if (
          typeof type === "string" &&
          (type === "workspace.create.response" ||
            type === "workspace.create.update" ||
            type === "creation.subscribe.response")
        ) {
          const agentId = createdAgentId(response);
          if (agentId && !createdAgentIds.includes(agentId)) createdAgentIds.push(agentId);
        }
        if (type === "workspace.create.response" && !options.failCreate) {
          const forwarded = enableVoiceCapability(message);
          heldCreateResponse = { send: () => ws.send(forwarded) };
          return;
        }
      }
      ws.send(enableVoiceCapability(message));
    });
  });

  return {
    createRequests,
    voiceStarts,
    createdAgentIds,
    hasHeldCreateResponse: () => heldCreateResponse !== null,
    /** Releases the held create response once the app has left the New workspace screen. */
    releaseCreateResponseAfterNavigation: async () => {
      await page.waitForURL((url) => url.pathname.includes("/workspace/"), { timeout: 60_000 });
      createResponseReleasedAfterNavigation = heldCreateResponse !== null;
      releaseHeldResponse();
    },
    releaseCreateResponse: releaseHeldResponse,
    wasReleasedAfterNavigation: () => createResponseReleasedAfterNavigation,
  };
}

async function openEmptyNewWorkspace(
  page: Page,
  seeded: { projectKey: string; projectDisplayName: string },
) {
  await gotoAppShell(page);
  await waitForSidebarHydration(page);
  await openNewWorkspaceComposer(page, seeded);
  await selectWorkspaceIsolation(page, "local");
  const composer = page.getByRole("textbox", { name: "Message agent..." });
  await expect(composer).toBeEditable({ timeout: 30_000 });
  await expect(composer).toHaveValue("");
}

test.describe("New workspace voice start before the first message", () => {
  test.describe.configure({ timeout: 240_000 });

  test("creates a no-prompt agent, survives leaving the screen, then starts voice on it", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "new-workspace-voice-" });
    await installSyntheticMicrophone(page);
    const harness = await installVoiceStartHarness(page, { failCreate: false });

    try {
      await openEmptyNewWorkspace(page, seeded);

      const voiceButton = page.getByRole("button", { name: "Enable Voice mode" });
      await expect(voiceButton).toBeVisible({ timeout: 30_000 });
      await voiceButton.click();

      await expect.poll(() => harness.createRequests.length, { timeout: 60_000 }).toBe(1);
      expect(harness.createRequests[0].hasAgent).toBe(true);
      expect(harness.createRequests[0].initialPrompt ?? "").toBe("");
      expect(harness.createRequests[0].firstAgentPrompt ?? "").toBe("");

      // Voice must not start until the agent exists, and must still start after the create
      // screen has been replaced by the new workspace.
      expect(harness.voiceStarts).toHaveLength(0);
      await harness.releaseCreateResponseAfterNavigation();

      await expect.poll(() => harness.voiceStarts.length, { timeout: 60_000 }).toBeGreaterThan(0);
      const [voiceStart] = harness.voiceStarts;
      expect(voiceStart.enabled).toBe(true);
      expect(harness.createdAgentIds).toContain(voiceStart.agentId);
      expect(voiceStart.url).toMatch(/\/workspace\//);
      expect(voiceStart.url).not.toMatch(NEW_WORKSPACE_PATH);

      // The host created the agent without a prompt, so it has no user turn.
      const agentId = voiceStart.agentId as string;
      const fetchSnapshot = async () =>
        ((await seeded.client.fetchAgent({ agentId }))?.agent ?? null) as AgentTurnFacts | null;
      await expect.poll(async () => (await fetchSnapshot())?.id ?? null).toBe(agentId);
      const snapshot = await fetchSnapshot();
      expect(snapshot?.status).not.toBe("running");
      expect(snapshot?.lastUserMessageAt ?? null).toBeNull();
    } finally {
      harness.releaseCreateResponse();
      await seeded.cleanup();
    }
  });

  test("does not start voice when creating the session fails", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "new-workspace-voice-fail-" });
    await installSyntheticMicrophone(page);
    const harness = await installVoiceStartHarness(page, { failCreate: true });

    try {
      await openEmptyNewWorkspace(page, seeded);

      const voiceButton = page.getByRole("button", { name: "Enable Voice mode" });
      await expect(voiceButton).toBeVisible({ timeout: 30_000 });
      await voiceButton.click();

      await expect.poll(() => harness.createRequests.length, { timeout: 60_000 }).toBe(1);
      await expect(page.getByText(CREATE_FAILURE).first()).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(NEW_WORKSPACE_PATH);
      // The failed session offers voice again, and nothing tried to start voice on it.
      await expect(voiceButton).toBeVisible({ timeout: 30_000 });
      expect(harness.voiceStarts).toHaveLength(0);
    } finally {
      await seeded.cleanup();
    }
  });
});
