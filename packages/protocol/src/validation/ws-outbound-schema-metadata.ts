import { WSOutboundMessageSchema as SourceWSOutboundMessageSchema } from "../messages.js";

// Explicit annotation: the inferred object type grew past what tsc will serialize
// into declarations (TS7056); `typeof` keeps the reference by name.
export const WSOutboundMessageSchema: { schema: typeof SourceWSOutboundMessageSchema } = {
  schema: SourceWSOutboundMessageSchema,
};
