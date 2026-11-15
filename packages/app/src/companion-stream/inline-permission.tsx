import { useCallback, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { CompanionEntry } from "@getpaseo/protocol/companion-stream";
import type {
  AgentPermissionAction,
  AgentPermissionRequest,
  ToolCallDetail,
} from "@getpaseo/protocol/agent-types";
import { PlanCard } from "@/components/plan-card";
import { ToolCallDetailsContent } from "@/components/tool-call-details";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { useIsCompactFormFactor } from "@/constants/layout";

/** Uses the same request, action IDs and acknowledged response as Chat. */
export function InlinePermission({
  entry,
  serverId,
  agentId,
  onSaved,
}: {
  entry: Extract<CompanionEntry, { kind: "permission" }>;
  serverId: string;
  agentId: string;
  onSaved: () => void;
}) {
  const client = useHostRuntimeClient(serverId);
  const online = useHostRuntimeConnectionStatus(serverId) === "online";
  const compact = useIsCompactFormFactor();
  const permissions = useSessionStore((state) => state.sessions[serverId]?.pendingPermissions);
  const permission = Array.from(permissions?.values() ?? []).find(
    (item) => item.agentId === agentId && item.request.id === entry.requestId,
  );
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = permission?.request;
  // Structured question forms stay in Chat; an allow response cannot answer their fields.
  const detail = useMemo(
    () =>
      request?.detail ?? { type: "unknown" as const, input: request?.input ?? null, output: null },
    [request],
  );
  const actions: AgentPermissionAction[] = request?.actions?.length
    ? request.actions
    : [
        { id: "accept", label: "Approve", behavior: "allow", variant: "primary" },
        { id: "reject", label: "Deny", behavior: "deny", variant: "danger" },
      ];
  const input = request?.input;
  const target = input?.agentId;
  const prompt = input?.prompt;
  const respond = useCallback(
    async (action: AgentPermissionAction) => {
      if (!client || !online || lock.current) return;
      lock.current = true;
      setBusy(true);
      setError(null);
      try {
        await client.respondToPermissionAndWait(
          agentId,
          entry.requestId,
          {
            behavior: action.behavior,
            selectedActionId: action.id,
            ...(action.behavior === "deny" ? { message: "Denied by user" } : {}),
          },
          15000,
        );
        setResolved(true);
        onSaved();
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not respond. Try again.");
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [client, online, agentId, entry.requestId, onSaved],
  );
  if (!request || request.kind === "question" || resolved) return null;
  const preview = typeof prompt === "string" ? prompt.slice(0, 300) : request.description;
  return (
    <View style={styles.root} testID="stream-inline-permission">
      <Text style={styles.text}>
        {request.name ?? request.title ?? "Permission request"}
        {typeof target === "string" ? ` → ${target}` : ""}
      </Text>
      {preview ? (
        <Text style={styles.text} numberOfLines={3}>
          {preview}
        </Text>
      ) : null}
      <PermissionDetails request={request} detail={detail} />
      <View style={styles.actions}>
        {actions.map((action) => (
          <PermissionAction
            key={action.id}
            action={action}
            compact={compact}
            disabled={busy || !online}
            respond={respond}
          />
        ))}
      </View>
      {busy ? (
        <Text style={styles.text} accessibilityRole="alert">
          Sending decision…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  root: { gap: theme.spacing[2], padding: theme.spacing[2] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[2] },
}));

function PermissionAction({
  action,
  compact,
  disabled,
  respond,
}: {
  action: AgentPermissionAction;
  compact: boolean;
  disabled: boolean;
  respond: (action: AgentPermissionAction) => Promise<void>;
}) {
  const press = useCallback(() => void respond(action), [respond, action]);
  return (
    <Button
      size={compact ? "md" : "xs"}
      variant={action.behavior === "allow" ? "secondary" : "ghost"}
      disabled={disabled}
      onPress={press}
      testID={`stream-permission-${action.id}`}
    >
      {action.label}
    </Button>
  );
}

function PermissionDetails({
  request,
  detail,
}: {
  request: AgentPermissionRequest;
  detail: ToolCallDetail;
}) {
  const metadataPlan =
    typeof request.metadata?.planText === "string" ? request.metadata.planText : undefined;
  const inputPlan = typeof request.input?.plan === "string" ? request.input.plan : undefined;
  const plan = metadataPlan ?? inputPlan;
  if (request.kind === "plan" && plan)
    return (
      <PlanCard title={request.title ?? "Plan"} text={plan} outcome="pending" disableOuterSpacing />
    );
  return <ToolCallDetailsContent toolName={request.name} detail={detail} maxHeight={200} />;
}
