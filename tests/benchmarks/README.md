# Live coding-task benchmark

Run `node tests/benchmarks/run.mjs` to prepare isolated fixtures and confirm that
all public checks fail before implementation. Add `--live` to run the current
Nalu CLI against the actual backend using the existing sign-in. Use
`--case async-pool`, `--case nested-config`, or `--case query-refactor` to select
one task. Live runs can consume model quota and execute model-generated shell
commands with `--yolo`; run only in an appropriate local test environment.

The runner creates fresh projects under the system temporary directory. It does
not change this repository's source files or install a CLI. Each task has:

- A concrete prompt and broken/incomplete source files.
- A public test that the agent is instructed not to change.
- Additional acceptance checks written after the agent process exits.
- A retained CLI transcript, exit status, elapsed time, and JSON report.

Passing requires exit status zero, unchanged public tests, and passing public and
acceptance checks. A completion claim alone is insufficient. Each task has a
five-minute execution limit; checks have a fifteen-second limit. The benchmark
uses Nalu's `auto` routing, records the CLI version/hash and Node version, and
opts out of training capture. This is an isolated fixture convention, not an OS
sandbox: the CLI and model still have the permissions of the process running it.

The cases cover bounded asynchronous concurrency, recursive configuration merging,
and a multi-file query-encoding refactor. They are small JavaScript tasks with no
external dependencies. They do not measure UI usability, large repositories,
other languages, deployment work, or general agent parity.

For comparisons, run each candidate on fresh copies of the same case definitions
and prompt, with the same time budget and protected tests. Record the exact tool
and model versions, settings, and retries; do not replace failed attempts with
successful retries in aggregate results. Treat tool failures, timeouts, changed
tests, and failing acceptance checks as separate recorded outcomes. Repeated
runs and broader tasks are required before drawing general quality conclusions.

## Authorized comparison adapters

Use `--tool codex --live` or `--tool claude --live` after authorizing those agent
runs. Codex uses `exec`, an ephemeral session, the workspace-write sandbox, and
no user configuration overrides. Claude Code uses the actual executable at
`~/.local/bin/claude` (not Nalu's wrapper), nonpersistent print mode, no settings
sources or external MCP servers, and preapproved local file/shell tools. Both use
existing authentication and their installed default model; retain the transcript
header to identify the model selected. Neither adapter updates installed tools.

Invocation references: [Codex noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
and [Claude Code programmatic usage](https://code.claude.com/docs/en/headless).

`node tests/benchmarks/regrade.mjs /path/to/report.json ...` applies the current
acceptance checks to retained outputs without asking any candidate to try again.
The v2 checks add one-item input and synchronous mapper coverage to `async-pool`.
This extension was made after auditing a Nalu implementation and is applied to
all candidates equally; original results remain intact in their reports.

## First unseen-task suite

`--suite holdout-1` selects Python TTL-cache and JavaScript retry/cancellation
tasks. The Python case uses Python 3 through the protected Node test launcher.
Task definitions and checks were frozen before the first runs of all three
candidates. Subsequent attempts after fixes informed by those results are
**development retests**, not new holdout evidence.

Each runner now copies Nalu's source into its own candidate directory before
execution, so later workspace edits cannot change that run's CLI. Reports retain
the copied source hash and case-definition hashes.

## Second unseen-task suite

`--suite holdout-2` selects a two-module dependency planner/executor task. The
contract includes stable dependency order, shared work, reachable-only validation,
cycle detection, own-property task names, 16,000-node chains, sequential execution,
and original rejection identity. The public check is deliberately small; every
acceptance condition is stated in the task. A reference implementation passed
both graders before any candidate started. Definitions were then frozen for the
first Nalu, Codex and Claude Code attempts, each in a fresh temporary project.
Keep subsequent fix-informed runs separate from these first attempts.

## Full-stack artifact qualification

`node tests/benchmarks/qualify-fullstack.mjs review-build/<run-directory>` builds a fresh candidate copy and checks the real API and browser interactions. It records source/evaluator hashes and returns nonzero for failed or timed-out runs, build failures, API failures, or browser failures. See `docs/benchmarks/execution-qualification-2026-09-12.md` for controls and coverage. This checker does not identify a model from a label or automatically promote a model.


## Model-bound execution

`run-model-fullstack.mjs` accepts `NALU_EVAL_MODEL`, `TINKER_API_KEY` and optional `TINKER_BASE_URL` in its parent environment, fixes that model on the local proxy, runs the actual CLI in a fresh project, and independently qualifies the output. It does not forward provider credentials to the CLI environment. Results bind the requested model and evaluator source; simulated controls are not eligible for promotion. The training flywheel's agent lane invokes this runner through training/execution-gate.mjs. See `docs/benchmarks/model-execution-gate-2026-09-12.md` for validation and scope.

## Existing-app visual repair

`node tests/benchmarks/run-visual-repair.mjs` runs a live local reading-list repair
through the public Nalu API and independently checks desktop/mobile layout,
save/remove/reload behavior, labels and fixture file constraints. The task forbids
new tests and dependency installation. The file audit detects common executable
test filenames, package changes and added dependency trees; it does not prove
every possible shell action respected the task. Cancellation skips grading and
leaves a failed receipt. Each run preserves CLI and evaluator source.

`NALU_VISUAL_RUNTIME` selects an immutable packaged browser runtime.
`NALU_VISUAL_REASONING` and `NALU_VISUAL_MAX_TOKENS` select CLI request preferences.
`NALU_VISUAL_API` can select a Nalu-owned Vercel preview; account authorization is
sent only to the allowed Nalu origins. The receipt records the API origin,
preferences, request status, CLI hash and browser binding. A preview result does
not establish production behavior or production model identity. Fix-informed
retries of this fixture are development retests, not fresh holdout tasks.
