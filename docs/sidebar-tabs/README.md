# Sidebar tab count

Workspace rows show a muted stacked-tabs icon and count when one or more real tabs are open
on this device. The count covers visible split panes, excludes hidden panes and New tab
placeholders, and updates as tabs open or close. The existing title, metadata and trailing
status/diff/time controls stay in place. The indicator has a translated accessible label and
hover tooltip; it is a passive View so it does not take the row's press action.

## Verification

`pspin-ffh`, browser Chromium component fixture:

```text
npm run test:browser --workspace=@getpaseo/app -- src/components/sidebar/workspace-tab-count.browser.test.tsx --bail=1
Test Files  1 passed (1)
     Tests  3 passed (3)
```

The tests use the real workspace layout store and open/close/split/hide actions. They cover
workspace isolation, the 0/1/2/3-tab threshold, tooltips and accessibility labels, New tab
placeholders, split panes, and hidden Explorer tabs. The fixture uses the real Lucide/SVG web
renderers; the existing test theme adapter and an animation adapter replace native runtimes.

[Indicator and tooltip screenshot](desktop.png) shows the component fixture, not an installed
app. App typecheck and repository lint pass. Native devices and packaged desktop builds were
not exercised. This source change does not install or restart any app or daemon.

## Navigation refinements (pspin-1ip)

Single-tab workspaces now show `1` as well as larger counts. The total includes inactive tabs
in visible panes; it is not limited to the currently selected tab. Hidden Explorer panes and
New tab placeholders remain excluded.

On wide web/desktop layouts, resting a mouse over either Back/Forward control opens the full
retained history after350ms. The pointer can enter and scroll the menu; leaving closes the
preview. Hover does not move editor focus, dismiss the keyboard or cover the one-step arrows.
Click/keyboard chevrons and touch/long-press keep their existing menu/sheet behavior.
