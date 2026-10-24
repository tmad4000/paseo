import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  SharingError,
  type SharingSessionOptions,
  type ShareSource,
} from "../../sharing/share-service.js";
export type ShareRequest = Extract<SessionInboundMessage, { type: `share.link.${string}.request` }>;
export function isShareRequest(message: SessionInboundMessage): message is ShareRequest {
  return message.type.startsWith("share.link.") && message.type.endsWith(".request");
}
export function subscribeShareChanges(
  sharing: SharingSessionOptions | undefined,
  listener: Parameters<SharingSessionOptions["service"]["subscribe"]>[0],
) {
  return sharing?.service.subscribe(listener);
}
type LoadSource = (agentId: string, title?: string) => Promise<ShareSource>;
function required(value: string | undefined, field: string): string {
  if (!value) throw new SharingError("invalid_share_request", `${field} is required.`);
  return value;
}
async function create(
  sharing: SharingSessionOptions,
  msg: Extract<ShareRequest, { type: "share.link.create.request" }>,
  load: LoadSource,
): Promise<SessionOutboundMessage> {
  const config = sharing.config;
  if (!config?.listen || !config.publicBaseUrl)
    throw new SharingError(
      "sharing_not_configured",
      "Configure daemon.sharing.listen and daemon.sharing.publicBaseUrl to share conversations.",
    );
  const source = await load(required(msg.agentId, "agentId"), msg.title);
  return {
    type: "share.link.create.response",
    payload: {
      requestId: msg.requestId,
      ...(await sharing.service.create(source, {
        publicBaseUrl: config.publicBaseUrl,
        configured: true,
        previewDigest: msg.previewDigest,
        redaction: msg.redaction,
        expiresAt: msg.expiresAt,
      })),
    },
  };
}
export async function handleShareRequest(
  sharing: SharingSessionOptions | undefined,
  msg: ShareRequest,
  load: LoadSource,
): Promise<SessionOutboundMessage> {
  try {
    if (!sharing) throw new SharingError("sharing_not_configured", "Sharing is not configured.");
    const { service } = sharing;
    const requestId = msg.requestId;
    switch (msg.type) {
      case "share.link.create.request":
        return await create(sharing, msg, load);
      case "share.link.preview.request":
        return {
          type: "share.link.preview.response",
          payload: {
            requestId,
            snapshot: await service.preview(
              await load(required(msg.agentId, "agentId"), msg.title),
              msg.redaction,
            ),
          },
        };
      case "share.link.list.request":
        return {
          type: "share.link.list.response",
          payload: { requestId, shares: await service.list(msg.agentId) },
        };
      case "share.link.update.request":
        return {
          type: "share.link.update.response",
          payload: {
            requestId,
            share: await service.update(required(msg.shareId, "shareId"), {
              title: msg.title,
              expiresAt: msg.expiresAt,
              redaction: msg.redaction,
            }),
          },
        };
      case "share.link.revoke.request":
        return {
          type: "share.link.revoke.response",
          payload: { requestId, share: await service.revoke(required(msg.shareId, "shareId")) },
        };
      case "share.link.delete.request": {
        const shareId = required(msg.shareId, "shareId");
        await service.delete(shareId);
        return { type: "share.link.delete.response", payload: { requestId, deletedId: shareId } };
      }
    }
  } catch (error) {
    return {
      type: "rpc_error",
      payload: {
        requestId: msg.requestId ?? "",
        requestType: msg.type,
        error: error instanceof Error ? error.message : String(error),
        code: error instanceof SharingError ? error.code : "sharing_failed",
      },
    };
  }
}
