# IDE and CLI quality work

Current review source is **desktop 0.1.24 / CLI 1.11.4**. The five prompt modes
now have separate drafts/transcripts, working approval and Stop controls, safe
Edit proposals and an AI Terminal whose working directory persists across tasks.
See [mode controls and their current verification](MODE_CONTROLS.md). The 0.1.23
results below retain their original artifact and scope.

Runtime-upgrade baseline: **desktop 0.1.23 / CLI 1.11.4**, under
`review-build/quality-0.1.23-cli-1.11.4-signed/`. It runs Electron 44.3.0,
Chromium 152.0.7977.78 and Node 24.20.0, with macOS 13 as its declared minimum.
All 109 desktop build files and the bundled CLI match the production build.

The current checks pass 91 IDE regressions, 193 CLI regressions under Node 22,
the production build, two real browser integration cases against the signed app,
and actual-executable startup, native PTY/CLI, settings synchronization,
project/unsaved-edit crash recovery and saving. JSON and TypeScript workers report
real errors and clear them after external corrections. Settings passes modal,
keyboard, focus, pointer and short-viewport checks, with screenshots inspected.

The actual Vite development startup also passes in an isolated HOME/profile,
including its renderer bridge, native terminal and sandbox-preserving command
line. Hot reload is not covered by that check. The full CLI fixture suite cannot
be counted as passing inside Electron: its fake browser workers assume a plain
Node executable. The failed attempt is retained separately; actual packaged CLI
and browser behavior have their own passing integration evidence.

Strict nested Developer ID signing and hardened runtime checks pass. Gatekeeper
rejects this review app as unnotarized; no stapled ticket exists. Normal-profile
installation, authentication, upgrades and other platform runtimes remain open.
The final npm dependency audit reports zero known vulnerabilities; it is not a
full security review. See [runtime upgrade evidence](RUNTIME_UPGRADE.md).

CLI 1.11.4 remains synchronized with the local train release copies. Live coding
completion remains unreliable. The shared API settings fix has verified preview
evidence, but production deployment remains unestablished. See
[retained live results](benchmarks/visual-review-2026-09-12.md).

Historical evidence below retains its original versions and narrower scope.

Latest browser/packaging progress: see
[`benchmarks/browser-verification-2026-09-12.md`](benchmarks/browser-verification-2026-09-12.md).
Desktop 0.1.16 / CLI 1.11.0 now has real isolated Chromium interaction and
screenshot tooling. The historical evidence below retains its original versions.

Objective: improve and verify the Nalu IDE with Nalu CLI to the quality expected
of leading coding agents. This goal remains active; the evidence below does not
establish parity with Codex or Claude Code.

## Implemented

- Desktop releases bundle the complete Nalu CLI. First-run installation validates
  staged code, updates older versions, and preserves a valid newer standalone CLI.
- The launcher uses the app runtime, including on machines with no `node` on PATH.
  The terminal's **+ Nalu** button starts the coding agent in the selected project.

- Terminal processes and scrollback survive hiding the panel and switching to chat.
- Each terminal retains its starting project. Folder switches never inject commands
  into a running agent. New terminals use the newly selected project.
- Explicit exit status and restart replace uncontrolled shell restart loops.
- Terminal startup generations prevent orphaned processes and stale exit handlers;
  IPC sessions are scoped to the originating window.
- Open editor tabs refresh after external CLI changes. Unsaved buffers are preserved
  on conflict, with explicit disk/overwrite choices and autosave paused.
- Save completion acknowledges only the content actually written, preserving typing
  that happened during the write. Save errors remain visible and retryable.
- Agent code insertion no longer immediately saves the previous React state.

- Source control reads NUL-delimited Git status, preserving filenames and rename
  destinations, and supports repositories before their first commit.
- Staged and unstaged rows open distinct diffs; unchanged tracked files no longer
  appear as entirely new files. Failed commits now surface an error.
- The status bar reports the actual branch and open-file diagnostic count.

## Reproducible checks

- `npm run test:ide`: 91 tests covering editor state, recovery, terminal lifecycle, CLI installation, Git, Agent completion, approvals, and model streaming.
- `npm run test:ide:smoke`: builds and runs the real renderer, preload, xterm, and
  shell in an isolated Electron profile. Unrelated IPC uses fixtures and HTTP
  requests are blocked. It installs and launches the full CLI using Electron's runtime, opens a dedicated
  Nalu terminal and checks `/help` includes `/duo`, then verifies
  session persistence, project switching, explicit restart, editor conflict
  preservation, choosing the disk version, and clean-file refresh.
- `npm run build`: TypeScript plus production renderer/main/preload bundles.

The Electron smoke test is a macOS test (uses `/bin/sh`). It tests offline local
integration, not live model task quality. Screenshots are saved in its reported
temporary fixture directory. No installation or production release is performed.

## Remaining acceptance work

- Verify authentication sync and first-run diagnostics with a live signed-in session.
- Verify realistic IDE coding tasks with live Nalu, including multi-file changes,
  tests/builds, failures, interruption, and `/duo` proposals integrated in the IDE.
- Strengthen change review, source-control feedback, workspace context, and recovery.
- Test remaining editor cases: missing files, conflict resolution after further disk
  changes, explicit overwrite, window-close recovery, and large workspaces.
- Evaluate against comparable Codex/Claude tasks with recorded outcomes rather than
  claiming parity from unit tests. Linux/Windows and packaged-app acceptance remain.

Disk conflict checks are optimistic reads before writes, not a filesystem-wide
transaction against arbitrary external writers. The two-second refresh interval
is bounded polling of open tabs; future file watching can improve responsiveness.

## Local package acceptance

An unsigned macOS arm64 directory build completed successfully with
`electron-builder --dir --mac --config.mac.identity=null --config.mac.notarize=false`
and signing auto-discovery disabled. Output: `/tmp/nalu-ide-package/mac-arm64/Nalu.app`.
The packaged `Contents/Resources/cli/nalu.mjs` matched the source byte for byte.
Running it through the packaged app executable with `ELECTRON_RUN_AS_NODE=1`
returned `nalu 1.10.14` and exit code 0. This verifies packaging and CLI bootstrap;
it does not substitute for signed distribution or live model task acceptance.

## Live coding and change-review evidence

A live Nalu task ran through the installed full CLI, Electron runtime, and actual
IDE terminal in an isolated project with spaces in its path. It corrected two
modules: quantity multiplication in `price.mjs` and percentage conversion in
`invoice.mjs`. Nalu ran all five assertions successfully; an independent run also
passed and confirmed `invoice.test.mjs` was unchanged. The first driver expected
process exit instead of the interactive prompt; the completed idle session was
closed with SIGINT and verification finished successfully.

A live `/duo` run also produced correct Claude/Codex proposals, applied both fixes,
and passed independent tests. Its initial editor-refresh assertion failed while
another Electron test window was active. A focused hide/change/show regression
passed; a later live foreground check passed (see below). This initial run does not
count as a complete editor-refresh pass.

`NALU_IDE_GIT_TEST=1 electron tests/ide-smoke.cjs` passed against a real temporary
repository. It verified the branch name and opened staged and unstaged diffs for
the same file, confirming different content in each view.

