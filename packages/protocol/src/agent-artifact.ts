import { z } from "zod";

export const AgentArtifactSchema = z.object({
  path: z.string(),
  name: z.string(),
  kind: z.enum(["html", "markdown", "image", "svg", "pdf", "diff"]),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
