# Project wiki

This is the fork's discussion memory: questions Jacob has asked, what was researched, the options weighed, and what was decided and why. Without it, an agent asked "didn't we look at this before?" has to search old branches, closed issues and transcripts.

How it relates to the rest of `docs/`:

- `docs/*.md` describe how the system works now. They remain authoritative for behaviour and conventions.
- `docs/wiki/` records the discussions behind those docs. That includes ideas that were explored but never built.

## Pages

| Page                                             | Topic                                                                                                              | Status                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [split-layouts.md](split-layouts.md)             | iTerm2-style "split this tab" compared with the current cmux-style workspace splits                                | Coexist recommended; Phase 1 in progress (2026-11-14)      |
| [agent-peek-registry.md](agent-peek-registry.md) | Provider subagents and spawned agents as separate groups, a registry with side peek, and collapsible stacked panes | Design recommended; nothing built (2026-11-14)             |
| [fork-tracking.md](fork-tracking.md)             | How fork work is tracked in beads, World Issue Tracker and PRs, and how they cross-link                            | Beads in use; WIT mirroring blocked on access (2026-11-14) |

The [log](log.md) lists every recorded discussion and query, newest first.

## Conventions for agents

- **Before researching a question,** check this index and `log.md`. Extend an existing topic page instead of starting a new one.
- **After a discussion that settles something or rules something out,** do three things:
  1. Add a dated entry to `log.md`. Give the ask in plain words, where it came from (branch, commit, PR, issue or bead), and the outcome.
  2. Update the topic page's current status, decisions and open questions.
  3. Keep earlier decisions in the page's history; don't delete them. If a decision is reversed, say what changed.
- **Keep facts separate from judgement.** A decision is written as a decision ("decided with Jacob, date"); a recommendation is written as a recommendation. Cite code as `path:line` at a named commit.
- **This repository is public.** Do not include secrets, private notes, personal data, or host-specific paths.
