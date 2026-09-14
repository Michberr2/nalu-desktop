# Nalu CLI

Nalu in your terminal — a Claude Code-style coding agent with exactly **one
model option: `auto`**. The Nalu router picks the right Nalu model for every
request (code, reasoning, finance, vision, …) on its own. Model selection is
automatic; reasoning and output limits are configurable.

## Install

```sh
curl -fsSL https://n4lu.com/install.sh | sh
```

Requires Node.js 18+ (`brew install node`). The installer puts the CLI in
`~/.nalu/bin` and a `nalu` command on your PATH.

Installation and `nalu update` stage downloads and check JavaScript syntax before
replacing the CLI. Failed downloads or syntax checks preserve the installed
version. Downloads have a 60-second deadline and a 2 MiB limit; self-update also
preserves executable permissions and follows an existing CLI symlink.

For an isolated installation that leaves PATH and shell profiles unchanged:

```sh
curl -fsSL https://n4lu.com/install.sh | NALU_INSTALL_DIR="$PWD/nalu-bin" NALU_NO_MODIFY_PATH=1 sh
./nalu-bin/nalu doctor
```

The launcher uses a relative symlink, so the installation directory can be moved.

## Use

```sh
nalu                    # interactive session in the current directory
nalu "fix the failing test"   # start with a first prompt
nalu -p "explain this repo"   # print the answer and exit (pipes work too)
cat error.log | nalu -p "what caused this?"
nalu update             # self-update to the latest version
nalu doctor             # diagnose local setup without a model request
npm run test:cli        # local CLI regression tests (from repo root)
```

Print mode reads piped input through EOF, including slow producers. Input over
100,000 bytes fails with an explicit error instead of being silently truncated;
for larger context, reference a file in your prompt. If automation leaves stdin
open, use `nalu -p --no-stdin "your prompt"` to skip reading it.
While waiting for response activity, the CLI reports progress every 30 seconds
(on stderr in print mode). Each model response has a 10-minute deadline that
keepalive messages cannot extend. Set `NALU_RESPONSE_TIMEOUT_MS` to an integer
from 1000 to 3600000 to change it. Reaching this deadline fails the request
without automatically retrying it; Ctrl+C cancels sooner.
The response also has a three-minute inactivity limit, measured from actual text,
reasoning, or tool arguments. Heartbeats and empty events do not reset it. Set
`NALU_RESPONSE_IDLE_TIMEOUT_MS` (1000–3600000) to change that limit. An inactivity
timeout fails without automatic retries; it does not execute partial tool calls.

Authentication and other permanent HTTP errors fail promptly with guidance.
Transient HTTP failures receive up to two retries; retry messages include the
actual failure reason.

Print mode exits nonzero when a response is incomplete, including model output
limits or malformed tool data. Tools from incomplete responses are not executed.
Shell tools receive closed stdin; supply input in the command itself (for example,
a pipe or heredoc). Signal termination and timeouts report a failed command.

Unknown flags fail immediately. Use `--` before a prompt starting with a dash:
`nalu -p -- "--explain this option"`. All prompt words are preserved, and
`nalu -p "update"` sends a prompt rather than running the updater.

Coding tasks have up to 120 model/tool round-trips for implementation and
verification; ordinary conversation and read-only work have 40. Set
`--max-steps 60` or `NALU_MAX_STEPS=60` to choose an explicit limit from 1 to 1000.
The command-line option takes precedence. A larger limit allows more model
requests; it does not establish that a task is complete. Existing response
timeouts, permission checks and Ctrl+C cancellation still apply.

Reaching the limit exits unsuccessfully in print mode. In an interactive session,
`continue` resumes an unfinished coding task with its original requirements,
reasoning mode and test/verification opt-outs. Completion requires fresh evidence
after the continuation. A new unrelated question starts its own task.
If an edit or shell command follows a passing review check, Nalu immediately
requests another check. Do cleanup before final verification; a shell command
cannot preserve earlier evidence merely because it exits successfully.

## Reasoning and response limits

CLI 1.11.3 accepts `--reasoning none|low|medium|high`, `--max-tokens 256..32000`
and `--no-web-search`. For example:

```sh
nalu --reasoning high --max-tokens 16000 "implement and verify the requested feature"
nalu --no-web-search "fix this local project using its existing dependencies"
```

`NALU_REASONING` and `NALU_MAX_TOKENS` provide environment defaults; explicit
flags win. For reasoning, explicit flags/environment take precedence over task
keywords (`think` requests medium; `ultrathink` and `packmind` request high),
which take precedence over saved preferences. With no preference, the field is
omitted and the backend chooses its default. Limits apply to each model response,
separately from the task's step budget.

Desktop 0.1.19 syncs explicitly saved reasoning, response-limit and web-search
preferences into `~/.nalu/config.json`. An existing terminal session reads these
changes when its next task begins. A fresh desktop profile preserves an existing
standalone CLI configuration. Settings shows the actual desktop version.