Opt-in live task command (uses the configured Nalu account and network):
`NALU_IDE_LIVE_TEST=1 electron tests/ide-smoke.cjs`.
Add `NALU_IDE_LIVE_DUO=1` to include Claude and Codex proposals.
These checks exercise a small two-module fixture; they do not prove broad parity
with either external coding agent.

### Live failures retained as evidence

A subsequent duo run claimed files were fixed and tests passed without making
any tool calls. Independent assertions failed (`17 !== 46`). CLI 1.10.15 now
requires successful tool evidence for explicit file/repository coding requests,
retries unsupported claims, and marks the task incomplete after bounded retries.
This is a minimum evidence gate, not a proof that any arbitrary task is correct.

The first guarded live attempt then emitted malformed `read_filearguments` and
`edit_filearguments` payloads. It correctly reported unverified completion instead
of success. Complete adjacent JSON payloads in that observed form are now
recoverable; truncated input remains unexecuted. All 114 CLI tests pass, including
permission regressions; the focused 31-test subset also passes on Node 18 and 20.
The subsequent live run passed end to end on CLI 1.10.15. Both external proposals
were integrated through real tool calls, both modules changed, all five independent
assertions passed, the test file was unchanged, and the foreground editor displayed
`quantity` in the updated `price.mjs`. The session exited cleanly with `/exit`.
Evidence: `/tmp/nalu-ide-duo-recovery.log`; fixture and screenshot directory:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-Onq34H`.

The failed background/editor run and unsupported-success runs remain failures in
this record. One repaired fixture pass is not a model-quality consistency benchmark.

## Autosave and navigation acceptance

The editor now gives each dirty file its own autosave timer. A tab switch no longer
cancels a pending save, and closing a dirty tab saves first; failure or conflict
keeps the tab open. Search navigation is consumed once rather than reapplied on
every render. Monaco's editor is reused across tab switches, with closed models
disposed explicitly.

`NALU_IDE_SAVE_TEST=1 electron tests/ide-smoke.cjs` passed against the production
build. Real key input and filesystem assertions verified:

- Switching tabs before the autosave delay still saves the inactive file.
- Typing while a write is deliberately delayed persists both edits in order.
- An injected save failure keeps the dirty tab open and displays the error.
- Retrying close after the failure saves the complete content and closes the tab.
- Search-result navigation places typing on the requested line.
- Autosave and a round-trip tab switch preserve cursor position: sequential
  `a`, `b`, and `c` inputs appeared as `abc`, not reordered at the reveal location.

The intentional `Fixture save denied` log is expected failure-path coverage.
Evidence: `/tmp/nalu-ide-save-navigation.log`; screenshot and fixture directory:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-bQkwcF`.
Production build and TypeScript checks passed; existing Vite chunk-size warnings
remain. These checks extend editor reliability evidence, not model capability claims.

## Built-in Agent completion and approvals

The IDE's built-in coding Agent no longer treats repeated actions as verified
completion. It requires a successful recognized project check after an edit;
new edits and failed commands invalidate prior verification. Successful listings,
echo commands, masked failures, and commands that mutate after a check do not
qualify. Recognized commands cover common Node/package-manager, Python, Rust,
and Go checks, not arbitrary verification scripts.

The Agent and PC task ledger records completion only when the runner explicitly
emits a done event; a runner returning after an error records failure. Approval
prompts resolve as denied on cancellation, and late approvals cannot authorize
writes for a cancelled task.

All 27 IDE tests passed. Seven completion tests execute the actual Agent loop with
scripted model responses and local tool fixtures; three approval tests cover
cancellation and late clicks. Production build and TypeScript checks passed.

`NALU_IDE_AGENT_TEST=1 electron tests/ide-smoke.cjs` also passed. It uses the real
Agent UI and a fully intercepted local HTTPS fixture, repeatedly returns an
unsupported done action, then verifies a visible error, a failed task-ledger
record (never done), and unchanged file contents. No request goes to the live
backend. Evidence: `/tmp/nalu-ide-agent-test.log`; screenshot fixture directory:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-H6D9AH`.

Still needed: broader live built-in-Agent coding acceptance
and PC outcome verification. The completion guard recognizes common
checks; a command's successful exit alone is not a proof of arbitrary task quality.

## Running-command cancellation

Agent, PC shell, and AI Terminal commands now forward their abort signal through
the preload bridge to an owner-scoped main-process command job. Stop terminates
the process group on macOS/Linux, escalating after a grace period so descendants
that ignore TERM cannot keep running. Commands have a timeout and bounded,
UTF-8-decoded output. Window destruction and application quit also request job
cancellation; quit waits for the jobs to settle.

All 31 IDE tests passed, including real-process cancellation, an ignored TERM,
timeout, pre-cancelled invocation, and split Unicode output. Production build
and TypeScript checks passed. `NALU_IDE_COMMAND_TEST=1 electron tests/ide-smoke.cjs`
passed using the real renderer/preload and local model fixture: approve an
endless shell command, press Stop, assert no active command jobs and a cancelled
task-ledger record, and reject any completed record. The initial smoke failure
was an exact-text selector missing whitespace around the Approve button; the
selector now trims text. Evidence: `/tmp/nalu-ide-command-test.log`; screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-juPoIz/ide.png`.

This UI test uses an intercepted model response, not a live model. Windows
taskkill behavior, actual application-quit cancellation, and PC/AI Terminal
cancellation through their respective UIs remain unverified.

## AI Terminal outcomes and command execution

The AI Terminal now records failure when it reaches its step limit without an
accepted completion response. An immediate DONE claim or a claim following a
failed command cannot finish the task. A successful command and a subsequent,
standalone DONE response are required; DONE text inside a command is not treated
as completion. Cancellation takes precedence over stream errors in the ledger,
and a reply arriving after cancellation cannot launch another command.

Its shell wrapper no longer inserts a stray semicolon after a newline. The
working directory is passed through the executor rather than interpolated into
shell source, preserving paths with quotes, spaces, and shell substitutions.
Directory changes persist between commands in a single request.

All 38 IDE tests and the production build passed. Seven new tests cover rejected
completion claims, failure and recovery, step exhaustion, cancellation during
model response, and real Bash execution with literal path characters and cwd
tracking. `NALU_IDE_TERMINAL_TEST=1 electron tests/ide-smoke.cjs` passed against
the real UI/preload and intercepted model responses: a real failing command
followed by repeated success claims produces a visible incomplete result and a
failed task record, never done. Evidence: `/tmp/nalu-ide-terminal-test.log`;
screenshot fixture: `/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-dyEG7r`.

This is a minimum execution-evidence guard, not independent verification of an
arbitrary goal. Live AI Terminal task quality, Windows shell compatibility,
and directory persistence across separate requests still need work.

## Live built-in Agent acceptance

`NALU_IDE_LIVE_AGENT=1 electron tests/ide-smoke.cjs` passed with the actual Nalu
model and the built-in Agent UI. In an isolated temporary project it corrected
quantity multiplication in `price.mjs` and percentage conversion in `invoice.mjs`,
ran `node invoice.test.mjs`, and recorded completion. An independent invocation
passed all five assertions; the test file was unchanged and the editor reflected
the edits. The run recovered from an initially guessed missing `invoice.js` and
an `ls -la` command rejected by this fixture's command allowlist. This is one
bounded live acceptance case, not a comparative benchmark.

