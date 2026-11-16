# Pinned disclosure QA

Base: current fork main `77a49abbd` (descends from `e6e232a`). Target: beta.36, held during beta.35 release and pending root's landing slot.

The shared Pinned header now keeps its disclosure visible without hover and exposes `aria-expanded`; native accessibility state and the existing press handler remain. Both sidebar groupings use this component.

The new cases live in the existing sidebar pin-shortcut browser suite. They verify the rendered SVG direction without hover, Enter to collapse, Space to expand, `aria-expanded`, and hidden collapsed contents at 390 and 1280 px. [Browser output](browser.txt): two passed. [Before-fix regression](regression-before.txt): failed because the original rendered button omitted `aria-expanded`.

[Independent Sol review](review.txt): no blockers. Full workspace [typecheck](typecheck.txt) and [lint](lint.txt) passed; [format](format.txt) ran before commit. Local browser verification used Linux Chromium with sandboxing enabled and the existing root-owned Chrome sandbox helper. Native Apple/Android UI was not exercised. Builds/checks ran serially at `nice -n 19`; Metro and Playwright used one worker. The isolated preview and test daemon were stopped after each run; the main daemon was not restarted.

| Width | Collapsed                               | Expanded                               |
| ----- | --------------------------------------- | -------------------------------------- |
| 390   | [Screenshot](pinned-collapsed-390.png)  | [Screenshot](pinned-expanded-390.png)  |
| 1280  | [Screenshot](pinned-collapsed-1280.png) | [Screenshot](pinned-expanded-1280.png) |
