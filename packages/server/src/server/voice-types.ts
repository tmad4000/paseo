export type VoiceSpeakHandler = (params: {
  text: string;
  callerAgentId: string;
  signal?: AbortSignal;
}) => Promise<void | { ok: false; reason: "interrupted" | "unavailable" }>;

export interface VoiceCallerContext {
  childAgentDefaultLabels?: Record<string, string>;
  lockedCwd?: string;
  allowCustomCwd?: boolean;
  enableVoiceTools?: boolean;
}