Only model requests reached the live backend, using the existing Nalu sign-in;
task-ledger writes stayed in the local test fixture. Shell execution was limited
to `node invoice.test.mjs`, and file writes to fixture paths. Evidence:
`/tmp/nalu-ide-live-agent.log`; responses, screenshot and files are under
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-RDEeuQ`.
This run preceded the stream-reader hardening below.

## Interrupted model responses

The IDE now rejects HTTP failures, server error events, malformed events,
unsuccessful completion events, and streams that disconnect without a successful
done event. Split UTF-8 and CRLF frames decode correctly. Cancellation interrupts
an idle reader; consumer callback errors propagate instead of being swallowed.
This prevents a complete-looking tool instruction in an incomplete response
from being executed by the Agent.

All 46 IDE tests and the production build passed. Eight stream tests cover those
failure cases and valid completion framing. The real Electron UI also passed
`NALU_IDE_STREAM_TEST=1 electron tests/ide-smoke.cjs`: a local stream supplied a
complete run action but disconnected before done; the IDE showed the stream
error, recorded failure, and executed no command. Evidence:
`/tmp/nalu-ide-stream-test.log`; screenshot fixture:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-1daNYZ`.

## Unsaved edit and tab recovery

The IDE now journals open-tab metadata and unsaved buffers in
`workspace-recovery.json` under Electron's user-data directory. Clean tab contents
are read fresh from disk on restore. Dirty buffers retain their original saved
baseline, allowing downtime edits to appear as conflicts without overwriting
either version. Missing files retain their dirty buffers with a read error.
Recovered edits pause autosave and show a review notice until explicitly saved.

Journal writes are serialized, synced to a temporary file, then renamed over the
previous snapshot, with file permissions 0600. Failed writes preserve the previous
journal and surface an error in the IDE. Invalid journals are not automatically
overwritten. Unchanged snapshots do not trigger redundant disk writes. Application
quit waits for queued journal writes as well as running-command cancellation.

All 53 IDE tests passed; seven recovery tests cover clean/dirty restoration,
downtime conflicts, writes completed before a crash, missing files, invalid
journals, write ordering and failed-write recovery. The final production build
and `NALU_IDE_RECOVERY_TEST=1 electron tests/ide-smoke.cjs` passed. The UI test
typed a draft, injected a save failure, waited for its durable journal, changed
the disk file externally, forcibly crashed the renderer, and relaunched it.
It verified restored text and the conflict, no automatic overwrite, an explicit
save, and removal of the saved draft from the journal.

Evidence: `/tmp/nalu-ide-recovery-test.log`; screenshot and journal fixture:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-1QKe2d`.
The intentional `Fixture save denied` output is expected. This proves renderer
crash recovery after a journal acknowledgment, not survival of every keystroke
during sudden power loss. Whole-process shutdown and Windows rename behavior
still need acceptance coverage.

## Save As for recovered and ordinary files

Save As is available from the command palette, recovery/error notices, and
Cmd/Ctrl+Shift+S. The native save dialog chooses the destination and handles
overwrite confirmation. Cancellation and write failures preserve the source
buffer; a successful write updates the tab path, name, and recovery journal.
Typing during a write remains dirty against the written snapshot. An already
open destination is rejected to protect its editor buffer.

All 54 IDE tests and the production build passed. The real Electron test
`NALU_IDE_SAVE_AS_TEST=1 electron tests/ide-smoke.cjs` recovered a draft after a
renderer crash and deletion of the original file, cancelled the first save
dialog, injected a write failure, and then successfully saved to a new path.
Assertions verified the original remained absent, the recovered text was saved,
the tab was renamed, and the new clean path was journaled. Dialog choices were
local fixtures; native platform dialog interaction itself was not automated.
Evidence: `/tmp/nalu-ide-save-as-test.log`; screenshot fixture:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-r2n7Gh`.
The missing-file and denied-write logs are intentional failure-path coverage.

## Reviewable Agent file approvals

Manual file approvals now show a read-only Monaco diff of the complete disk
version and proposed content, including full-file writes and new files. The
preview identifies files with unsaved editor buffers. Surgical edits are resolved
before approval so the displayed result matches the proposed write.

The Agent reads the file again after approval and rejects the change if the
original differs from the reviewed version. The same check protects a new-file
proposal when another process creates that path during approval. Permission and
other read errors are not treated as evidence that a file is new. Recovered
prose-based writes use the same approval path. Stale approvals invalidate prior
verification evidence and require the Agent to read and propose again.

All 58 IDE tests and the production build passed. Four new Agent-loop tests
verify full preview contents, stale existing-file rejection, new-file races,
and unreadable originals. `NALU_IDE_PREVIEW_TEST=1 electron tests/ide-smoke.cjs`
passed through the real UI with a local model fixture: it rendered the diff,
verified proposed code was present, changed the disk file before clicking
Approve, and verified rejection, preservation of the disk change, and failed
task status after unsupported completion claims. Evidence:
`/tmp/nalu-ide-preview-test.log`; screenshot fixture:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-fKN5XV`.

The final read/write pair is an optimistic check, not an atomic filesystem
compare-and-swap. Auto-run still intentionally bypasses the manual review UI.

## Comparative live coding tasks

The user authorized direct Codex and Claude Code baselines on three fresh
temporary fixtures. Nalu CLI 1.10.17 passed two of three; both baselines
passed three of three. Retained earlier Nalu attempts exposed malformed tool
calls, a one-item concurrency deadlock, and insufficient requirement coverage.
The resulting fixes recover complete duplicated tool names and keep explicit
coding tasks on the Code specialist. All 117 CLI tests and 58 IDE tests passed.

See [the comparison report](benchmarks/2026-09-06.md) and its linked JSON artifact
for exact versions, candidate outputs, grading history, limitations, and retained
failures. These small development fixtures do not prove broad parity. Nalu's
remaining failure is a nested-key filtering requirement that its public test did
not cover, despite the model claiming completion; deeper requirement verification
was the next concrete quality target.

## Requirements review before CLI completion

Nalu CLI 1.10.18 now reviews explicit coding tasks against the original request
before accepting completion, asks for focused checks of uncovered requirements,
and requires a fresh successful shell check after review. Later edits or failed
checks invalidate that evidence. Read-only tasks and explicit instructions not
to execute checks preserve the requested workflow. This gate requires execution
evidence; it cannot itself prove arbitrary semantic correctness.

The live review-enabled candidate passed all three development fixtures, matching
both retained baselines on this set. It generated additional checks for the
concurrency and configuration contracts. The updated comparison report retains
all earlier failures, generated checks and candidate source files. This remains
a development set, not proof of general parity on unseen tasks.

All 123 CLI tests and 58 IDE tests passed. The isolated Electron smoke test also
installed and launched CLI 1.10.18 through the real terminal and preload.
Evidence: `/tmp/nalu-benchmark-review.log`, `/tmp/nalu-cli-review-tests.log`,
`/tmp/nalu-ide-cli-118-smoke.log`; IDE screenshot fixture:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-aQdp51`.

