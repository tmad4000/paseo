import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACTION,
  RedactionProfileSchema,
  ShareSnapshotSchema,
  type RedactionProfile,
} from "@getpaseo/protocol/sharing";
import { redactTimeline } from "./redaction.js";

const metadata = {
  title: "Corpus",
  ownerName: "Owner",
  provider: "mock",
  createdAt: "2026-10-24T12:00:00Z",
};
const redact = (text: string, profile: RedactionProfile = DEFAULT_REDACTION) =>
  redactTimeline(
    [{ seq: 1, timestamp: metadata.createdAt, item: { type: "user_message", text } }],
    metadata,
    profile,
  );
const counts = (secrets = 0, hosts = 0, contacts = 0, paths = 0) => ({
  hiddenToolCalls: 0,
  hiddenReasoning: 0,
  secretsMasked: secrets,
  hostsMasked: hosts,
  pathsCollapsed: paths,
  contactsMasked: contacts,
  messagesExcluded: 0,
});
// The nine reported probes use synthetic, complete values where the report abbreviated a token.
const corpus = [
  ["tailnet IPv4", "100.84.242.74", "[ip]", counts(0, 1)],
  ["tailnet hostname", "m4-mini.tailb2a35c.ts.net", "[host]", counts(0, 1)],
  ["public IPv4", "142.249.144.90", "[ip]", counts(0, 1)],
  [
    "Basic header",
    "Authorization: Basic amFjb2I6aHVudGVyMg==",
    "Authorization: Basic [secret hidden]",
    counts(1),
  ],
  [
    "AWS base64 with slashes",
    "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCyEXAMPLEKEY",
    "AWS_SECRET_ACCESS_KEY=[secret hidden]",
    counts(1),
  ],
  [
    "prose password",
    "the wifi password is hunter2",
    "the wifi password is [secret hidden]",
    counts(1),
  ],
  ["sshpass", "sshpass -p 'iPsj-probe-only'", "sshpass -p [secret hidden]", counts(1)],
  ["hyphen phone", "617-555-0199", "[phone]", counts(0, 0, 1)],
  ["parenthesized phone", "(415) 555-0123", "[phone]", counts(0, 0, 1)],
  [
    "postgres accidental email mask",
    "postgres://jacob:Sup3rSecret@db.internal:5432/app",
    "postgres://[credentials]@[host]:5432/app",
    counts(1, 1),
  ],
  [
    "URL username only",
    "https://jacob@github.com/paseo",
    "https://[credentials]@github.com/paseo",
    counts(1),
  ],
  [
    "URL encoded userinfo",
    "https://jacob:p%40ss@localhost:7070/path",
    "https://[credentials]@[host]:7070/path",
    counts(1, 1),
  ],
  ["standalone Basic", "Basic dXNlcjpwYXNz", "Basic [secret hidden]", counts(1)],
  ...[
    "KEY",
    "SECRET",
    "TOKEN",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "api_key",
    "MY_CREDENTIALS",
  ].map((label) => [`label ${label}`, `${label}=small`, `${label}=[secret hidden]`, counts(1)]),
  ["quoted label", 'MY_SECRET: "two words"', "MY_SECRET: [secret hidden]", counts(1)],
  ["single quoted label", "my_token = 'two words'", "my_token = [secret hidden]", counts(1)],
  ...["key", "secret", "token", "password", "auth", "credential"].flatMap((label) => [
    [
      `base64 following ${label}`,
      `${label} nearby abcdefghijklmnop/qrstuvwxyz+012345=`,
      `${label} nearby [secret hidden]`,
      counts(1),
    ],
    [
      `base64 preceding ${label}`,
      `abcdefghijklmnop/qrstuvwxyz+012345= nearby ${label}`,
      `[secret hidden] nearby ${label}`,
      counts(1),
    ],
  ]),
  [
    "nearby run across newline",
    "auth\n0123456789abcdef0123456789abcdef",
    "auth\n[secret hidden]",
    counts(1),
  ],
  [
    "nearby label across newline",
    "0123456789abcdef0123456789abcdef\nauth",
    "[secret hidden]\nauth",
    counts(1),
  ],
  ["flag in parentheses", "(--key hunter2)", "(--key [secret hidden]", counts(1)],

  [
    "32 char hex run",
    "auth nearby 0123456789abcdef0123456789abcdef",
    "auth nearby [secret hidden]",
    counts(1),
  ],
  [
    "20 char gap",
    `auth${" ".repeat(20)}0123456789abcdef0123456789abcdef`,
    `auth${" ".repeat(20)}[secret hidden]`,
    counts(1),
  ],
  ...["password", "passphrase", "passcode", "pin"].flatMap((label) =>
    ["is", "was", ":", "="].map((verb) => [
      `prose ${label} ${verb}`,
      `${label} ${verb} hunter2`,
      `${label} ${verb} [secret hidden]`,
      counts(1),
    ]),
  ),
  ...["-p", "--password", "--token", "--api-key", "--secret", "--key"].flatMap((flag) => [
    [
      `space flag ${flag}`,
      `command ${flag} 'two words'`,
      `command ${flag} [secret hidden]`,
      counts(1),
    ],
    [
      `equals flag ${flag}`,
      `command ${flag}=hunter2`,
      `command ${flag}=[secret hidden]`,
      counts(1),
    ],
    [
      `quoted flag ${flag}`,
      `command ${flag}="two words"`,
      `command ${flag}=[secret hidden]`,
      counts(1),
    ],
  ]),
  ["IPv4 URL with port", "http://127.0.0.1:6767/path", "http://[ip]:6767/path", counts(0, 1)],
  ["IPv4 extrema", "0.0.0.0 255.255.255.255", "[ip] [ip]", counts(0, 2)],
  ["IPv4 sentence punctuation", "Use 192.168.1.1.", "Use [ip].", counts(0, 1)],
  ["IPv6 loopback", "::1", "[ip]", counts(0, 1)],
  ["IPv6 unspecified", "::", "[ip]", counts(0, 1)],
  ["IPv6 expanded", "2001:0db8:0000:0000:0000:ff00:0042:8329", "[ip]", counts(0, 1)],
  ["IPv6 sentence punctuation", "Use 2001:db8::1.", "Use [ip].", counts(0, 1)],
  ["IPv6 compressed", "2001:db8::1", "[ip]", counts(0, 1)],
  ["IPv6 URL with port", "http://[::1]:6767/path", "http://[ip]:6767/path", counts(0, 1)],
  ["IPv6 mapped IPv4", "[::ffff:192.0.2.128]:443", "[ip]:443", counts(0, 1)],
  ...[
    "node.ts.net",
    "foo.local",
    "db.internal",
    "printer.lan",
    "router.home.arpa",
    "node.localdomain",
    "localhost",
    "NODE.LOCAL",
  ].map((host) => [
    `internal hostname ${host}`,
    `http://${host}:7070/path`,
    "http://[host]:7070/path",
    counts(0, 1),
  ]),
  ["hostname sentence punctuation", "Use db.internal.", "Use [host].", counts(0, 1)],
  ["dotted phone", "415.555.0123", "[phone]", counts(0, 0, 1)],
  ["spaced phone", "415 555 0123", "[phone]", counts(0, 0, 1)],
  ["E.164 phone", "+14155550123", "[phone]", counts(0, 0, 1)],
  ["numeric email stays fully hidden", "owner@192.168.1.1", "[email]", counts(0, 0, 1)],
  [
    "URL userinfo with IP",
    "postgres://jacob:Sup3rSecret@127.0.0.1:5432/app",
    "postgres://[credentials]@[ip]:5432/app",
    counts(1, 1),
  ],

  ["internal email stays fully hidden", "owner@db.internal", "[email]", counts(0, 0, 1)],

  ["email", "owner@example.com", "[email]", counts(0, 0, 1)],
  ["path collapse remains idempotent", "/Users/owner/home/x.ts", "…/home/x.ts", counts(0, 0, 0, 1)],
  ["absolute path", "/Users/owner/repo/src/x.ts", "…/src/x.ts", counts(0, 0, 0, 1)],
  ...[
    "0.10.0-beta.16",
    "v1.2.3.4",
    "src/x.y.ts",
    "https://github.com/tmad4000/paseo",
    "see RFC 1918",
    "call 911",
    "14.3.2",
    "ideaflow.app",
    "packages/app/src/x.ts",
    "256.1.2.3",
    "1.2.3.4.5",
    "1.2.3.4-beta",
    "example.local.com",
    "mylocalhost",
    "unlabelled abcdefghijklmnop/qrstuvwxyz+012345=",
    `auth${" ".repeat(21)}0123456789abcdef0123456789abcdef`,
    "[secret hidden] [credentials] [host] [ip] [email] [phone]",
  ].map((text) => [`negative ${text}`, text, text, counts()]),
] as const;

