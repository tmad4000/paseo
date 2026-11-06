import type { StreamItem } from "@/types/stream";

/**
 * A chat shaped like the voice-assistant design chat that prompted the Links track
 * (2026-10-30): two Lavish mocks first printed by `lavish-axi` inside Bash results and then cited
 * in prose, a pull request the agent mentions, and a reference the user pasted. Unit tests use the
 * rows; the browser e2e feeds the same pieces to the mock provider, with the Lavish base pointed at
 * a page the test serves.
 */
export const CHAT_LINKS_LAVISH_BASE = "https://m4-mini.tailb2a35c.ts.net:4387";

export interface ChatLinksFixture {
  prompt: string;
  shellCalls: Array<{ command: string; output: string }>;
  response: string;
  urls: { lavishFirst: string; lavishSecond: string; pr: string; pasted: string };
}

export function chatLinksFixture(lavishBase: string = CHAT_LINKS_LAVISH_BASE): ChatLinksFixture {
  const urls = {
    lavishFirst: `${lavishBase}/session/87a7631b888a80c2`,
    lavishSecond: `${lavishBase}/session/7baafb9992833011`,
    pr: "https://github.com/tmad4000/paseo/pull/154",
    pasted: "https://linear.app/method/introduction",
  };
  return {
    prompt: `Mock up the voice assistant settings. Keep it in the spirit of ${urls.pasted}`,
    shellCalls: [
      {
        command: "lavish-axi .lavish/voice-settings-calm.html",
        output: `file: .lavish/voice-settings-calm.html\nstatus: open\nurl: ${urls.lavishFirst}\n`,
      },
      {
        command: "lavish-axi .lavish/voice-settings-dense.html",
        output: `file: .lavish/voice-settings-dense.html\nstatus: open\nurl: ${urls.lavishSecond}\n`,
      },
    ],
    response: [
      `Review the interactive mock: ${urls.lavishFirst}`,
      `A denser direction for comparison: ${urls.lavishSecond}`,
      `The settings scaffold is up as [PR #154](${urls.pr}).`,
    ].join("\n\n"),
    urls,
  };
}

export const CHAT_LINKS_FIXTURE_URLS = chatLinksFixture().urls;

/** The fixture as the client's timeline rows: prompt, two Bash calls, then the reply. */
export function chatLinksFixtureRows(lavishBase?: string): StreamItem[] {
  const fixture = chatLinksFixture(lavishBase);
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 30, 15, minute));
  return [
    { kind: "user_message", id: "fixture-user", text: fixture.prompt, timestamp: at(0) },
    ...fixture.shellCalls.map(
      (call, index): StreamItem => ({
        kind: "tool_call",
        id: `fixture-bash-${index}`,
        timestamp: at(index + 1),
        payload: {
          source: "agent",
          data: {
            provider: "claude",
            callId: `fixture-bash-${index}`,
            name: "Bash",
            status: "completed",
            error: null,
            detail: { type: "shell", command: call.command, output: call.output, exitCode: 0 },
          },
        },
      }),
    ),
    { kind: "assistant_message", id: "fixture-reply", text: fixture.response, timestamp: at(4) },
  ];
}