## Unseen-task baselines and verification evidence

The frozen two-task comparison completed 1/2 tasks for Nalu CLI 1.10.18 and
2/2 for both Codex and Claude Code. Nalu's implementation checks passed, but
its Python verification workflow failed. See the
[unseen-task report](benchmarks/holdout-1-2026-09-06.md) for preserved first
attempts and separately labeled development retests.

CLI 1.10.19 improved malformed-tool repair but a manual audit found both added
checks still failed despite successful CLI exits. CLI 1.10.20 now requires a
recognized verification command; diagnostic printing cannot satisfy the gate.
Its retest completed the Python task, but malformed tool output prevented final
retry verification. The CLI rejected the model's unsupported success claim.
Both implementations and both generated checks passed independent reruns;
the retry agent workflow remains incomplete. General parity is unproven.

All 127 CLI tests and 58 IDE tests passed; `git diff --check` passed. Logs:
`/tmp/nalu-cli-check-tests.log`, `/tmp/nalu-ide-tests.log`,
`/tmp/nalu-holdout-check-gate.log`. The latest GUI smoke remains the recorded
1.10.18 run above; 1.10.20 has not been packaged or GUI-smoked in this step.

Separate source inspection found that Explorer renames refresh the tree without
retargeting open tabs. That editor reliability gap remains unresolved.

## CLI transport-marker recovery and live retry completion

CLI 1.10.21 recovers complete JSON following repeated identical tool labels and
the leaked `<|content_text|>` delimiter from the previous failed transcript.
Bare commands, truncated JSON and mixed labels remain unexecuted. Malformed
marker output requests repair. Regression tests verify this recovery preserves
normal permissions and executes the recovered command once.

All 131 CLI tests and 58 IDE tests passed. The real Electron smoke test installed
and launched 1.10.21 through its isolated terminal, covering terminal lifecycle
and editor conflict behavior. Logs: `/tmp/nalu-cli-marker-tests.log`,
`/tmp/nalu-ide-marker-tests.log`, `/tmp/nalu-ide-cli-121-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-ElEDyG/ide.png`.

A focused live retry-task retest completed successfully in 160 seconds. It
repaired an added test's faulty setup, then executed both tests successfully
before completing. Public, independent acceptance and independently rerun added
checks passed. See the [retained development retest](benchmarks/holdout-1-2026-09-06.md).
This is one known task, not new unseen-task parity evidence. No release package
or real user profile was changed.

## Explorer rename preserves open documents

Explorer now uses an in-app name dialog with visible errors. Renaming a file or
folder retargets its open tabs, active document and reveal path, preserving dirty
contents, saved snapshots, disk conflicts and recovery flags. Updated paths flow
into the recovery journal. Pending file opens cannot reintroduce old paths.

Saves and disk refresh reconciliation pause during rename until React commits
the new paths. If a save is already in flight, the dialog reports that the file
operation must finish and retains the proposed name for retry. Existing targets,
including dangling symlinks and destination tabs, are rejected. Stale folder-tree
requests are caught and cannot replace a newer tree after unmount or navigation.

All 61 IDE tests and the production build passed. The real Electron rename smoke
test verified existing-target preservation, a dirty file rename, a renamed folder's
open dirty child, recovery journal paths, saving after rename, typing and autosave
during a delayed rename, and refusal/retry during an in-flight save. Old source
paths were not recreated. `git diff --check` passed. Logs:
`/tmp/nalu-rename-unit.log`, `/tmp/nalu-rename-build.log`,
`/tmp/nalu-rename-smoke.log`. Final screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-tVesZZ/ide.png`.

An intermediate expanded smoke run timed out before typing into the newly opened
child editor. Explicit window/input focus and animation-frame synchronization
resolved the harness timing issue; the full expanded run then passed.

The filesystem destination check and rename are separate operations, so this is
not an atomic no-replace guarantee against external writers. A process crash
between disk rename and journal persistence is also not covered by this test.
Windows and case-only renames remain unverified. No release was installed.

## In-app file and folder creation

The Files toolbar and Explorer folder context menu now use a shared in-app
creation dialog instead of browser prompts. The dialog shows its destination,
keeps entered names and errors visible, guards duplicate submissions, and opens
new files in the editor. Escape cancels; focus returns to the initiating control.
It is rendered outside the drawer so the modal is not clipped by drawer bounds.

The main-process creation helper rejects empty names, parent-directory names,
path separators and null bytes. Exclusive file creation and nonrecursive mkdir
preserve existing entries and report name collisions without overwriting data.

All 62 IDE tests, the production build and `git diff --check` passed. The real
Electron smoke test verified toolbar file/folder creation, context-menu creation
inside the selected directory, new file tabs, invalid-name feedback, existing
file preservation, Escape cancellation and restored focus. It also launched the
bundled CLI in the real PTY and ran the existing terminal/editor smoke checks.
Logs: `/tmp/nalu-create-unit.log`, `/tmp/nalu-create-build.log`,
`/tmp/nalu-create-smoke.log`. Final screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-ujyE74/ide.png`.

An initial UI test found the correct visible validation error but queried an
unrelated alert elsewhere in the page. Scoping the assertion to the dialog
resolved that harness failure. No release package or real user profile changed.

## Move to Trash and unsaved-buffer recovery

Explorer deletion now uses an in-app Move to Trash confirmation and Electron's
OS Trash API. It no longer permanently removes files through recursive `rm`.
Trash failures leave disk contents and tabs intact and keep the dialog available
for retry. An in-flight save prevents the operation; saves and pending file opens
are paused while paths are removed.

Clean affected tabs close after success. Dirty tabs stay open as detached recovery
buffers with a Save As action. Ordinary saves and disk refreshes cannot recreate
or adopt the old path. The journal retains their text and detached state across
renderer restarts, even if another file later occupies the original path. Dirty
buffers are backed up before the Trash operation. A failed Save As retains the
draft and does not offer an ineffective ordinary-save retry.

