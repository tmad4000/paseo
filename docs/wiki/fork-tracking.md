# Fork task tracking

How work on this fork is tracked, and how the trackers point at each other.

## Systems

| System                    | Role                                                                          | Where                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Beads (`bd`)              | Authoritative agent task graph: epics, children, dependencies, evidence notes | Dolt data on this repo's `refs/dolt/data` ref; prefix `pspin-`. Bootstrap a fresh clone with `bd bootstrap`, then `bd dolt pull` / `bd dolt push`.                                     |
| World Issue Tracker (WIT) | Human-facing, Linear-like board for Jacob                                     | `paseo` board (upstream Paseo, public; fork items use the `paseo-fork` label and a "Paseo fork:" title prefix) and a planned separate **Paseo fork** board for the fork's own roadmap. |
| GitHub PRs                | Code and design changes                                                       | `tmad4000/paseo`                                                                                                                                                                       |

## Cross-linking convention

- A bead's description or notes name its WIT item URL(s) and PR number(s).
- A WIT item's description names its bead ID and PRs.
- A PR body names its bead ID (and WIT item when one exists).
- Prefer one WIT item attached to both boards over two copies, where WIT supports attaching an issue to more than one tracker.

## Current items

| Feature                                               | Bead                                                                        | WIT                                                                          | PRs           |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------- |
| Agent peek, spawned-agent registry, collapsible panes | `pspin-sgu` (`.1` side peek, `.2` registry, `.3` collapsible stacked panes) | Pending: WIT write access not yet granted to the tracking agent (2026-11-14) | #215 (design) |

Related beads: `pspin-c64` (subthreads drawer, merged in #79), `pspin-c64.1` (session side panel), `pspin-plx` (threads view design), `pspin-787` (orchestration UX epic), `pspin-xq4`, `pspin-4is`, `pspin-w4e`.

## Status

- 2026-11-14: Beads epic created and verified from a fresh clone. WIT mirroring is blocked until the agent connection is granted WIT write access; see the log entry.