describe("sharing redaction hardening corpus", () => {
  it.each(corpus)("%s (exact text, counters, and idempotence)", (_name, input, output, summary) => {
    const first = redact(input as string);
    expect(first.messages[0]).toMatchObject({ text: output });
    expect(first.redactionSummary).toEqual(summary);
    const second = redact(output as string);
    expect(second.messages).toEqual(first.messages);
    expect(second.redactionSummary).toEqual(counts());
  });
  it("treats omitted hosts as on and explicit false as off", () => {
    const oldProfile = {
      ...DEFAULT_REDACTION,
      scrub: { secrets: true, paths: true, contacts: true },
    };
    expect(RedactionProfileSchema.parse(oldProfile).scrub.hosts).toBeUndefined();
    expect(redact("localhost 100.84.242.74", oldProfile).redactionSummary.hostsMasked).toBe(2);
    const off = redact("localhost 100.84.242.74", {
      ...oldProfile,
      scrub: { ...oldProfile.scrub, hosts: false },
    });
    expect(off.messages[0]).toMatchObject({ text: "localhost 100.84.242.74" });
    expect(off.redactionSummary).toEqual(counts());
    const { hostsMasked: _hosts, ...oldSummary } = off.redactionSummary;
    expect(ShareSnapshotSchema.safeParse({ ...off, redactionSummary: oldSummary }).success).toBe(
      true,
    );
  });
  it("still masks an email's internal domain when contact masking is explicitly off", () => {
    const result = redact("owner@db.internal", {
      ...DEFAULT_REDACTION,
      scrub: { ...DEFAULT_REDACTION.scrub, contacts: false },
    });
    expect(result.messages[0]).toMatchObject({ text: "owner@[host]" });
    expect(result.redactionSummary).toEqual(counts(0, 1));
  });
  it("runs literals before secrets, hosts, paths, contacts, preserving every marker", () => {
    const result = redact(
      "[credentials] [host] [ip] [email] [phone] [secret hidden] jacob:secret localhost /Users/owner/repo/src/x.ts owner@example.com",
      {
        ...DEFAULT_REDACTION,
        extraPatterns: [
          "jacob:secret",
          "secret hidden",
          "host",
          "ip",
          "credentials",
          "email",
          "phone",
        ],
      },
    );
    expect(result.messages[0]).toMatchObject({
      text: "[credentials] [host] [ip] [email] [phone] [secret hidden] [secret hidden] local[secret hidden] …/src/x.ts [email]",
    });
    expect(result.redactionSummary).toEqual(counts(2, 0, 1, 1));
  });
});
