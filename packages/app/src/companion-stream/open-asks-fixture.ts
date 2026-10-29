import type { CompanionEntry, TrackedAskInput } from "@getpaseo/protocol/companion-stream";

/**
 * An orchestration chat's Stream, shaped like the one that prompted the Open asks section
 * (2026-10-29): 20 unresolved asks, 3 of them phrased as questions, 6 blocked on the user, most
 * delegated to child chats, and source messages recorded as prose rather than message ids.
 * Wording is paraphrased; no private links or values.
 */
export interface OpenAskFixture {
  id: string;
  text: string;
  timestamp: string;
  ask: TrackedAskInput;
}

/** Delegated owners, by slot; tests and the e2e spec map slots to real chats. */
export const OPEN_ASK_FIXTURE_OWNERS = ["release", "builder", "designer", "homepage"] as const;
export type OpenAskFixtureOwner = (typeof OPEN_ASK_FIXTURE_OWNERS)[number];

interface Row {
  id: string;
  text: string;
  minute: number;
  state: TrackedAskInput["state"];
  remaining: string;
  owner?: OpenAskFixtureOwner;
  sourceMessageId?: string;
}

const PROSE_SOURCE = "user message 2026-10-29 (no message id exposed)";

const ROWS: Row[] = [
  {
    id: "asc-agreements",
    text: "Accept the pending paid-app agreements; make the connector app a proper TestFlight app.",
    minute: 38,
    state: "in_progress",
    remaining:
      "Accept the agreement in the browser, screenshots before and after.\nThen ship build 2.",
    owner: "release",
  },
  {
    id: "enforce-expiry",
    text: "Feed Enforce the expiries and deadlines we already know about, and ticket the rest.",
    minute: 37,
    state: "in_progress",
    remaining: "Collector for build, domain and certificate expiry, scheduled daily.",
  },
  {
    id: "enforce-versions",
    text: "Save screenshots of every Enforce version; add create and edit with sync back.",
    minute: 26,
    state: "in_progress",
    remaining: "Versions index with screenshots, then create and edit on web and iOS.",
    owner: "builder",
  },
  {
    id: "enforce-notify",
    text: "Enforce settings should offer several ways to notify and escalate.",
    minute: 25,
    state: "blocked",
    remaining:
      "Jacob decides the four open items in the notifications doc (push key, texts, thread target, quiet hours).\nAll channels stay in dry run until then.",
    owner: "builder",
  },
  {
    id: "enforce-noos",
    text: "Keep a standalone Enforce and a Noos-connected one for now.",
    minute: 19,
    state: "blocked",
    remaining: "Jacob approves the mirror's agent key so it can push changes itself.",
    owner: "builder",
  },
  {
    id: "link-superseded",
    text: "Link superseded projects to their successors, on the homepage and in the graph.",
    minute: 14,
    state: "in_progress",
    remaining: "Nest the older project under its successor; list candidate pairs.",
    owner: "homepage",
  },
  {
    id: "enforce-design",
    text: "Propose mobile-first interface directions for Enforce.",
    minute: 3,
    state: "blocked",
    remaining: "Jacob picks a direction or annotates the mockups; then the builder implements it.",
    owner: "designer",
  },
  {
    id: "two-versions",
    text: "Two Bloomscroll versions, standalone and hosted, each with its own landing page.",
    minute: -8,
    state: "in_progress",
    remaining: "Quiet hosted link on the standalone homepage, plus an honest pre-launch landing.",
    owner: "homepage",
  },
  {
    id: "control-rename",
    text: "Explain Control and its open question; give the custom interface a better name.",
    minute: -29,
    state: "in_progress",
    remaining: "Rename the record and display name; record the archive answer in the docs.",
    owner: "release",
  },
  {
    id: "laptop-update",
    text: "Handle the two laptop approval prompts and make sure the laptop gets the update too.",
    minute: -29,
    state: "in_progress",
    remaining:
      "Install the beta on the laptop when no agent turn is running, then a version receipt.",
    owner: "release",
    // Recorded with a real message id: the row jumps to it when Chat has it loaded.
    sourceMessageId: "fixture-user-message-1",
  },
  {
    id: "project-graph",
    text: "Track the web of all projects as a real graph, and choose which go on the homepage.",
    minute: -29,
    state: "blocked",
    remaining:
      "Jacob renames the list, confirms the daily-use set, and picks overlay or core nodes.",
    owner: "homepage",
  },
  {
    id: "testflight-sweep",
    text: "Cut TestFlight releases for every app that should have one.",
    minute: -29,
    state: "in_progress",
    remaining: "Vision build 53 and WIT build 3; Jacob accepts invites on device.",
    owner: "release",
  },
  {
    id: "offramp-handoff",
    text: "Hand the quick-references shelf to a Claude session.",
    minute: -51,
    state: "in_progress",
    remaining: "Upload 0.3.0 (5) to internal TestFlight; on-device checks still unverified.",
    owner: "builder",
  },
  {
    id: "floating-pane",
    text: "Find the floating open-questions pane; why can't Jacob pop it up, and where is it?",
    minute: -51,
    state: "in_progress",
    remaining: "Cut over the host, then screenshot the pane.",
    owner: "release",
  },
  {
    id: "hosted-feasibility",
    text: "How would a hosted Bloomscroll work, and how far are we from it on GCP?",
    minute: -70,
    state: "blocked",
    remaining: "Jacob reviews the design PR and answers its open questions.",
    owner: "designer",
  },
  {
    id: "homepage-clustering",
    text: "Organize the homepage projects: versions nested under the main one, status badges.",
    minute: -70,
    state: "in_progress",
    remaining:
      "Make the approved list public; trial tags and badges with before and after screenshots.",
    owner: "homepage",
  },
  {
    id: "landing-domain",
    text: "Serve the Bloomscroll landing on its own ideaflow.app subdomain.",
    minute: -70,
    state: "in_progress",
    remaining: "Custom domain plus an explicit DNS record; keep the old URL working.",
    owner: "homepage",
  },
  {
    id: "homepage-setup",
    text: "Does Bloomscroll have a public homepage and a way for other people to set it up yet?",
    minute: -1200,
    state: "in_progress",
    remaining: "Refresh the public download and setup copy, then verify from the laptop.",
    owner: "homepage",
  },
  {
    id: "status-next",
    text: "Bloomscroll status check: where are we, are we stuck, what's next — and make progress.",
    minute: -1201,
    state: "blocked",
    remaining: "The shelf's owner hit its usage limit; Jacob decides: wait, or hand it over.",
  },
  {
    id: "weekly-digest",
    text: "Draft the weekly digest of shipped work for the team.",
    minute: -1210,
    state: "open",
    remaining: "",
  },
];

