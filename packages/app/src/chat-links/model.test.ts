import { describe, expect, it } from "vitest";
import {
  extractChatLinks,
  findUrls,
  groupChatLinks,
  normalizeLinkKey,
  shortLinkLabel,
  trimUrlPunctuation,
} from "./model";
import { chatLinksFixtureRows, CHAT_LINKS_FIXTURE_URLS } from "./fixture";
import type { StreamItem } from "@/types/stream";

const AT = new Date("2026-10-30T12:00:00Z");

function user(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: AT };
}
function agent(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: AT };
}
function shell(id: string, command: string, output: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: AT,
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "Bash",
        status: "completed",
        error: null,
        detail: { type: "shell", command, output, exitCode: 0 },
      },
    },
  };
}

describe("findUrls", () => {
  it("captures a markdown label and leaves the bare form unlabeled", () => {
    expect(findUrls("See [the mock](https://example.com/mock) for details")).toEqual([
      { url: "https://example.com/mock", label: "the mock", context: "See for details" },
    ]);
    expect(findUrls("Deployed to https://example.org/x today")).toEqual([
      { url: "https://example.org/x", label: null, context: "Deployed to today" },
    ]);
  });

  it("strips trailing sentence punctuation and unbalanced parens", () => {
    expect(
      findUrls("Open https://example.com/a. Then (https://example.com/b), done").map((f) => f.url),
    ).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(trimUrlPunctuation("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
    expect(trimUrlPunctuation('https://example.com/x";:')).toBe("https://example.com/x");
  });

  it("keeps a balanced paren inside a markdown destination", () => {
    expect(findUrls("[Foo](https://en.wikipedia.org/wiki/Foo_(bar))")[0]?.url).toBe(
      "https://en.wikipedia.org/wiki/Foo_(bar)",
    );
  });

  it("ignores CSS url() and data URIs", () => {
    expect(findUrls("background: url(https://cdn.example.com/bg.png);")).toEqual([]);
    expect(findUrls('src="data:image/svg+xml,<svg xmlns=http://www.w3.org/2000/svg>"')).toEqual([]);
  });

  it("only extracts http and https", () => {
    expect(findUrls("ftp://example.com and mailto:a@b.c and file:///tmp/x")).toEqual([]);
  });
});

describe("normalizeLinkKey and labels", () => {
  it("lowercases scheme and host and trims one trailing slash, leaving the path alone", () => {
    expect(normalizeLinkKey("HTTPS://Example.COM/Path/")).toBe("https://example.com/Path");
    expect(normalizeLinkKey("https://example.com/a?q=B#Frag")).toBe(
      "https://example.com/a?q=B#Frag",
    );
  });

  it("shortens long hosts and path segments", () => {
    expect(shortLinkLabel("https://m4-mini.tailb2a35c.ts.net:4387/session/87a7631b888a80c2")).toBe(
      "m4-mini…:4387/session/87a7…",
    );
    expect(shortLinkLabel("https://github.com/tmad4000/paseo/pull/153")).toBe(
      "github.com/tmad4000/paseo/pull/153",
    );
  });
});

describe("extractChatLinks", () => {
  it("dedupes by key, counts occurrences, and decides origin by the first one", () => {
    const links = extractChatLinks([
      shell(
        "t1",
        "lavish-axi mock.html",
        "session: http://m4-mini.tailb2a35c.ts.net:4387/session/87a7631b888a80c2 (open)",
      ),
      agent(
        "a1",
        "Review the interactive mock: http://m4-mini.tailb2a35c.ts.net:4387/session/87a7631b888a80c2",
      ),
      agent("a2", "Again: HTTP://M4-MINI.tailb2a35c.ts.net:4387/session/87a7631b888a80c2/"),
    ]);
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.origin).toBe("produced");
    expect(link.count).toBe(3);
    expect(link.firstSeen.itemId).toBe("t1");
    expect(link.lastSeen.itemId).toBe("a2");
    // The first prose mention gives the readable context and is where Jump lands.
    expect(link.anchor.itemId).toBe("a1");
    expect(link.context).toBe("Review the interactive mock:");
    expect(link.label).toBe("m4-mini…:4387/session/87a7…");
  });

  it("reads a gh pr create output line as produced", () => {
    const [link] = extractChatLinks([
      shell(
        "t1",
        'gh pr create --title "Links track"',
        "Creating pull request for feat/chat-links-pane into main\n\nhttps://github.com/tmad4000/paseo/pull/154\n",
      ),
    ]);
    expect(link?.origin).toBe("produced");
    expect(link?.url).toBe("https://github.com/tmad4000/paseo/pull/154");
    // The URL is alone on its line, so the command stands in for context.
    expect(link?.context).toBe('gh pr create --title "Links track"');
  });

  it("marks a user-pasted URL as yours and takes a later markdown label", () => {
    const [link] = extractChatLinks([
      user("u1", "Compare with https://linear.app/method"),
      agent("a1", "The [Linear method page](https://linear.app/method) argues for it."),
    ]);
    expect(link?.origin).toBe("you");
    expect(link?.label).toBe("Linear method page");
    expect(link?.context).toBe("Compare with");
  });

  it("skips reasoning rows and file bodies", () => {
    const links = extractChatLinks([
      {
        kind: "thought",
        id: "r1",
        text: "https://example.com/thinking",
        timestamp: AT,
        status: "ready",
      },
      {
        kind: "tool_call",
        id: "f1",
        timestamp: AT,
        payload: {
          source: "agent",
          data: {
            provider: "claude",
            callId: "f1",
            name: "Read",
            status: "completed",
            error: null,
            detail: { type: "read", filePath: "/tmp/a.md", content: "https://example.com/file" },
          },
        },
      },
    ]);
    expect(links).toEqual([]);
  });

  it("groups produced, agent, then you, newest first within each", () => {
    const sections = groupChatLinks(extractChatLinks(chatLinksFixtureRows()));
    expect(sections.map((section) => section.origin)).toEqual(["produced", "agent", "you"]);
    expect(sections[0]?.links.map((link) => link.url)).toEqual([
      CHAT_LINKS_FIXTURE_URLS.lavishSecond,
      CHAT_LINKS_FIXTURE_URLS.lavishFirst,
    ]);
    expect(sections[1]?.links.map((link) => link.url)).toEqual([CHAT_LINKS_FIXTURE_URLS.pr]);
    expect(sections[2]?.links.map((link) => link.url)).toEqual([CHAT_LINKS_FIXTURE_URLS.pasted]);
  });
});
