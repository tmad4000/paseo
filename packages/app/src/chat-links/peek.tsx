import React, { useCallback, useMemo, useState, type ReactElement } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Button } from "@/components/ui/button";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import { linkHost, type ChatLink } from "./model";
import { PeekFrame } from "./peek-frame";
import { usePeekFrameStatus } from "./peek-model";

const ThemedGlobe = withUnistyles(Globe);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface LinkPeekActions {
  open: (link: ChatLink) => void;
  copy: (link: ChatLink) => void;
  jump: (link: ChatLink) => void;
  canJump: (link: ChatLink) => boolean;
}

const PEEK_MAX_WIDTH = 720;
const PEEK_MAX_BODY_HEIGHT = 520;
const SNAP_POINTS = ["70%"];

/**
 * A look at a link without leaving the chat: a card over the chat on wide screens, a sheet on
 * compact ones. The page loads in a frame; one that refuses framing or never loads gets a card
 * with its address and Open instead.
 */
export function LinkPeek({
  link,
  actions,
  onClose,
}: {
  link: ChatLink | null;
  actions: LinkPeekActions;
  onClose: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const [interactive, setInteractive] = useState(false);
  const header = useMemo<SheetHeader>(
    // The label is already short; the full address is what tells two similar links apart.
    () => ({ title: link?.label ?? "", subtitle: link?.url }),
    [link],
  );
  const handleClose = useCallback(() => {
    setInteractive(false);
    onClose();
  }, [onClose]);
  const toggleInteractive = useCallback(() => setInteractive((value) => !value), []);
  const open = useCallback(() => {
    if (link) actions.open(link);
  }, [actions, link]);
  const copy = useCallback(() => {
    if (link) actions.copy(link);
  }, [actions, link]);
  const jump = useCallback(() => {
    if (!link) return;
    handleClose();
    actions.jump(link);
  }, [actions, handleClose, link]);
  const canJump = link ? actions.canJump(link) : false;

  const hasLink = link !== null;
  const footer = useMemo(
    () =>
      hasLink ? (
        <View style={styles.footer}>
          {isWeb ? (
            <Button
              variant={interactive ? "secondary" : "ghost"}
              size="sm"
              onPress={toggleInteractive}
              accessibilityLabel={t("agentPanel.links.interactLabel")}
              testID="chat-link-peek-interact"
            >
              {t(interactive ? "agentPanel.links.stopInteracting" : "agentPanel.links.interact")}
            </Button>
          ) : null}
          <View style={styles.footerSpacer} />
          <Button
            variant="ghost"
            size="sm"
            onPress={jump}
            disabled={!canJump}
            testID="chat-link-peek-jump"
          >
            {t("agentPanel.links.jump")}
          </Button>
          <Button variant="ghost" size="sm" onPress={copy} testID="chat-link-peek-copy">
            {t("agentPanel.links.copy")}
          </Button>
          <Button variant="default" size="sm" onPress={open} testID="chat-link-peek-open">
            {t("agentPanel.links.open")}
          </Button>
        </View>
      ) : null,
    [canJump, copy, hasLink, interactive, jump, open, t, toggleInteractive],
  );

  return (
    <AdaptiveModalSheet
      visible={link !== null}
      onClose={handleClose}
      header={header}
      footer={footer}
      desktopMaxWidth={PEEK_MAX_WIDTH}
      desktopHeight={Math.min(PEEK_MAX_BODY_HEIGHT + 120, Math.round(height * 0.8))}
      snapPoints={SNAP_POINTS}
      scrollable={false}
      testID="chat-link-peek"
    >
      {link ? (
        <PeekBody key={link.key} link={link} interactive={interactive} onOpen={open} />
      ) : null}
    </AdaptiveModalSheet>
  );
}

function PeekBody({
  link,
  interactive,
  onOpen,
}: {
  link: ChatLink;
  interactive: boolean;
  onOpen: () => void;
}): ReactElement {
  const { status, onLoad, onError } = usePeekFrameStatus({ url: link.url });
  if (status === "blocked") {
    return <PeekFallback link={link} onOpen={onOpen} />;
  }
  return (
    <View style={styles.frameHost}>
      <PeekFrame
        url={link.url}
        title={link.label}
        interactive={interactive}
        onLoad={onLoad}
        onError={onError}
      />
      {status === "loading" ? (
        <View style={styles.loading} pointerEvents="none" testID="chat-link-peek-loading">
          <ThemedLoadingSpinner size="small" uniProps={mutedColorMapping} />
        </View>
      ) : null}
    </View>
  );
}

/** What a refused or unreachable page shows: where it lives, and the way out to it. */
export function PeekFallback({
  link,
  onOpen,
}: {
  link: ChatLink;
  onOpen: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.fallback} testID="chat-link-peek-fallback">
      <ThemedGlobe size={22} uniProps={mutedColorMapping} />
      <Text style={styles.fallbackHost}>{linkHost(link.url)}</Text>
      <Text style={styles.fallbackUrl} selectable numberOfLines={3}>
        {link.url}
      </Text>
      <Text style={styles.fallbackMessage}>{t("agentPanel.links.cannotPreview")}</Text>
      <Button variant="outline" size="sm" onPress={onOpen} testID="chat-link-peek-fallback-open">
        {t("agentPanel.links.open")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frameHost: {
    flex: 1,
    minHeight: 0,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[2],
    padding: theme.spacing[6],
  },
  fallbackHost: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  fallbackUrl: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
    maxWidth: 520,
  },
  fallbackMessage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[2],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  footerSpacer: {
    flex: 1,
  },
}));
