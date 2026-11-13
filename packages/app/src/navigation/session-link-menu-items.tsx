import { useStableEvent } from "@/hooks/use-stable-event";
import { useTranslation } from "react-i18next";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionLinkActions } from "./use-session-link-actions";

export function SessionLinkMenuItems({ links }: { links: string[] }) {
  return (
    <>
      {links.map((href) => (
        <SessionLinkMenuGroup key={href} href={href} showLabel={links.length > 1} />
      ))}
    </>
  );
}

function SessionLinkMenuGroup({ href, showLabel }: { href: string; showLabel: boolean }) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const actions = useSessionLinkActions();
  const open = useStableEvent(() => actions.open(href));
  const openBeside = useStableEvent(() => actions.open(href, "side"));
  const openWindow = useStableEvent(() => actions.open(href, "window"));
  const copy = useStableEvent(() => actions.copy(href));
  return (
    <>
      {showLabel ? <ContextMenuLabel>{href}</ContextMenuLabel> : null}
      <ContextMenuItem onSelect={open}>{t("sessionLinks.open")}</ContextMenuItem>
      {!compact ? (
        <ContextMenuItem onSelect={openBeside}>{t("sessionLinks.openBeside")}</ContextMenuItem>
      ) : null}
      <ContextMenuItem disabled={!actions.canOpenWindow} onSelect={openWindow}>
        {t(actions.canOpenWindow ? "sessionLinks.openWindow" : "sessionLinks.windowUnavailable")}
      </ContextMenuItem>
      <ContextMenuItem onSelect={copy}>{t("sessionLinks.copy")}</ContextMenuItem>
      <ContextMenuSeparator />
    </>
  );
}
