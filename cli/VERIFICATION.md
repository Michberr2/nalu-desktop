# CLI verification record

Current local version: 1.11.4. All 193 CLI regressions pass. The canonical CLI and
train's local release copy match. Desktop 0.1.23 bundles those exact CLI bytes in
a Developer ID signed macOS review app, with two passing real Chromium integration
cases and actual-executable PTY/CLI startup. Production autonomous coding remains
inconsistent. The package is not notarized or published. See
`../docs/IDE_VERIFICATION.md` and `../docs/benchmarks/visual-review-2026-09-12.md`.

CLI 1.11.4 fixes contradictory test-creation guidance for compound user
restrictions. An isolated API preview retest preserved the restrictions and
passed all twelve independent browser/layout/file checks, but ended at its
60-step limit after repeated verification. It remains an overall failed attempt.
The preview contains the API reasoning/token fix and public CLI 1.11.3; running
local CLI 1.11.4 against it does not update production or its public CLI asset.

## Reproducible checks

Run `npm run test:cli` from the repository root. The historical 1.10.15 review
below covered 114 passing tests on macOS with Node.js 22.22.0. The earlier
111-test suite passed on Node.js 18.20.8 and 20.11.0; its expanded 31 execution,
permission, and duo tests also passed on both older runtimes. This does not
establish that the entire latest suite passed on those older versions. The Node 18
binary was downloaded from the official nodejs.org distribution. Tests cover:

- Prompt parsing, delayed stdin, input limits, and subprocess exit codes.
- Long-session task boundaries, paired tool history, bounded concurrency, and
  draining in-flight parallel work after failure.
- Fragmented response streams, malformed responses, output limits, response
  deadlines, HTTP error handling, cancellation during retries, and print-mode
  exit when background descendants retain shell output pipes. A stubborn-shell
  test verifies SIGINT escalates to process-group termination.
- File reads, empty writes and deletions, ambiguous replacements, argument
  validation, literal replacement text, nested search globs, and explicit search-limit notices.
- Permission boundaries, scratch-directory symlinks, and shell examples that
  must remain answer content even with automatic approval enabled.
- Interactive EOF, multiline cancellation, prompt cleanup, streamed rendering, narrow banners, and removal of
  terminal control sequences from displayed content.
- Durable remote question IDs, answer polling, lease loss, and cancellation
  while waiting for an answer (using backend fixtures).
- Worker authentication, repository mapping, task execution, heartbeat
  cancellation, lost leases, pipeline completion, and remote output handling.
- Self-update validation, interrupted downloads, permissions, and symlink targets.
- The actual installer and publish scripts in temporary directories: successful
  installation, moving the installation, rejection of broken downloads, cleanup,
  and byte-for-byte release copies. Installer downloads use a local curl fixture.
- Stalled action announcements fail after bounded retries; AutoPilot cancellation
  during verification cannot turn into a success result.
- Swarm plan validation and interactive recovery from malformed planner output.
- Team plan validation and a CLI subprocess test that passes failed and blocked
  prerequisite statuses to the leader instead of marking them complete.
- Worker tool restrictions and final-report error handling, including no-tools
  verifiers that must not execute recovered calls.
- Local setup diagnostics and configuration validation without token disclosure.

`node --check cli/nalu.mjs`, `sh -n cli/install.sh`, `sh -n cli/publish.sh`, and
`git diff --check` also pass. The shared desktop repository passes
`npm run typecheck` and `npm run build`. Vite reports a non-fatal large-chunk
warning for the desktop bundle.

## Live and terminal observations

- The configured API at https://n4lu.ai returned the requested connection-check
  answer with a zero exit status. That request was slow; backend latency has not
  been resolved by these CLI changes.
- A live coding task in `/tmp/nalu-coding-smoke` read a fixture, replaced an
  incorrect subtraction with addition, ran its Node test, and returned an
  accurate success report. An independent test run passed. The first attempt
  exposed malformed tool calls, leading to recovery and failure-reporting fixes.
