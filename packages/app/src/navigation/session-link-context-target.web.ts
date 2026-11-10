import { isSessionLink } from "./session-link";

export function sessionLinkAtContextEvent(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null;
  const target = Reflect.get(event, "target");
  if (!(target instanceof Element)) return null;
  const href = target.closest("a[href]")?.getAttribute("href");
  return href && isSessionLink(href) ? href : null;
}
