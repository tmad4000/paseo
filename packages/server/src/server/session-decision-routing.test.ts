import { describe, expect, it, vi } from "vitest";
import { rankWithDecisionFallback, type DecisionRoutingInput } from "./session-decision-routing.js";

function fixture(overrides: Partial<DecisionRoutingInput> = {}) {
  return {
    provider: "jev" as const,
    query: "Continue the offline indicator work",
    candidates: [
      {
        agentId: "real-chat",
        workspaceId: "workspace",
        projectId: "project",
        projectName: "Paseo",
        title: "Offline indicator",
        cwd: "/fixture",
        updatedAt: "2026-10-26",
        excerpts: [{ text: "Offline indicator", source: "title" as const }],
      },
    ],
    signal: new AbortController().signal,
    env: { TYPESAFE_API_KEY: "dummy-jev", OPENAI_API_KEY: "dummy-openai" },
    fallback: vi.fn(async () => ({ matches: [] })),
    ...overrides,
  } satisfies DecisionRoutingInput;
}

function jev(choice = "chat_0", probabilities = { chat_0: 0.98, none: 0.02 }) {
  return Response.json({
    answers: { destination: { type: "choice", choice, confidence: 0.95, probabilities } },
  });
}
function openai() {
  return Response.json({
    answers: [
      {
        type: "choice",
        name: "destination",
        choice: "chat_0",
        confidence: 0.95,
        probabilities: [
          { value: "chat_0", probability: 0.98 },
          { value: "none", probability: 0.02 },
        ],
      },
    ],
  });
}

function waitForAbort(_url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
  });
}

describe("decision routing", () => {
  it("abandons a slow Jev request within its budget and tries OpenAI", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(waitForAbort)
      .mockResolvedValueOnce(openai());
    const result = await rankWithDecisionFallback(fixture({ fetch: transport }));
    expect(result.routing).toMatchObject({ provider: "openai-decisions", fallback: true });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("uses the official Jev shape and only maps supplied options back to scoped chat ids", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(jev());
    const input = fixture({ fetch: transport });
    const result = await rankWithDecisionFallback(input);
    expect(result.ranking.matches).toEqual([
      { agentId: "real-chat", confidence: 0.98, excerptIndex: 0 },
    ]);
    expect(result.routing).toMatchObject({ provider: "jev", fallback: false });
    expect(input.fallback).not.toHaveBeenCalled();
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init?.redirect).toBe("error");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("jev-1.13.0");
    expect(body.state).toBe(input.query);
    expect(body.questions.destination).toMatchObject({
      type: "choice",
      criteria: { none: expect.any(String), chat_0: expect.any(String) },
    });
    expect(body.tools).toBeUndefined();
  });

  it("falls back from Jev failure to the official OpenAI Decisions shape", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("private error", { status: 429 }))
      .mockResolvedValueOnce(openai());
    const input = fixture({ fetch: transport });
    const result = await rankWithDecisionFallback(input);
    expect(result.routing).toMatchObject({ provider: "openai-decisions", fallback: true });
    expect(input.fallback).not.toHaveBeenCalled();
    expect(transport.mock.calls[1][0]).toBe("https://api.openai.com/v1/decisions");
    expect(JSON.parse(String(transport.mock.calls[1][1]?.body))).toMatchObject({
      model: "gpt-6-luna",
      input: input.query,
      questions: [
        { type: "choice", name: "destination", choices: [{ value: "chat_0" }, { value: "none" }] },
      ],
    });
  });

  it("skips unconfigured Jev and preserves the current matcher if both keys are absent", async () => {
    const transport = vi.fn<typeof fetch>();
    const input = fixture({ fetch: transport, env: {} });
    const result = await rankWithDecisionFallback(input);
    expect(result.routing).toMatchObject({ provider: "codex", fallback: true });
    expect(input.fallback).toHaveBeenCalledOnce();
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses OpenAI directly when selected", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(openai());
    const result = await rankWithDecisionFallback(
      fixture({ fetch: transport, provider: "openai-decisions" }),
    );
    expect(transport).toHaveBeenCalledOnce();
    expect(result.routing).toMatchObject({ provider: "openai-decisions", fallback: false });
  });

  it.each([
    { chat_0: 0.5, none: 0.1, invented: 0.4 },
    { chat_0: 0.9 },
    { chat_0: 0.9, none: 0.9 },
    { chat_0: -0.1, none: 1.1 },
  ])("rejects invalid option distributions before falling back: %j", async (probabilities) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jev("chat_0", probabilities as { chat_0: number; none: number }))
      .mockResolvedValueOnce(openai());
    const result = await rankWithDecisionFallback(fixture({ fetch: transport }));
    expect(result.routing.provider).toBe("openai-decisions");
  });

  it("keeps a legitimate no-match response without trying another model", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jev("none", { chat_0: 0.02, none: 0.98 }));
    const input = fixture({ fetch: transport });
    expect((await rankWithDecisionFallback(input)).ranking.matches).toEqual([]);
    expect(transport).toHaveBeenCalledOnce();
    expect(input.fallback).not.toHaveBeenCalled();
  });

  it("does not fall back when the user supersedes or disconnects", async () => {
    const controller = new AbortController();
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      throw new Error("aborted");
    });
    const input = fixture({ fetch: transport, signal: controller.signal });
    await expect(rankWithDecisionFallback(input)).rejects.toThrow();
    expect(input.fallback).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledOnce();
  });

  it("caps response size and falls back without exposing provider text", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("x".repeat(65537)))
      .mockResolvedValueOnce(openai());
    expect((await rankWithDecisionFallback(fixture({ fetch: transport }))).routing.provider).toBe(
      "openai-decisions",
    );
  });
});
