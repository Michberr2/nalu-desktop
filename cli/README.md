# Nalu CLI

Nalu in your terminal — a Claude Code-style coding agent with exactly **one
model option: `auto`**. The Nalu router picks the right Nalu model for every
request (code, reasoning, finance, vision, …) on its own; there is nothing to
pick or configure.

## Install

```sh
curl -fsSL https://n4lu.com/install.sh | sh
```

Requires Node.js 18+ (`brew install node`). The installer puts the CLI in
`~/.nalu/bin` and a `nalu` command on your PATH.

## Use

```sh
nalu                    # interactive session in the current directory
nalu "fix the failing test"   # start with a first prompt
nalu -p "explain this repo"   # print the answer and exit (pipes work too)
cat error.log | nalu -p "what caused this?"
nalu update             # self-update to the latest version
```

In a session: `/agent` `/goal` `/swarm` `/team` `/plan <task>` `/search <query>`
`/help` `/model` `/status` `/clear` `/exit` — end a line with `\` for multi-line
input, Ctrl+C interrupts a running response.

## Orchestration

- `/agent <name> [task]` — force a specific Nalu specialist (finance, legal,
  medical, code, …). With a task it's one-shot; without, it's sticky until
  `/agent off`. `/agent` alone lists the fleet.
- `/goal <goal>` — relentless mode: Nalu works in rounds and an independent
  skeptical verifier checks real evidence after each one; it does not stop
  until the goal is achieved (or you Ctrl+C).
- `/swarm <task>` — Nalu designs the sub-agents the task needs (1-5), runs them
  in parallel with read-only tools, then the lead finishes with full tools.
- `/team <task>` — builds a named team with roles and a leader, runs tasks on a
  LIVE task board (pending → working → done) in dependency order, then the
  leader integrates and saves the board to `.nalu/plans/`.
- Deep thinking: type `think`, `ultrathink`, or `packmind` in any message —
  reasoning streams live, then the answer (same tiers as the website).

Sub-agents are read-only by design: parallel agents never fight over files or
interleave permission prompts — all changes flow through the lead.

The agent reads/writes files, greps, searches the web (`web_search`/`fetch_url`
hit the live internet via `/api/web`), and runs shell commands in your project —
asking permission before anything that mutates (skip the prompts with `--yolo`).

## Project memory & plans (the .nalu folder)

Drop docs, notes, or specs into `<project>/.nalu/` (and/or a `NALU.md` at the
repo root) — the CLI loads them every turn as authoritative project context
(capped ~24k chars; larger files are listed so the model can `read_file` them).
This is how users give Nalu proprietary or niche-domain documentation (legacy
frameworks, internal APIs, trading systems, …).

Plans live in `.nalu/plans/`: `/plan <task>` explores the code read-only and
writes a checkbox plan there, then stops for review. Writes inside `.nalu/` are
auto-approved (it's Nalu's scratch space). The system prompt also tells the
model to plan-first on any complex task and tick the checkboxes as it executes.

## Layout

- `nalu.mjs` — the whole CLI: single file, zero dependencies, Node 18+.
  Talks to `https://n4lu.com/api/chat` (SSE) with `cli: true`; the agent loop
  and all tool execution are local.
- `install.sh` — the installer served at `https://n4lu.com/install.sh`.
- `publish.sh` — copies both files into `~/train/client/public/` (the website's
  static dir). Deploy the train repo (`train/deploy.sh`) to make them live.

**This folder is the source of truth.** The copies in
`train/client/public/{nalu.mjs,install.sh}` are deploy artifacts — edit here,
then run `./publish.sh`. Bump `VERSION` in `nalu.mjs` on every change so
`nalu update` reports it.

The server side (specialist routing, the `cli: true` terminal-agent mode) lives
in `train/api/chat.ts`.