/** Asks for set_ask, in creation order. */
export function openAskFixture(
  owners: Partial<Record<OpenAskFixtureOwner, string>> = {},
): OpenAskFixture[] {
  return ROWS.map((row) => ({
    id: row.id,
    text: row.text,
    timestamp: new Date(Date.UTC(2026, 9, 29, 9, 0) + row.minute * 60_000).toISOString(),
    ask: {
      state: row.state,
      remaining: row.remaining,
      evidence: "",
      sourceMessageId: row.sourceMessageId ?? PROSE_SOURCE,
      ...(row.owner && owners[row.owner] ? { delegatedAgentId: owners[row.owner] } : {}),
    },
  }));
}

/** The same asks as Stream entries, as the host projects them onto the chat. */
export function openAskFixtureEntries(
  owners: Partial<Record<OpenAskFixtureOwner, string>> = {},
): CompanionEntry[] {
  return openAskFixture(owners).map((item) => ({
    id: `ask:${item.id}`,
    kind: "question",
    status: "open",
    timestamp: item.timestamp,
    text: item.text,
    truncated: false,
    ask: { ...item.ask, revision: 1, provenance: "explicit" },
  }));
}

interface FollowUpRow {
  id: string;
  text: string;
  minute: number;
  state: TrackedAskInput["state"];
  remaining: string;
  delegated?: boolean;
  subtasks?: { id: string; text: string; done: boolean }[];
}

/**
 * A chat flagged for follow-up, shaped like a second real one (2026-10-29): 20 asks, half done,
 * 7 blocked on the user (2 phrased as questions), 3 in progress with subtasks, few delegated, and
 * no recorded source messages. The pane shows 2 questions and 8 open asks, 5 of them blocked.
 */