All 64 IDE tests, the production build and `git diff --check` passed. The real
Electron smoke test moved only newly created temporary fixtures to the macOS
Trash. It verified cancellation, injected Trash failure and retry, dirty-buffer
preservation, no recreation on Save, durable recovery after a forced renderer
crash, failed/successful Save As, and closing a clean child tab after its folder
was trashed. Logs: `/tmp/nalu-trash-unit.log`, `/tmp/nalu-trash-build.log`,
`/tmp/nalu-trash-smoke.log`. Final screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-t4QhL6/ide.png`.

The crash test occurs after the updated journal is durable; disk mutation and
journal persistence are not a single atomic transaction. Windows/Linux Trash
behavior remains unverified. No release was installed and no pre-existing user
files were moved or deleted.

## Search request ordering and visible failures

Find in Files now tracks request generations. New queries, edits to the input,
project changes and unmounts invalidate older responses. Stale requests cannot
replace current results or clear the current loading state. Failed searches show
an error rather than an unhandled rejection or a misleading zero-results count.
Result grouping uses a Map, avoiding collisions with object prototype names.

All 64 IDE tests, the production build and `git diff --check` passed. The real
Electron renderer test used controlled delayed IPC replies to verify old/new
request ordering, clearing while pending, error display, grouping `__proto__`, and
switching projects before the previous search returns. The standard real CLI/PTy
and editor checks also passed. Logs: `/tmp/nalu-search-unit.log`,
`/tmp/nalu-search-build.log`, `/tmp/nalu-search-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-uwbyH2/ide.png`.

This validates renderer request ordering, not search completeness or throughput.
Obsolete backend searches still finish their traversal; cancellation and broader
file coverage remain separate work. No release was installed.

## Bounded text search and cancellation

The backend now searches regular UTF-8 text files regardless of extension,
including Makefiles, Dockerfiles, dotfiles and unfamiliar source extensions.
It skips NUL-containing/non-UTF-8 files, symlinks, special files and the existing
ignored directories. A reusable buffer bounds each file read to 2,000,001 bytes;
files over 2,000,000 bytes are skipped, including files that grow during reading.
Results remain capped at 300 matching lines. Missing root errors reach the UI.

Search uses cooperative AbortSignal checks between filesystem operations.
The main process owns one active controller per renderer, aborts superseded
searches, and cleans up on renderer destruction/crash. Clearing input, changing
projects and leaving the panel send cancellation through preload. Cancellation
does not interrupt an already pending OS filesystem call.

All 67 IDE tests, the production build and `git diff --check` passed. New backend
tests exercise extensionless/unusual text files, Unicode, binary/oversized files,
ignored directories, symlinks, the result cap, missing roots, and cancellation
before/during traversal. The real renderer/preload smoke test verifies cancellation
messages on clear/unmount plus the earlier stale-response/error cases. Its search
responses are controlled fixtures; filesystem traversal is tested separately.
Logs: `/tmp/nalu-search-backend-tests.log`, `/tmp/nalu-search-backend-build.log`,
`/tmp/nalu-search-backend-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-Cx0pa2/ide.png`.

This is not a large-repository throughput benchmark. Search still uses fixed
ignore directories rather than full Git-ignore semantics, and does not search
non-UTF-8 text or files above its size limit. Windows behavior remains unverified.

## Git diff lifecycle and error visibility

Selecting a changed file now opens a loading view immediately. Its initial diff
request and subsequent refreshes share a cancellable selection lifecycle, so a
closed or superseded request cannot reopen the review or replace a newer diff.
Project changes clear the previous diff, status and remote. Diff failures appear
inside the review pane. Failed stage/init actions now catch rejections and report
false results; operation notes wrap instead of truncating their details.

All 67 IDE tests, the production build and `git diff --check` passed. A real
renderer/preload test with controlled Git replies verified closing a pending
request, reviewing another file before the old reply arrives, switching projects
while a diff is pending, inline diff errors and a failed stage response. The
standard CLI/PTy and editor smoke checks also passed. Logs:
`/tmp/nalu-git-review-tests.log`, `/tmp/nalu-git-review-build.log`,
`/tmp/nalu-git-review-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-4wKUIU/ide.png`.

These controlled replies verify UI ordering, not remote GitHub operations.
Long-running mutation callbacks across a project switch still need a separate
audit: their completion can invoke an older loadGit closure. No commits, pushes,
sign-ins or remote account changes were performed for this test.

## Git operations stay with their originating project

Stage/init, pull and commit operations now use a project generation and operation
token. Retired callbacks cannot overwrite the current project's messages, clear
its busy state or refresh status through an older closure. Commit drafts are kept
per project while the panel is mounted, and a successful commit clears only the
submitted text; newer typing remains. Stage buttons are disabled during work.

Commit & Push now stops immediately if staging or committing fails. It only
attempts a push after a successful local commit and branch lookup, and preserves
the distinction between local commit success and push failure. Previously, ignored
stage/commit failures could allow a push of an older revision.

All 70 IDE tests, the production build and `git diff --check` passed. New backend
tests verify that stage/commit failures prevent subsequent commands and that push
failures retain the local commit result. A real renderer/preload test with delayed
simulated commits verifies project switching, no stale status refresh, current
draft preservation, newer typing during commit, and returning to an earlier
project's draft. Earlier diff race checks also passed.
Logs: `/tmp/nalu-git-operation-tests.log`, `/tmp/nalu-git-operation-build.log`,
`/tmp/nalu-git-operation-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-4Ntz81/ide.png`.

No real commits, pushes or account changes were made. Draft persistence across
panel unmount/restart and GitHub sign-in/clone callback lifecycles remain separate
work; these tests do not prove remote hosting integration or broad product parity.

## Durable project commit drafts

Commit drafts now persist per project in the app profile's local storage, with a
renderer cache that survives Source Control remounts. Successful commits remove
only the matching submitted draft. Storage errors retain the live text and a
visible warning, including after reopening the panel; a successful later write
clears the warning. Storage access is deferred so an unavailable store reports
an error rather than preventing the component from loading.

All 72 IDE tests, the production build and `git diff --check` passed. The real
Electron test verified panel remount, forced renderer-crash recovery, injected
storage quota failure, retained text/warning after remount, persistence retry,
and removal of the committed draft from storage. Previous project-switch and
newer-typing commit checks also passed. Commit responses were simulated; no real
commit, push, account operation or user profile change occurred.
Logs: `/tmp/nalu-draft-tests.log`, `/tmp/nalu-draft-build.log`,
`/tmp/nalu-draft-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-yLUOcp/ide.png`.

The first UI run stopped because the injected storage-failure script returned
a function that Electron could not serialize. Returning no value corrected the
harness; the complete rerun passed. This tests renderer-crash recovery, not
durability through sudden host power loss. No release was installed.

## File-open failures and focus ordering

Failed reads now leave the active editor intact and show a Retry open/Dismiss
message. Retrying uses the original path and can open a file that becomes available
again. Failed opens no longer produce unhandled promise rejections or install a
search-result reveal marker for a file that never opened.

Open requests track focus intent separately from path mutations. An older request
may finish into a background tab, but cannot steal focus from a newer open or tab
selection. Project changes invalidate pending reads so they cannot introduce tabs
from the old project after the switch. Rename/Trash guards remain in place.

All 72 IDE tests, the production build and `git diff --check` passed. The real
renderer/preload smoke test removed a listed file, verified the visible error and
unchanged current editor, recreated it and retried, then used delayed replies to
verify latest-open focus and project-switch invalidation. Standard CLI/PTy and
editor checks also passed. Logs: `/tmp/nalu-open-tests.log`,
`/tmp/nalu-open-build.log`, `/tmp/nalu-open-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-jCuoNL/ide.png`.

This does not cancel an in-progress filesystem read or validate large/binary-file
editor behavior. No release package or real user profile changed.

## Current CLI live integration rerun

CLI 1.10.21 completed the live two-module invoice fixture inside the latest built
IDE through the actual PTY. It fixed quantity multiplication and percentage tax,
preserved the provided test, added focused checks, corrected a floating-point
assertion in its added test, and obtained fresh passing verification before
returning to the prompt. The editor reflected the CLI's disk changes. Independent
reruns of both `edge.test.mjs` and `invoice.test.mjs` passed afterward.

All 131 CLI tests and 72 IDE tests also passed in this rerun. Logs:
`/tmp/nalu-current-cli-tests.log`, `/tmp/nalu-current-ide-tests.log`,
`/tmp/nalu-current-live-ide.log`. Live fixture and screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-zBsscz`.
This is a familiar integration fixture, not new unseen-task comparison evidence.

