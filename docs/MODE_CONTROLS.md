# Chat, Agent, PC, Edit and Terminal

Desktop 0.1.25 adds Auto task interpretation and a desktop companion while preserving the manual workflows below. See [desktop experience](DESKTOP_EXPERIENCE.md) and the 0.1.25 signed review package for current acceptance evidence.

Desktop 0.1.24 makes the five prompt modes separate, usable workflows.

| Mode | Behavior |
| --- | --- |
| Chat | Streams an answer with the open file as context. It does not execute commands or apply edits. |
| Agent | Runs the existing project tool loop, with file previews and action approval. Completion requires successful verification. |
| PC | Plans browser, app and system actions. Actions wait for approval; failed tool results remain failures. Invalid plans never trigger a guessed action. |
| Edit | Returns a complete replacement for the open file, shows a diff and offers Apply/Reject. Apply targets the original path and rejects stale buffers, disk conflicts and closed files. |
| Terminal | Interprets every task with AI, displays each proposed shell command and waits for approval unless auto-run is enabled. Reads command results to choose the next step. The working directory persists between requests within each project. |

Each mode retains its prompt draft. Chat and Edit have separate conversations;
only the selected mode's transcript is visible. Switching modes and clearing the
active transcript are disabled during execution. The mode selector supports
arrow keys, Home and End, and exposes the selected mode to assistive technology.
Switching modes resets auto-run. Stop cancels model requests, pending approvals
and cancellable shell commands and prevents later PC actions from starting.
Already performed actions are not undone; a native IPC action already in progress
may finish before Stop returns. AppleScript has a 30-second timeout.

Edit applies to the editor buffer. Existing autosave and conflict/recovery rules
still govern persistence. An incomplete or ambiguous model code block cannot
become a replacement, and a longer outer fence supports Markdown content.

Terminal preserves its working directory, not environment variables, running
interactive programs or shell functions. Use the separate interactive terminal
panel for those sessions. A denied Terminal or PC action ends that task.

Native app, mouse, keyboard and screen control currently requires macOS and
appropriate system permissions. Pixel clicks also require an installed `cliclick`;
Nalu no longer silently installs it while clicking. The built-in browser has
separate page capture and input tools. PC receives the current platform and
permission state so it can select available tools or report a blocker. These
checks do not establish arbitrary website or native-app task reliability.

## Verification

The final production build and **111 IDE tests pass**. All five modes passed
the actual signed-app workflow in `nalu-modes-K39wBW`; the permission-race
fixture passed in `nalu-ide-smoke-NqZmax`. Package verification matched all 109
build files and the CLI. Developer ID signing passes; Gatekeeper rejects the
unnotarized package. Source consistency checks pass across all three repos.

- `npm run build` checks TypeScript and builds the app.
- `npm run test:ide` includes Edit proposal parsing, stale-buffer protection,
  Terminal approval/cancellation/cwd persistence, and PC failure/completion guards.
- `node tests/mode-controls.mjs [path/to/Nalu.app/Contents/MacOS/Nalu]` runs the
  actual app with its real main process, preload and renderer, isolated home,
  profile and project. Only cloud responses are replaced with deterministic
  CDP fixtures. It exercises all modes, real file writes, shell verification,
  approvals/Stop and a local browser form with Unicode input.
- `NALU_IDE_PC_CANCEL_TEST=1 electron tests/ide-smoke.cjs` holds the permission
  reply in a fixture and verifies that Stop prevents a later PC model call.
- `node scripts/check-nalu-sync.mjs` checks sibling source consistency.

The signed review artifact and exact evidence are under
`review-build/quality-0.1.24-cli-1.11.4-signed/`. Earlier 0.1.23 runtime-upgrade
results remain separate in their original artifact. These mode tests verify the
execution paths; live model quality and successful use of arbitrary apps/sites
are separate acceptance work. The app is not installed in the normal profile
or published as part of this change.
