// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { chatLinksFixtureRows, CHAT_LINKS_FIXTURE_URLS } from "./fixture";
import { extractChatLinks, normalizeLinkKey, type ChatLink } from "./model";
import type { ChatLinkActions } from "./track";

vi.mock("react-native", () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles: () => () => null,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: i18n.t.bind(i18n) }),
}));
vi.mock("lucide-react-native", () => ({ History: () => null, Link2: () => null }));
vi.mock("@/components/ui/menu", () => ({
  useMenuContext: () => ({ selectItem: (fn?: () => void) => fn?.() }),
}));
// A button inside a row must not also press the row, as on the real platforms.
function MockButton({
  children,
  onPress,
  disabled,
  testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const handleClick = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onPress?.();
    },
    [onPress],
  );
  return (
    <button type="button" data-testid={testID} disabled={disabled} onClick={handleClick}>
      {children}
    </button>
  );
}

function MockTrackRow({
  children,
  onPress,
  testID,
  disabled,
}: {
  children: React.ReactNode | ((state: { active: boolean }) => React.ReactNode);
  onPress?: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  const handleClick = React.useCallback(() => {
    if (!disabled) onPress?.();
  }, [disabled, onPress]);
  return (
    <div role="button" data-testid={testID} aria-disabled={disabled} onClick={handleClick}>
      {typeof children === "function" ? children({ active: false }) : children}
    </div>
  );
}

vi.mock("@/components/ui/button", () => ({ Button: MockButton }));
vi.mock("@/composer/tracks", () => ({
  ComposerTrackPill: ({
    children,
    testID,
    segments,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    testID: string;
    segments: Array<{ text: string }>;
    accessibilityLabel?: string;
  }) => (
    <div data-testid={testID} aria-label={accessibilityLabel}>
      <span data-testid={`${testID}-text`}>
        {segments.map((segment) => segment.text).join(" ")}
      </span>
      {children}
    </div>
  ),
  ComposerTrackRow: MockTrackRow,
}));
vi.mock("./peek", () => ({
  LinkPeek: ({ link }: { link: ChatLink | null }) =>
    link ? <div data-testid="peek-open">{link.url}</div> : null,
}));

const { ChatLinksTrack } = await import("./track");

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

function makeActions(overrides: Partial<ChatLinkActions> = {}): ChatLinkActions {
  return {
    open: vi.fn(),
    copy: vi.fn(),
    jump: vi.fn(),
    canJump: () => true,
    ...overrides,
  };
}

function rowFor(url: string) {
  return screen.getByTestId(`chat-link-row-${normalizeLinkKey(url)}`);
}

const LOAD_OLDER = vi.fn();
const PARTIAL_HISTORY = { hasOlder: true, isLoadingOlder: false, loadOlder: LOAD_OLDER };
const FULL_HISTORY = { hasOlder: false, isLoadingOlder: false, loadOlder: LOAD_OLDER };

describe("ChatLinksTrack", () => {
  const links = extractChatLinks(chatLinksFixtureRows());

  it("renders nothing for a chat with no links", () => {
    const { container } = render(<ChatLinksTrack links={[]} actions={makeActions()} />);
    expect(container.innerHTML).toBe("");
  });

  it("counts links in the pill and spells the count out", () => {
    render(<ChatLinksTrack links={links} actions={makeActions()} />);
    expect(screen.getByTestId("chat-links-track-header-text").textContent).toBe("4 links");
    expect(screen.getByTestId("chat-links-track-header").getAttribute("aria-label")).toBe(
      "4 links in this chat",
    );
  });

  it("groups produced, agent, then you, newest first, with counted headers", () => {
    render(<ChatLinksTrack links={links} actions={makeActions()} />);
    const sections = screen.getAllByTestId(/^chat-links-section-/);
    expect(sections.map((section) => section.dataset.testid)).toEqual([
      "chat-links-section-produced",
      "chat-links-section-agent",
      "chat-links-section-you",
    ]);
    const produced = sections[0]!;
    expect(within(produced).getByText("Produced by this chat · 2")).toBeTruthy();
    const producedRows = within(produced).getAllByTestId(/^chat-link-row-/);
    expect(producedRows[0]?.dataset.testid).toBe(
      `chat-link-row-${normalizeLinkKey(CHAT_LINKS_FIXTURE_URLS.lavishSecond)}`,
    );
    expect(within(sections[1]!).getByText("Mentioned by the agent · 1")).toBeTruthy();
    expect(within(sections[2]!).getByText("You shared · 1")).toBeTruthy();
  });

  it("shows the row's label, context line and host", () => {
    render(<ChatLinksTrack links={links} actions={makeActions()} />);
    const row = rowFor(CHAT_LINKS_FIXTURE_URLS.lavishFirst);
    expect(within(row).getByText("m4-mini…:4387/session/87a7…")).toBeTruthy();
    expect(within(row).getByText("Review the interactive mock:")).toBeTruthy();
    expect(within(row).getByText("m4-mini.tailb2a35c.ts.net:4387")).toBeTruthy();
    expect(within(rowFor(CHAT_LINKS_FIXTURE_URLS.pr)).getByText("PR #154")).toBeTruthy();
  });

  it("hides section headers when only one section has rows", () => {
    const produced = links.filter((link) => link.origin === "produced");
    render(<ChatLinksTrack links={produced} actions={makeActions()} />);
    expect(screen.queryByText(/Produced by this chat/)).toBeNull();
    expect(screen.getAllByTestId(/^chat-link-row-/)).toHaveLength(2);
  });

  it("peeks on row press and runs the row actions", () => {
    const actions = makeActions();
    render(<ChatLinksTrack links={links} actions={actions} />);
    const row = rowFor(CHAT_LINKS_FIXTURE_URLS.pr);
    fireEvent.click(row);
    expect(screen.getByTestId("peek-open").textContent).toBe(CHAT_LINKS_FIXTURE_URLS.pr);

    fireEvent.click(within(row).getByTestId("chat-link-open"));
    expect(actions.open).toHaveBeenCalledWith(
      expect.objectContaining({ url: CHAT_LINKS_FIXTURE_URLS.pr }),
    );
    fireEvent.click(within(row).getByTestId("chat-link-copy"));
    expect(actions.copy).toHaveBeenCalledTimes(1);
    expect(within(row).getByTestId("chat-link-copy").textContent).toBe("Copied");
    fireEvent.click(within(row).getByTestId("chat-link-jump"));
    expect(actions.jump).toHaveBeenCalledWith(
      expect.objectContaining({ anchor: expect.objectContaining({ itemId: "fixture-reply" }) }),
    );
  });

  it("disables Jump when the anchor row is not loaded", () => {
    render(<ChatLinksTrack links={links} actions={makeActions({ canJump: () => false })} />);
    const jump = within(rowFor(CHAT_LINKS_FIXTURE_URLS.pasted)).getByTestId(
      "chat-link-jump",
    ) as HTMLButtonElement;
    expect(jump.disabled).toBe(true);
  });

  it("says when earlier messages are not loaded and loads them on request", () => {
    const { rerender } = render(
      <ChatLinksTrack links={links} actions={makeActions()} history={PARTIAL_HISTORY} />,
    );
    const footer = screen.getByTestId("chat-links-load-earlier");
    expect(within(footer).getByText("Earlier messages not loaded")).toBeTruthy();
    fireEvent.click(footer);
    expect(LOAD_OLDER).toHaveBeenCalledTimes(1);

    rerender(<ChatLinksTrack links={links} actions={makeActions()} history={FULL_HISTORY} />);
    expect(screen.queryByTestId("chat-links-load-earlier")).toBeNull();
  });
});