## Second unseen-task comparison

The frozen dependency-build task passed for both authorized baselines and failed
for Nalu CLI 1.10.21. Nalu timed out after five minutes; its public and independent
acceptance checks both failed. Codex completed in 65 seconds and Claude Code in
96 seconds. All public tests remained unchanged. See the
[full comparison and retained outputs](benchmarks/holdout-2-2026-09-06.md).

The failure exposes repeated unsuccessful debugging of a traversal bug, despite
the correct rejection of an unsupported verification claim. Improving failure
diagnosis is now a concrete CLI quality priority. The current evidence does not
prove the requested parity with Codex or Claude Code; the overall goal remains
unfinished. No baseline tools were updated, and no release was installed.

## CLI debugging reassessment and completion classification

CLI 1.10.22 tracks repeated failed verification commands and adds reassessment
feedback at failures two and five, including the actual failed output and a
request to trace the failing input through the implementation. Diagnostic prints
or successful edits do not reset that history; a successful same check does.
The prompts do not override permission or completion requirements.

The first development retest produced passing code but exposed an intent-detector
false positive on "depth-first order". CLI 1.10.23 restricts First/Next sequence
labels to line starts. A full CLI regression confirms that a verified technical
report can now complete, and the live retest entered requirements review normally.
It then timed out after a long model-response stall. Public and independent code
checks passed after both retests, but both workflows remain incomplete. The new
debugging prompts did not trigger in these passing-code attempts; their live
diagnostic benefit is not established. See the
[separate development retest evidence](benchmarks/holdout-2-2026-09-06.md).

All 135 CLI tests and the real isolated Electron smoke test passed. The smoke
installed and launched 1.10.23 via its terminal. Logs:
`/tmp/nalu-debug-tests.log`, `/tmp/nalu-debug-ide-smoke.log`,
`/tmp/nalu-debug-live.log`, `/tmp/nalu-debug-completion-live.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-s694Xd/ide.png`.
The original unseen-task scores remain unchanged. No release was installed.

## Content-based response inactivity

CLI 1.10.24 measures response inactivity from actual text, reasoning or tool
arguments. Previously every transport chunk reset the three-minute timer, so
heartbeat-only streams could remain alive until the ten-minute absolute deadline.
Heartbeats and empty deltas now leave the inactivity timer unchanged. Active
reasoning keeps the response alive, subject to the unchanged absolute deadline.

NALU_RESPONSE_IDLE_TIMEOUT_MS configures the inactivity limit (default 180000;
allowed range 1000–3600000 milliseconds). Inactivity failures report that cause
and do not automatically retry the stalled request. Existing incomplete-stream
handling prevents tool execution from failed responses.

All 137 CLI tests and the real isolated IDE smoke passed; `git diff --check`
passed. Controlled streams verify heartbeat/empty-event timeout, reasoning activity
across the idle interval, and existing absolute-deadline behavior. Logs:
`/tmp/nalu-idle-tests.log`, `/tmp/nalu-idle-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-RC4sRR/ide.png`.
This improves stalled-response handling, not backend inference latency, and does
not replace the retained failed live comparison results. No release was installed.

## Search cancellation and result limit

Search now exposes a Stop button and Escape shortcut while running, restores
input focus after stopping, and ignores late results from the cancelled request.
At 300 results it displays the shared backend limit and asks the user to refine
the query. The notice does not claim that additional matches necessarily exist.

All 72 IDE tests, the production build, and the isolated Electron search smoke
passed. The UI smoke verifies Stop and Escape cancellation IPC, late-result
suppression, input focus, the limit notice, and existing clear/error/project
switch behavior. The limit screenshot was visually checked for readable wrapping.
Logs: `/tmp/nalu-search-controls-tests.log`,
`/tmp/nalu-search-controls-build.log`, `/tmp/nalu-search-controls-smoke.log`.
Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-BUwD3t/search-limit.png`.
Controlled UI responses verify these states; backend cancellation remains
cooperative between filesystem calls. No release was installed.

## Verification freshness after shell commands

CLI 1.10.25 invalidates completion-review evidence after a non-verification shell
command, including successful commands. Previously a shell edit could replace
valid code with invalid JavaScript after a passing check and still exit zero.
An actual CLI regression reproduced that false success before the fix. It now
requires fresh verification; repair followed by a passing check can complete.
Dedicated read/list/search tools preserve evidence. Supported shell argument
aliases cmd, script and shell_command now count when running a valid check.

All 143 CLI tests and the isolated IDE smoke passed. Logs:
`/tmp/nalu-shell-review-tests.log`, `/tmp/nalu-shell-review-smoke.log`.
The smoke exercises the real CLI/PTy, visibility and mode switches, project
switching, exit/restart, editor conflicts and disk refresh. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-VG2TNk/ide.png`.

Command recognition remains a heuristic, not a proof of test coverage or absence
of mutations inside test scripts. Successful shell diagnostics also invalidate
evidence because their effects are not inferred. This closes a false-completion
path; it does not establish faster live completion or change benchmark scores.
No release was installed.

## Bounded text-file opening

The editor file-read IPC now uses a shared bounded reader instead of unrestricted
UTF-8 decoding. It accepts regular UTF-8 files up to 10 MiB, preserves BOMs and
line endings, handles Unicode across read boundaries, and permits symlinks to
regular files. It rejects NUL-containing binary data, invalid UTF-8, special
files and larger inputs with an explanation. Reads remain bounded if a file
grows after its initial size check. Nonblocking open prevents an idle FIFO from
waiting for a writer before the regular-file check.

The real UI uses these errors in the existing retry/dismiss banner while
preserving the active editor and avoiding an invalid new tab. Electron's IPC
error prefix is removed from that banner. Retrying after reducing an oversized
file opens it normally.

This is an editing limit, not a large-file viewer or encoding-conversion feature.
UTF-16 and other non-UTF-8 encodings remain unsupported; large-file paging,
aggregate workspace memory limits and Windows runtime behavior are unverified.

All 76 IDE tests and the production build passed. Filesystem tests cover exact
limit text, invalid encodings, byte preservation, a file growing during its
read, and a real FIFO without a writer. The isolated Electron smoke passed
binary/size errors, active-editor preservation, retry after shrinking a file,
existing missing-file retry, delayed-open ordering and project switching. The
final banner screenshot was visually checked. Logs:
`/tmp/nalu-bounded-read-tests.log`, `/tmp/nalu-bounded-read-build.log`,
`/tmp/nalu-bounded-read-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-KBsfQA/file-read-limit.png`.
No release was installed; this does not change the retained live CLI comparison.

## Bounded workspace recovery reads

Workspace restoration now runs at most four file reads concurrently instead of
launching every saved tab at once. Results retain their original tab order.
Unreadable clean tabs are omitted as before; unreadable dirty tabs retain their
drafts and error explanations. Retiring the recovery effect aborts scheduling
of further reads, including when workspace loading itself has not yet returned.
Already-issued filesystem IPC calls finish normally.