Disabling web search removes `web_search` and `fetch_url` from the tool catalog
and rejects attempts to execute those tools. It does not disable network access
from arbitrary shell commands. The CLI sends reasoning and limits to the API;
the backend must support them to honor the exact values. The corresponding
CLI-only backend fix has request-level regression coverage; see the current
[verification record](../docs/IDE_VERIFICATION.md) for deployment status.

## Test local web apps

Nalu Desktop 0.1.16 and later supply an isolated Chromium browser to CLI sessions started
from its terminal or installed launcher. Ask Nalu to build or fix a website and
verify its workflows. The agent can discover controls, fill forms, click buttons,
use the keyboard, select filters, reload, resize, inspect screenshots, and check
observable outcomes. It also checks control names, overflow, and browser errors.

The app server must already be running before `browser open`. Only loopback
HTTP(S) URLs are supported. If the frontend calls a separate local API, `open`
can specify that API in `origins`; other network requests are blocked and reported.
Each task uses a fresh profile, with no access to the user's browser sessions.
Browser actions require permission (or `--yolo`) and are disabled in read-only
mode. Cancellation and turn completion close the worker. Browser screenshots
are sent to Nalu for visual review, like other task context; evidence files remain
in the temporary directory reported by the tool.

For UI coding tasks with a browser available, run project checks before final
browser assertions. Later edits and shell commands invalidate browser evidence.
Snapshots and screenshots alone do not satisfy the behavior check, and an
unrelated passing assertion cannot erase a failed assertion from completion review.
This minimum completion guard does not prove that every product requirement works.

Source development uses `NALU_DESKTOP_RUNTIME` (absolute Electron executable)
and `NALU_DESKTOP_APP` (absolute built project directory). Packaged launchers set
these automatically. A standalone Node installation continues to work without
the browser capability. DOM interaction currently targets the main document;
iframe and shadow-root controls require further tooling.

## Diagnose setup

Run `nalu doctor` to check Node.js, the shell, API configuration, sign-in token
presence, and project readability. It makes no network request and never prints
the token. A passing report confirms local setup, not server connectivity or
session validity. Failed checks exit nonzero and explain what needs attention.

## Mobile and phone task worker

Sign in to Nalu Desktop, then keep a worker running on the computer that holds
your repositories. Desktop synchronizes the session with the full CLI. You can
also supply a session token through `NALU_TOKEN` and set `NALU_API_URL`.

```sh
nalu worker --repo naludesktop="$HOME/naludesktop" --repo train="$HOME/train"
```

Register the exact repository names selected in mobile. Each task runs in a
separate CLI process with the matching local working directory. Chat tasks are
read-only. IDE and AutoPilot tasks can edit files and run commands when the
worker is explicitly started with `--yolo`:

```sh
nalu worker --repo naludesktop="$HOME/naludesktop" --repo train="$HOME/train" --yolo
```

The repository mapping selects a working directory; it is not an OS sandbox.
The worker executes code as your local user. Keep it running only for accounts
whose mobile and phone task requests you trust. Without mappings, the current
directory is registered under its basename. `--once` claims at most one task;
`--worker-id <name>` provides a stable worker name. Ctrl+C stops the active task
and exits. A running worker uses the session it started with; restart it after
changing accounts.

The worker also executes queued saved pipelines through the backend `flow-run`
engine. It publishes progress and final output to the shared AutoPilot ledger,
renews its task lease every 20 seconds, and stops on cancellation or a lost
lease. Cancelling a pipeline also requests `flow-run` stop. A lost connection
does not silently replay a partially executed task. Remote task sessions are
excluded from local training capture.

The backend must expose authenticated `task-dispatch`, `task-claim`,
`task-update`, `task-cancel`, and `task-workers` actions on `/api/data`.

Remote AutoPilot continues in rounds, checking tool evidence before declaring
the goal achieved. A remote task can use `ask_user` when a missing decision
prevents progress. Its question is stored in the shared ledger while the worker
keeps its lease. Answer through Nalu Voice, or enable “Call when Nalu needs an
answer” in mobile Settings to receive a phone question. Phone answers are read
back for confirmation before the same task continues. These flows also require
the backend `task-ask`, `task-question-status`, `task-answer`, `task-questions`,
`task-notification-preferences`, and `task-notification-deliver` actions.

The question is durable; the CLI process must stay running to consume the answer.
Worker loss ends the lease instead of automatically replaying prior actions.

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

Shell examples in answers are displayed as text; executing a command requires
an explicit tool call. Scratch-directory write approval checks resolved paths,
so symlinks pointing outside `.nalu/` still require normal write permission.

Plans live in `.nalu/plans/`: `/plan <task>` explores the code read-only and
writes a checkbox plan there, then stops for review. Writes inside `.nalu/` are
auto-approved (it's Nalu's scratch space). The system prompt also tells the
model to plan-first on any complex task and tick the checkboxes as it executes.

## Release notes and verification

See [CHANGELOG.md](CHANGELOG.md) for the reliability improvements and
[VERIFICATION.md](VERIFICATION.md) for reproducible checks and live-test evidence.

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

Shell tools use Bash with `pipefail`, so output formatting does not hide upstream failures. Explicit `||` recovery remains available; intentionally short-circuiting pipelines may need to handle SIGPIPE.
