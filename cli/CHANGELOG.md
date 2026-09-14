# Nalu CLI task constraints — 1.11.4

- Compound restrictions such as “do not install dependencies, contact external
  services, or create/modify tests” no longer trigger an instruction to add tests.
  Unrelated prohibitions and explicit requests to add tests remain distinct.
- Initial and completion-review guidance make new tests conditional on need and
  permission in the original request. Existing verification and completion gates
  remain enforced. Natural-language recognition is not filesystem enforcement.
- All 193 CLI regressions pass, including the observed failure and positive
  controls. A live preview attempt with 1.11.3 passed browser checks but created
  prohibited tests; it is rejected in a separate retained constraint audit.

# Nalu CLI model preferences — 1.11.3

- Reasoning and token-limit flags/environment overrides now reach CLI API
  requests, including remote worker execution. Explicit overrides win over saved
  desktop preferences. Task reasoning keywords win over saved reasoning.
- Existing terminal sessions reload preferences at the next task. Invalid values
  fail with actionable errors. Disabling web search excludes and blocks the two
  web tools; it is not a shell network restriction.
- All 188 CLI regressions pass. Desktop 0.1.19's actual signed executable also
  passes Settings UI → disk configuration → installed terminal CLI request
  verification, plus real browser integration and crash recovery. These are
  tooling checks, not a claim of reliable autonomous application generation.

# Nalu CLI automatic visual observations — 1.11.2

- Browser actions automatically attach the current viewport to the next model
  request. The image retains the original coding task and the action that produced
  it. Routing stays on vision even when diagnostic notes follow the image.
- Browser observations report missing stylesheets, unloaded resources, unlabeled
  controls, overflow and page exceptions. These are diagnostics, not a complete
  accessibility or feature audit.
- Screenshot opt-outs are honored, and only the latest image payload is retained.
- All 184 CLI tests and both real browser integration cases pass. Production
  coding reliability remains incomplete; retained live attempts include unfinished
  verification and unsupported completion claims.

# Nalu CLI local browser verification — 1.11.0

- Desktop-hosted CLI sessions can test local web apps through isolated Chromium:
  inspect controls, click, fill, select, press keys, reload, resize, capture actual
  screenshots, and assert behavior. Screenshots reach the vision route for review.
- UI coding tasks require fresh browser behavior evidence after the final edits
  and shell checks. Failed review assertions must be rerun successfully; an
  unrelated passing assertion does not erase a known failure.
- Browser actions follow CLI permissions, are unavailable in read-only sessions,
  and stop on cancellation, timeout, or turn completion. The worker has no account
  profile or preload bridge and only reaches explicitly selected loopback origins.
- Real Chromium acceptance covers React state, trusted input, keyboard submission,
  persistence, filters, labels, overflow, exceptions, blocked requests, screenshots,
  and a complete scripted CLI repair workflow. These tests verify the tooling;
  fresh live model results are a separate requirement.

# Nalu CLI verification feedback — 1.10.32

- A shell command or edit after a passing completion-review check immediately
  requests fresh verification. Cleanup belongs before the final check; it no
  longer silently invalidates evidence and surprises the agent at completion.
- The real CLI regression failed before the change and passes afterward.
  The stale-evidence guard remains enforced. All 170 CLI tests pass.

# Nalu CLI longer coding tasks and continuation — 1.10.31

- Coding tasks allow 120 model/tool round-trips; read-only and ordinary tasks
  retain 40. `--max-steps` and `NALU_MAX_STEPS` support explicit limits of 1–1000.
- Continuing an unfinished coding task preserves the original requirements,
  reasoning mode and verification opt-outs, and requires fresh completion review.
- Compound constraints such as “do not add or modify tests” are recognized.
- A real CLI fixture implements 45 modules and passes unchanged independent
  acceptance. All 169 CLI tests pass. Live application reliability remains under
  evaluation; more execution steps are not proof of task completion.

# Nalu CLI pipeline status — 1.10.30

- Bash commands enable `pipefail`: a failed test/build piped into `tail` is reported as failed instead of inheriting the formatter's successful exit status.
- Explicit `||` recovery still works. Pipelines that deliberately stop upstream readers early can report SIGPIPE; use explicit handling when that is intended.
- Two real-shell regressions failed before the change; all 157 CLI tests pass afterward. Full website capability remains unproven.

# Nalu CLI malformed-response recovery — 1.10.29

- Long repeated tool-name sequences without an executable call now request
  repair instead of entering completion review. Malformed responses are omitted
  from subsequent model context; the terminal transcript retains the raw output.
- Two actual-process regressions failed before the change. All 154 CLI tests
  pass afterward, including clean-call recovery and bounded failure when no
  repair arrives. Local train release copies are synchronized.