- Real terminal smoke tests verified startup, `/status`, and Ctrl+D exit.
- `nalu doctor` passes local runtime, shell, API configuration, token-presence,
  and directory-readability checks. It deliberately does not verify token validity.

- A second live coding task on 1.10.2 fixed multiplication in
  `/tmp/nalu-release-smoke/math.mjs`, ran its test successfully, and returned an
  accurate report. An independent test run passed. Waiting status appeared during
  the slow backend response, and recovered calls rendered as clean tool summaries.
  The subsequent 1.10.3 changes affect worker/goal orchestration, not this solo
  coding flow, and are covered by the orchestration regression tests.

- The live web-fetch tool retrieved readable text from example.com through the
  configured Nalu backend. Web-tool timeout, cancellation, authentication, and
  error handling are covered by additional regression tests.

- Final acceptance on CLI 1.10.13: a fresh live task in `/tmp/nalu-acceptance`
  read `average.mjs`, added the missing divide-by-length, ran
  `node --test average.test.mjs` successfully, and returned an accurate report.
  The source was held fixed during the run. An independent test run passed.

## Live orchestration acceptance (September 6, 2026)

Installed external tools: Claude Code 2.1.259 and Codex CLI 0.153.4.
Live requests used the configured Nalu backend and disposable `/tmp` fixtures.

| Scenario | Observed result |
| --- | --- |
| `/duo` read-only | Both external CLIs proposed the correct subtraction-to-addition fix. Source and fixture file list stayed unchanged. |
| `/duo --rounds 2` | Both CLIs completed both rounds and cross-checked the other proposal. Nalu synthesized them. An incorrect claim that the fix was already applied prompted stronger integration instructions; a fresh live review then correctly said it was not applied. |
| `/duo` coding | Nalu integrated both proposals, corrected the source, recovered from a BSD sed command error, and ran the existing test successfully. |
| `/duo` live cancellation | SIGINT after five seconds interrupted both external proposals and exited without starting integration. |
| `/team` coding | Worker failure and blocked dependencies were shown; the leader recovered, fixed the source, ran the tests, and wrote a summary. |
| `/swarm` coding | Workers failed; the leader fixed the source but stopped at a malformed test-call announcement. This exposed a completion-handling defect, now covered by a regression that requires unsuccessful exit after repeated malformed calls. |
| `/swarm` fresh read-only review | Worker and leader completed successfully and accurately reported the corrected source. |

Independent test runs passed for all three edited fixtures: positive numbers,
empty input, and mixed signs. Their existing test files were unchanged. The
read-only duo fixture retained the original subtraction bug as expected.

Additional regressions cover partial external output with unsuccessful exit,
empty proposals, split Unicode, timeouts, cancellation cleanup, read-only arguments,
failed-member exclusion, cross-critique carry-forward, integration/fallback
cancellation ledger status, and model-generated paths not becoming attachments.
The attachment regression came from a live proposal containing `// before`,
which previously caused an unintended folder attachment.

These are small acceptance fixtures, not evidence of production-scale coding
quality. The backend still sometimes produces malformed calls or unsuitable
worker assignments. Team output also attributed leader recovery work to the
original worker names. Clear failure handling helps, but these model-quality
issues prevent calling orchestration uniformly reliable. Live coding was not
repeated after the final malformed-call guard; that guard has subprocess coverage.

## Verification limits

Linux has not been exercised in this environment.
Fresh external-account onboarding and phone/backend worker integration have not
had full live end-to-end verification here. External tools may maintain their own
configuration, session, and plan files; read-only evidence above concerns the
project fixtures.
No production publish or deployment has been performed.

## Pipeline failure reporting — 1.10.30

The website runs exposed failed commands piped into tail being reported as exit 0. Bash now runs with pipefail, retaining an upstream failure status and preventing success-only `&&` steps. Explicit `||` recovery and shell option changes remain under command control. Two real-shell regressions failed before the change; all 157 CLI tests pass after it. This corrects command evidence; it does not prove complete website generation or make a passing build sufficient for task completion.