All 78 IDE tests and the production build passed. Controlled 24-tab restoration
checks the concurrency ceiling, out-of-order completion, failed reads, retained
drafts and ordering; cancellation checks that queued reads never start. The real
isolated Electron test force-crashes a renderer with an unsaved draft, adds 24
saved background entries to its recovery fixture, then reloads. All 24 tabs
return; the draft retains its conflict with externally changed disk contents,
and an explicit save clears the recovered draft from the journal.

Logs: `/tmp/nalu-recovery-queue-tests.log`,
`/tmp/nalu-recovery-queue-build.log`, `/tmp/nalu-recovery-queue-smoke.log`.
Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-3mN7Ye/ide.png`.
This bounds simultaneous recovery work, not final workspace memory consumption.
No release was installed or benchmark score changed.

## Assertion failures with successful process exits

A live dependency-task development retest with CLI 1.10.25 ended unsuccessfully
after 203 seconds at the 40-step limit. Public checks passed unchanged, while
independent acceptance rejected a false cycle on a shared dependency. Added
checks printed a console.assert failure and still exited zero. The failed run
and final sources are retained in the holdout-2 development-retest artifact.

CLI 1.10.26 treats that explicit assertion-failure output as failed verification,
even with exit zero. It cannot establish completion-review evidence, triggers
immediate guidance about throwing assertions, and counts toward repeated-check
reassessment. All 145 CLI tests passed, including an actual CLI process using
a console.assert failure followed by a success label and zero exit. Repair with
a throwing assertion plus a fresh passing check can complete normally.

The isolated IDE smoke also passed with CLI 1.10.26. Logs:
`/tmp/nalu-current-dependency-live.log`, `/tmp/nalu-assertion-tests.log`,
`/tmp/nalu-assertion-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-qTJO8E/ide.png`.
Output recognition remains heuristic and does not prove test coverage or detect
every framework's failure format. Live effectiveness of 1.10.26 remains
unverified. No release was installed.

## File context indexing lifecycle

The prompt's @ picker now clears old project paths when indexing starts and
stops scheduling directory reads after cancellation. Indexing uses an iterative
traversal with a strict 5,000-entry limit instead of a six-level depth cutoff
and a limit that could be exceeded by a large single directory. Workspace
refreshes rebuild the index. Loading, root errors, unreadable subfolders and
the entry limit are visible in the picker. Escape dismisses even an empty
picker, and Enter does not submit the prompt while that picker has no matches.

Unicode queries now work, and selecting a path containing JavaScript replacement
tokens such as $& inserts the literal filename. Keyboard selection is clamped
when the available results change.

All 81 IDE tests passed, covering deep nesting, ignored directories, root and
subfolder failures, Windows path separators, a directory exceeding the cap,
and cancellation during an outstanding read. This bounds retained index entries
and further traversal; it does not interrupt an already-issued directory IPC or
bound the size of an individual readDir response. Full gitignore handling and
large-repository throughput remain unverified.

The production build and isolated Electron context-picker smoke passed. The
test holds an old project's nested directory read, switches projects, releases
the obsolete result, and verifies no further traversal of that result. It checks
loading-state Escape dismissal and keyboard selection of a Unicode filename
containing $& without altering its text. The final visible-window picker
screenshot was checked for layout and readable selection.
Logs: `/tmp/nalu-context-index-tests.log`, `/tmp/nalu-context-index-build.log`,
`/tmp/nalu-context-index-smoke.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-0v3OmY/context-picker.png`.
No release was installed or live benchmark score changed.

## Quick open and local review artifact

Cmd/Ctrl+P opens a modal project-file picker with filename, path and subsequence
matching. Cmd/Ctrl+Shift+P opens commands, and the command palette exposes Open
file. The picker uses the bounded workspace index, displays up to 100 matches,
supports keyboard selection and Escape, and uses the existing file-open error
flow. Initial focus was corrected after the actual UI test exposed it. A later
test failure was traced to Monaco's nonbreaking display spaces; the screenshot
and editor content confirmed opening worked, and the assertion now normalizes
those display spaces.

All 83 IDE tests and the production build passed. The isolated quick-open smoke
passed Unicode selection, initial focus, native Escape, cancellation of pending
traversal, no-match state and a file disappearing before selection. Logs:
`/tmp/nalu-quick-open-tests.log`, `/tmp/nalu-quick-open-build.log`,
`/tmp/nalu-quick-open-smoke.log`. Visually inspected screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-ide-smoke-QfF0Xp/quick-open.png`.

An unsigned Apple Silicon review app was packaged at
`review-build/mac-arm64/Nalu.app`. All 105 build files and the bundled CLI match
the worktree build. Its executable runs CLI 1.10.26, and its packaged native
PTY spawns a shell successfully. `review-build/verification.json` records hashes;
`review-build/README.md` records scope and limitations. Packaging log:
`/tmp/nalu-review-package.log`. Normal packaged startup, installation, signing
and notarization are not verified. Nothing was installed or published, and
coding parity remains contradicted by the retained live results.

## Packaged main-process startup verification

`tests/packaged-startup.cjs` loads the review app's actual packaged main module,
preload and renderer together under Electron. It redirects Node home, profile
and Git/GitHub configuration to temporary directories, clears authentication
environment tokens, blocks HTTP requests and supplies a fixture folder dialog.
Application IPC handlers remain real. This protects the normal profile while
exercising packaged initialization rather than replacing the main handlers.

The test passed directory listing, quick-open selection, actual file reads and
Monaco display, CLI startup installation into the temporary home, PTY creation
through the preload/main bridge, and `nalu --version` through the installed
launcher. Installed CLI bytes match the packaged CLI. The screenshot was
visually inspected. Log: `/tmp/nalu-packaged-startup.log`. Screenshot:
`/var/folders/h3/9ttdy1ld439f8wmf41nzjrnm0000gn/T/nalu-packaged-startup-CwTTye/packaged-startup.png`.

The distributed ZIP is unchanged. Finder/Gatekeeper launch, real-profile
installation, authenticated network functionality and signing remain unverified.
This closes the isolated packaged-main test gap, not the coding-comparison gap.

## Backend completion reporting

The CLI README identified the sibling backend repository at `../train`. Inspection
of `api/chat.ts` found that its non-streaming fallback discarded finish reasons,
and streams with tool deltas but no terminal reason could still emit `done: ok`.
A controlled test of the actual handler reproduced both paths. The original
passed two of eight completion-contract cases; six failed.

A reviewed patch was prepared in `review-build/backend-fix` and applied to the
backend source after filesystem approval, with an exact-snapshot guard preserving
preexisting edits. All eight cases pass against the applied source. Valid stop
and tool-call completions retain their terminal reason; incomplete CLI responses
emit errors and cannot be turned into successful prose continuations. Backend
`git diff --check` passed. Details, exact patch, before/after snapshots and test
command are in `review-build/backend-fix/README.md`.

This is a local backend change only. No deployment occurred, no live model
configuration was changed, and the delivered desktop archive is unchanged.
Model reasoning quality and live performance remain unresolved.