- The full-storefront retest still failed: this run used unknown text-call labels
  such as write{...}, produced no implementation and misdiagnosed missing files.
  The recovery fix is not evidence of successful website generation.

# Nalu CLI test-creation opt-out — 1.10.28

- Explicit requests not to add, write or modify tests suppress test-creation
  guidance both before implementation and during completion review. Existing
  verification can still run when permitted.
- Three actual-process regressions failed before the change; all 152 CLI tests
  pass afterward. The local train release copies are synchronized, and the
  cross-repository consistency checker passes. No production deploy occurred.

# Nalu CLI contract checks before implementation — 1.10.27

- Recognized coding tasks request executable contract checks before implementation,
  including interactions between requirements. Read-only mode and explicit requests
  to skip verification do not receive this instruction. Completion review remains.
- The isolated request-adapter experiment completed the known dependency task in
  193 seconds with unchanged public tests and passing independent acceptance.
  Its generated checks reject both the original stubs and the prior faulty
  implementation. This is one development retest, not unseen parity evidence.
- All 149 CLI tests and the IDE smoke with the actual CLI/PTy passed. The existing
  desktop review ZIP still bundles 1.10.26; 1.10.27 is the workspace CLI source.

# Nalu CLI assertion-aware verification — 1.10.26

- Recognized verification commands that print console.assert failures cannot
  establish completion evidence even when the process exits zero. The first
  failure requests throwing assertions and inspection of the actual cause;
  repeated failures now participate in debugging reassessment.
- All 145 CLI tests and the isolated IDE smoke passed. The known dependency
  task retest on 1.10.25 remains a recorded failure: public checks passed,
  acceptance failed, and the CLI reached its step limit after 203 seconds.

# Nalu CLI verification after shell commands — 1.10.25

- A successful non-verification shell command now invalidates earlier completion
  review evidence: shell edits need a fresh passing check, just like file-tool
  edits. Dedicated file inspection tools preserve existing evidence.
- Completion review recognizes the same cmd, script and shell_command aliases
  that the shell tool executes, avoiding unnecessary rejection of valid checks.
- All 143 CLI tests and the isolated IDE smoke passed.

# Nalu CLI response inactivity detection — 1.10.24

- Heartbeats and empty stream events no longer reset response inactivity.
  Actual text, reasoning and tool arguments keep active work alive.
- Adds NALU_RESPONSE_IDLE_TIMEOUT_MS, default 180000 milliseconds, alongside
  the unchanged absolute response deadline. Inactivity failures report their
  cause and do not automatically repeat the stalled request.

# Nalu CLI completion description fix — 1.10.23

- Restricts First/Next sequence-label detection to the beginning of a line.
  Technical descriptions such as "depth-first order" and "dependencies first,
  then dependents" no longer trigger repeated action-announcement nudges.
- All 135 CLI tests passed, including a full CLI completion-review regression
  using the live failure's wording. The isolated IDE smoke test also passed.

# Nalu CLI repeated-failure reassessment — 1.10.22

- Tracks repeated failures of the same recognized verification command during
  explicit coding tasks. At failures two and five, supplies the actual output
  and requests fresh inspection of the test, input, control flow and root cause.
- Diagnostic printing and successful edits do not erase failed-check history;
  a successful run of the same verification command resets it. Review prompts
  remain bounded and do not change completion or permission requirements.
- All 133 CLI tests passed, including an actual CLI fixture verifying that the
  next model request receives real failed-check evidence. The isolated IDE
  smoke test installed and launched this version through the terminal.

# Nalu CLI transport-marker recovery — 1.10.21

- Recovers complete JSON calls after repeated identical tool labels and the
  leaked `<|content_text|>` delimiter seen in live verification failures.
- Bare commands, truncated JSON, and mixed tool labels remain unexecuted;
  malformed marker output now requests a clean call instead of being accepted
  as a final answer. Recovered calls retain normal argument and permission checks.
- All 131 CLI tests passed, including permission enforcement and exactly-once
  execution for this format. The isolated Electron smoke test installed and
  launched this CLI through the real IDE terminal successfully.

# Nalu CLI verification command gate — 1.10.20

- Requires recognized project test/build/lint/type/syntax checks for completion
  review. Successful diagnostic commands no longer satisfy that gate after a
  failing check. Subsequent edits and failures continue to invalidate evidence.
- Review guidance calls for added checks in the project's language/runtime and
  named test files, followed by the project checks.
- Verified through 127 CLI tests, including the live failure sequence in which
  a diagnostic command exits zero while a generated check remains broken.
- This command classification is a minimum verification gate, not proof that a
  test suite covers every requirement or that an arbitrary script is correct.

# Nalu CLI malformed-call repair — 1.10.19

- Detects mixed tool-name tokens such as `bashbashedit_fileedit_file{...}` and
  requests a clean call rather than guessing an executable action or accepting
  a completion claim.
