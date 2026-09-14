# Desktop 0.1.23 runtime and dependency upgrade

The signed macOS arm64 review app runs Electron 44.3.0, Chromium 152.0.7977.78
and Node 24.20.0. The previous 0.1.22 review app used Electron 32.3.3. The package
now declares macOS 13.0.0 as its minimum, matching the
[Electron 44 requirement](https://www.electronjs.org/docs/latest/breaking-changes#removed-macos-12-support).
No installed user app or public release was replaced.

## Changes

- Pin Electron 44.3.0 and electron-builder 26.15.3. Keep the native rebuilding
  utility in development dependencies; `node-pty` remains a runtime dependency.
- Upgrade Vite to 8.3.0, its React plugin to 6.1.1 and Electron plugin to 1.1.2.
  The ESM Vite configuration uses `rolldownOptions`; Electron main and preload
  output remain CommonJS. Remove the unused renderer Node API plugin.
- Upgrade Monaco to 0.56.0 and use its exported worker paths. Override its pinned
  DOMPurify 3.4.8 dependency with patched 3.4.15. Keep this explicit override
  until Monaco's dependency supplies the patched version itself.
- Use Electron's current console-message event details. Browser assertions see
  console errors emitted both during initial page loading and after interaction.
  Warnings alone do not fail the error assertion.
- Preserve Chromium sandboxing in development startup, including startup initiated
  by a preload build. `NALU_DEV_PROFILE` selects an isolated development profile;
  a separate HOME is still needed to isolate CLI configuration and account files.
- Complete the Settings native modal introduced in 0.1.21/0.1.22: focus stays
  inside, Escape and backdrop close it, visible labels identify account fields,
  and the close control remains available in short windows. In 0.1.22, dialog
  padding exposed scrolling content above the sticky header. Moving padding into
  the body fixes the gap. The new check fails against that earlier signed app.

## Verification on September 13, 2026

Evidence is retained in
`review-build/quality-0.1.23-cli-1.11.4-signed/`, including hashed source snapshots,
logs, screenshots and actual-executable receipts.

| Check | Result and scope |
| --- | --- |
| TypeScript and production build | Pass; final rebuild restores production output after development testing. |
| Package bytes | All 109 desktop build files and CLI 1.11.4 match the local production build. |
| IDE regressions | 91 pass with the updated dependencies. |
| CLI regressions | 193 pass under the standard Node 22 test runner. CLI source is unchanged. |
| Actual signed app | Startup, quick open, real keyboard editing, native PTY, exact bundled CLI installation/execution, Settings-to-CLI request wiring, forced-exit project/unsaved-edit recovery and explicit saving pass. |
| Settings accessibility/layout | Modal semantics, persistent input labels, Tab/Shift-Tab containment, shortcut isolation, Escape/focus restoration, pointer dismissal and short-window scrolling pass. Top/bottom screenshots inspected. |
| Language workers | Real JSON and TypeScript diagnostics appear for invalid files and clear after external corrections. Screenshots retained. |
| Packaged browser | Both real Chromium integration cases pass, including interactions, persistence, assertions, console errors, screenshots, network isolation, cancellation and actual CLI image forwarding. |
| Development startup | Actual Vite configuration starts the renderer and real PTY with an isolated HOME/profile. The recorded process command preserves sandboxing. No hot-reload claim. |
| Dependency audit | 25 known affected packages before the toolchain cleanup; zero after it, including development dependencies. This registry audit does not establish complete application security. |
| macOS signature | Strict nested Developer ID signature and hardened runtime pass. Gatekeeper rejects the unnotarized app; stapled ticket absent. |

The actual-executable check records runtime versions from the executable, rather
than inferring them from package.json. It checks the executable/archive/CLI hashes
before and after the run. The browser check asserts the expected Electron version.

Reproduce the main runtime checks after building and signing the review package:

```sh
NALU_EXPECT_ELECTRON=44.3.0 node tests/signed-app-startup.mjs \
  review-build/quality-0.1.23-cli-1.11.4-signed/mac-arm64/Nalu.app/Contents/MacOS/Nalu
NALU_EXPECT_ELECTRON=44.3.0 \
NALU_BROWSER_TEST_RUNTIME="$PWD/review-build/quality-0.1.23-cli-1.11.4-signed/mac-arm64/Nalu.app/Contents/MacOS/Nalu" \
  node --test tests/browser-worker.integration.mjs
node tests/dev-startup.mjs
```

Development testing writes development bundles. Rebuild production before comparing
package bytes against the current `dist` and `dist-electron` directories.

## Retained unsuccessful verification attempts

The full CLI suite was also attempted using the signed executable as its Node test
runner. Several fixtures use `process.execPath` as a fake browser interpreter,
while the browser transport deliberately removes `ELECTRON_RUN_AS_NODE` from the
child environment. These fixtures consequently launch real Electron workers
instead of their fake Node scripts. The attempt failed and its identified process
tree was terminated. Its log is retained; no 193-test Electron-hosted pass is
claimed. Actual Electron-hosted CLI and browser behavior pass the separate
packaged integration tests.

The first development attempt timed out on a debugger call. A second recorded
responsive debugger calls but failed to find the renderer because the harness
expected `127.0.0.1`; the plugin normalizes that address to `localhost`. The final
check accepts either loopback hostname on the actual Vite server port and passes.
The failed receipts remain alongside the successful one.

The autonomous completion experiment `visual-repair-XGjRn0` remains rejected.
It passed twelve independent behavior/layout/constraint checks but exhausted
60 model requests repeating verification and exited unsuccessfully. Its proposed
completion feedback was not promoted. Runtime and dependency work does not resolve
that separate coding reliability gap.

Normal-profile authentication, installation/upgrades, notarization, public
distribution, Windows/Linux runtime acceptance, sustained use, broader
accessibility and reliable unfamiliar application generation remain open.