The backend regression now also exercises the real CLI consumer. An intact JSON
file-write call is delivered inside an incomplete upstream stream or a
token-limited non-stream response. With the original handler, both cause actual
writes in an isolated fixture. With the applied handler, neither creates the
file and the CLI exits unsuccessfully. A successful tool-call completion still
writes the exact expected content and exits zero. All 11 handler/CLI checks
passed. Logs: `/tmp/nalu-backend-cli-before.log`,
`/tmp/nalu-backend-cli-after.log`. No live service or desktop archive changed.

## Controlled reasoning-setting experiment

Inspection found that the CLI sends think/thinkLevel flags but no reasoning
field; the inspected backend defaults that field to low even when increasing
the output budget for deep-think CLI requests. A separate experimental request
adapter asked the existing service for medium reasoning during one known
dependency-task run, without changing shipped code or production configuration.

CLI 1.10.26 timed out at 300 seconds. Public checks passed unchanged; independent
acceptance failed on a false cycle involving a shared dependency. The setting
was not promoted. The request audit proves medium was requested; upstream
application of that setting is not exposed by the live service. Full evidence,
adapter source/hash and candidate code are retained in
`docs/benchmarks/medium-reasoning-2026-09-07.json`, with interpretation in the
adjacent Markdown report. The desktop review archive remains unchanged.

## Backend preview deployment

The completion-reason fix is deployed at
https://nalu-laizjhhc1-mberry-hillpointecs-projects.vercel.app.
The release source matches the production deployment manifest for all 459
unchanged files; only `api/chat.ts` differs. Vercel completed the build and
deployment. A live invalid-message POST returned the expected HTTP 400 JSON,
confirming handler startup, without invoking an upstream model. The 11 controlled
handler/CLI regression checks remain the evidence for completion behavior.
Production inspection after this smoke check still resolved `n4lu.ai` to
`dpl_7KQbpfhosvZmUmUY9qhuKecYJbRM`. No production promotion occurred.

## CLI contract checks before implementation

Workspace CLI 1.10.27 requests contract tests before implementation for recognized
coding tasks, respecting read-only mode and verification opt-outs. All 149 CLI
tests pass. The isolated IDE smoke with real CLI/PTy also passes terminal
hide/show, mode and project switching, exit/restart, edit conflicts and disk
refresh (`/tmp/nalu-contract-first-ide.log`, fixture `nalu-ide-smoke-DXxIRg`).
The live request-adapter experiment passed the previously failing dependency task
in 193 seconds; see `docs/benchmarks/contract-first-2026-09-07.md` for complete
scope and limitations. The packaged review ZIP still contains CLI 1.10.26.

## Renderer boundaries and current review package — September 12

Desktop 0.1.15 enables the main renderer sandbox. Its preload uses Electron IPC;
filesystem and terminal work already run in main. All application IPC is now
registered through a shared sender check requiring the current main window, its
top frame and the exact application entry URL (hash navigation is permitted).
External main-window navigation and redirects are blocked, and external window
links must parse as HTTP/HTTPS URLs. This follows the supported sandboxed-preload
model in [Electron's documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox).

Four new boundary tests cover entry URLs, other windows/subframes, destroyed or
navigated senders, rejected handler/listener execution and external-link schemes.
All 87 IDE tests pass. TypeScript and the production build pass.

The main/preload/renderer startup test now supports the source build and packaged
app. Both passed real file listing/reading, quick open, editor display, PTY and
bundled CLI startup. Runtime checks additionally establish sandboxing, context
isolation, unavailable renderer Node access, rejection of filesystem IPC from a
separate window loading the same app/preload, and blocking external main-window
navigation while leaving the trusted file bridge usable. The source screenshot
was visually inspected. Negative-path IPC rejection logs are expected.

The final unsigned Apple Silicon review package is
`review-build/quality-0.1.15-cli-1.10.32/mac-arm64/Nalu.app`. It bundles CLI 1.10.32.
All 105 build files and CLI bytes match the verified local source build.
`verification.json` and `evidence/` under that review directory retain hashes,
test/build/package/runtime logs and the final packaged screenshot. The final
package passed the same startup and security checks in an isolated profile.
All 170 CLI tests and cross-repository source consistency also passed.

This extends runtime evidence, not a complete security or distribution audit.
Signing/notarization, normal-profile installation and authenticated operation,
Windows/Linux runtime, sustained use and wider security review remain open.
The old review ZIP remains an older artifact. No public release was deployed.

## Actual signed executable and durable project recovery — September 12

The current review package is
`review-build/quality-0.1.18-cli-1.11.2-signed/mac-arm64/Nalu.app`.
All 107 renderer/Electron files and bundled CLI bytes match the current build.
`signature-verification.json` records a valid strict nested Developer ID signature,
team 98N9B637F3 and hardened runtime. Gatekeeper rejects it as
`Unnotarized Developer ID`, and stapler finds no ticket. Signing is verified;
notarization, public distribution and normal-profile installation are unfinished.

`tests/signed-app-startup.mjs` launches the actual packaged executable without
replacing its main/preload code or `app.isPackaged`. It uses a temporary home,
profile, project and Git configuration, with no inherited account credentials.
It seeds the test project through the real persistence bridge; it does not
automate the macOS folder chooser. DevTools input drives the editor. The test
checks project/file display, quick open, the real PTY, installation and execution
of exact bundled CLI bytes, a real unsaved edit, forced process exit, recovery and
explicit saving. Executable, archive and CLI hashes remain unchanged throughout.

Visual review of the first 0.1.17 run revealed that the unsaved text recovered
while the project folder disappeared. The folder depended on a localStorage
preference, while the text used the durable journal. Desktop 0.1.18 now includes the
folder in the durable workspace journal, including backups before Trash. Legacy
journals remain compatible; a user-selected project is not replaced by an older
journal finishing asynchronously. Two new journal regressions fail before the
fix and pass afterward. All 90 IDE regressions and production build pass.

The stronger actual-executable test now requires both the project folder and
unsaved text after the forced exit. It passes on the signed 0.1.18 package; its
recovery screenshot was visually inspected and shows both. The existing renderer
recovery smoke also passes terminal lifecycle, mode/project switching, disk
refresh, unsaved recovery and conflict handling. Its deliberate denied-save log
is an expected negative-path check, not a runtime failure.

Both real Chromium integration cases pass using the signed executable and its
bundled CLI, including automatic viewport images, vision routing, original task
context, actual React input/persistence, assertions, network isolation and worker
cancellation. All 184 CLI regressions and 14 benchmark/shared execution-gate
checks pass. A separate integration verifies that a CLI terminating its visual
evaluation parent leaves a failed receipt, stops the child and skips grading;
that test makes no production model calls.

`verification.json`, `signature-verification.json`, `runtime-verification.json`
and `evidence/` in the current review directory retain the exact scope, hashes,
commands' output and screenshots. Older packages and failed attempts remain
separate. CLI 1.11.2 release copies and all cross-repository source checks match.
No production deployment, real-user installation or cross-platform acceptance
occurred. Live coding failures are described in
`benchmarks/visual-review-2026-09-12.md`; the full quality goal remains open.