- Successful tool execution resets the bounded repair allowance, so an earlier
  formatting issue does not consume all later retries. The overall step limit
  remains in force.
- Requirements review now asks the model to inspect failing check setup as well
  as implementation, without weakening required assertions.
- Verified through 126 CLI tests. Original unseen-task failures and development
  retests are recorded separately.

# Nalu CLI requirements review — 1.10.18

- Explicit coding tasks review the original requirements before completion,
  including behavior omitted by the provided tests.
- Completion requires a fresh successful shell check after that review. Later
  edits or failed shell checks invalidate the review evidence. Unsupported
  repeated completion claims fail after a bounded retry.
- Read-only requests and explicit instructions not to run tests preserve their
  requested workflow.
- Verified through 123 CLI tests; live outcomes are recorded separately. A
  successful shell exit is an execution gate, not proof of arbitrary task quality.

# Nalu CLI coding-task routing — 1.10.17

- Keeps explicit file/repository coding tasks on the Code specialist throughout
  their tool loop, preventing tool-result text from rerouting them to Math or
  another unrelated specialist. Explicit `/agent` selection takes precedence.
- Generic requests continue to use automatic routing.
- Verified through 117 CLI tests, including request-body checks before and after
  a tool result. Live benchmark results are recorded separately.

# Nalu CLI live tool-call recovery — 1.10.16

- Recovers complete calls whose tool-name token was duplicated by the live model,
  such as `bashbash{"arguments":{"command":"node public.test.mjs"}}`.
- Keeps incomplete bodies and labels embedded in unrelated words unexecuted;
  normal permission checks still apply to recovered calls.
- Verified through 115 CLI tests. Live benchmark attempts and comparison results
  are tracked separately; this change does not turn failed tasks into successes.

# Nalu CLI coding evidence update — 1.10.15

- Explicit file/repository coding tasks retry unsupported completion claims when
  no successful tool result exists, and report failure after bounded retries.
- Recovers the complete malformed `read_filearguments:{...}` family observed in
  live IDE integration; truncated or nonadjacent arguments remain unexecuted.
- Clears Electron's runtime bootstrap flag before launching child programs.
- Verified through 114 CLI tests; desktop live acceptance is recorded separately
  in docs/IDE_VERIFICATION.md, including failed model runs.

# Nalu CLI orchestration verification — 1.10.14

- Rejects failed external proposals even when they contain partial stdout; preserves
  Unicode across output chunks and bounds captured output.
- Prevents model-generated proposal paths and code-comment markers from causing
  automatic file attachments. Direct user file attachments remain supported.
- Shows read-only integration accurately and preserves cancelled task status
  during both duo integration and solo fallback.
- Strengthens the lead's distinction between proposed edits and verified results.
- Surfaces worker failure details and rejects repeated malformed named tool calls
  instead of treating them as successful completion.
- Adds live Claude/Codex duo, cross-critique, cancellation, team and swarm evidence.
  See VERIFICATION.md for outcomes and remaining model-quality limits.

# Nalu CLI reliability update — 1.10.13

This release improves the local coding workflow, interactive use, automation,
and worker orchestration while retaining the single-file, zero-dependency CLI.

- Preserves complete prompts and slow piped input; rejects invalid flags and
  oversized input clearly. Adds `--no-stdin` for automation.
- Adds `nalu doctor` for local setup checks without network requests or token
  disclosure, with actionable configuration and authentication errors.
- Rejects incomplete streams and malformed tool arguments before execution.
  Recovers the nested call syntax observed in live coding tasks and hides it
  from rendered answers. Repeated non-execution exits unsuccessfully.
- Adds response deadlines, waiting status, cancellable web tools, and bounded
  retries. Ctrl+C cancels backoff, remote questions, and stubborn process groups.
- Fixes empty file writes, text deletion, replacement-type validation, nested
  search globs, and explicit reporting of incomplete searches.
- Preserves real task boundaries during history compaction and drains active
  parallel work after a failure.
- Keeps shell examples as answer text and checks resolved scratch-directory
  destinations before granting automatic write approval.
- Improves narrow-terminal banners, EOF handling, prompt cleanup, and display
  sanitization for terminal control sequences.
- Validates swarm/team plans, respects worker tool restrictions, and reports
  failed or blocked tasks accurately. Goal verification receives tool evidence.
- Validates staged updates before replacing an installation, preserves executable
  permissions, and cleans up failed downloads. Supports isolated installation
  with `NALU_INSTALL_DIR` and `NALU_NO_MODIFY_PATH=1`.

Run `npm run test:cli` for the regression suite. See [VERIFICATION.md](VERIFICATION.md)
for tested versions, live checks, and verification limits. These are local source
changes; publishing to the production download remains a separate operation.