const FOLLOW_UP_ROWS: FollowUpRow[] = [
  {
    id: "connector-tools",
    text: "Wiki tools: a separate connector, or tools on the central connector.",
    minute: 81,
    state: "blocked",
    remaining: "Jacob's go to build the tools into the central connector; then move the wiki.",
  },
  {
    id: "drive-api",
    text: "Does the recorder need a desktop sync app, or can it use the storage API?",
    minute: 81,
    state: "blocked",
    remaining: "Needs Jacob's go: create an OAuth client, set it on the server, one consent.",
  },
  {
    id: "desktop-sync",
    text: "Save recordings into a synced folder on the laptop if the recorder is open source.",
    minute: -2800,
    state: "blocked",
    remaining: "The sync app needs Jacob's admin password and sign-in, and his OK on its version.",
  },
  {
    id: "connector-status",
    text: "Where are we on landing the unified connector?",
    minute: -3092,
    state: "blocked",
    remaining: "Jacob decides whether to add private graph tools to the connector.",
  },
  {
    id: "fanout-dashboard",
    text: "Fan this linear chat out into its parallel threads so Jacob can reply per thread.",
    minute: -3092,
    state: "in_progress",
    remaining: "Jacob reviews v1 and replies per thread. Next: read live from Stream.",
  },
  {
    id: "wiki-main-account",
    text: "Move the wiki saves to the main account and save to the graph as admin.",
    minute: -3100,
    state: "blocked",
    remaining: "Needs two API keys from Jacob, or his approval of the browser executor.",
  },
  {
    id: "save-dialogue",
    text: "Save the deep dialogue chat in the mock, the personal wiki and the graph.",
    minute: -3163,
    state: "blocked",
    remaining: "Graph save blocked on the same credential.",
    subtasks: [
      { id: "wiki", text: "Save to the wiki", done: true },
      { id: "mock", text: "Add to the mock", done: true },
      { id: "graph", text: "Save to the graph", done: false },
    ],
  },
  {
    id: "save-research",
    text: "Save the screen-recording research as a rabbit hole in the mock, wiki and graph.",
    minute: -3163,
    state: "blocked",
    remaining: "Graph save: the stored password is rejected; needs a personal API key.",
    subtasks: [
      { id: "wiki", text: "Save to the wiki", done: true },
      { id: "mock", text: "Add to the mock", done: true },
      { id: "graph", text: "Save to the graph", done: false },
    ],
  },
  {
    id: "realistic-graph",
    text: "Add a realistic graph of the company's ideas and product feedback to v4.",
    minute: -3184,
    state: "in_progress",
    remaining: "Jacob reviews the new screen; apply feedback.",
    subtasks: [
      { id: "data", text: "Graph data for both datasets", done: true },
      { id: "review", text: "Jacob reviews", done: false },
    ],
  },
  {
    id: "full-vision",
    text: "Show the full product vision for the team exo-memory, all screens and user stories.",
    minute: -3228,
    state: "in_progress",
    remaining: "Jacob reviews v4 and gives feedback.",
    delegated: true,
  },
  ...[
    "Confirm an independent review of the current mock exists.",
    "Scheme to flag a chat as needing follow-up.",
    "Move the abundance dialogue near the top of the gallery.",
    "Put the summary and highlights at the top of the dialogue page.",
    "Install the connector that has the private graph tools.",
    "What's a direct desktop alternative with more generous free hosting?",
    "Improve the dialogue reader: formatting, deep links, highlights.",
    "Capture the user story: save every deep research rabbit hole.",
    "Check that the v3 mock link works.",
    "Open the latest team exo-memory mock.",
  ].map(
    (text, index): FollowUpRow => ({
      id: `done-${index + 1}`,
      text,
      minute: 90 - index * 400,
      state: "done",
      remaining: "",
      delegated: index % 3 === 0,
    }),
  ),
];

/** The follow-up chat's asks as Stream entries; `owner` is the chat delegated asks went to. */
export function followUpChatFixtureEntries(owner = "agent-owner"): CompanionEntry[] {
  return FOLLOW_UP_ROWS.map((row) => ({
    id: `ask:${row.id}`,
    kind: "question",
    status: row.state === "done" ? "done" : "open",
    timestamp: new Date(Date.UTC(2026, 9, 29, 9, 0) + row.minute * 60_000).toISOString(),
    text: row.text,
    truncated: false,
    ask: {
      state: row.state,
      remaining: row.remaining,
      evidence: "",
      ...(row.delegated ? { delegatedAgentId: owner } : {}),
      ...(row.subtasks ? { subtasks: row.subtasks } : {}),
      revision: 1,
      provenance: "explicit",
    },
  }));
}
