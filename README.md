# Nalu Desktop

Nalu Desktop combines a local coding workspace with Nalu chat, account, team and task features. The desktop, mobile and web apps are separate implementations coordinated through the shared backend.

**Current source: desktop 0.1.28 / CLI 1.11.4.** The macOS review app runs Electron 44.3.0 and requires macOS 13 or newer. It is Developer ID signed; notarization and public distribution are unfinished. Windows and Linux package targets are configured, but current runtime acceptance has not been established on those platforms.

## Run locally

Use Node 22.12 or newer for development.

```sh
npm ci
npm run dev
```

Sign in from Settings. Open a project folder to use the editor, terminal and coding tools.

`NALU_DEV_PROFILE=/absolute/path npm run dev` selects a separate development profile. To isolate the terminal CLI and account files as well, use a separate `HOME`; `node tests/dev-startup.mjs` does both for its acceptance check. Development startup keeps Chromium's sandbox enabled.

## Implemented workflows

- Monaco editor, file tabs, saving, external-change conflicts and recovery of unsaved work and the project folder.
- File creation, rename and Trash workflows; project search, quick open and command palette.
- Native interactive terminals with a bundled Nalu CLI, Git operations and GitHub integration.
- Auto interprets tasks and selects tools, alongside manual Chat, Agent, PC, Edit and AI Terminal modes with approval, Stop, file-bound edit previews and retained drafts. See [mode behavior and verification](docs/MODE_CONTROLS.md).
- Painted pastel, Focus and Scenic appearances, task starters for building, existing code and everyday work, and direct access to Files, Search, Changes, Activity and Team.
- A desktop Nalu companion with her original face, an always-visible ball, contact-driven play, grounded digging strokes, conversation, live local/account task status, optional voice, treats and resting animation. Find Nalu in Settings or the tray centers her on the current display. Closing the workspace leaves her available; Quit exits the app. See [desktop experience](docs/DESKTOP_EXPERIENCE.md).
- Live Chrome preview in PC mode with clickable scaled page images, unique observed element targeting, text replacement, scrolling, approval and Stop. Chrome uses a persistent Nalu profile; sign-ins in your other Chrome profiles are separate.
- Shared account, team and task activity.
- Isolated Chromium tools for local website interaction, screenshots and behavioral checks in desktop-hosted CLI sessions.
- Desktop reasoning, response-limit and web-search preferences synchronize to the terminal CLI. Explicit CLI flags override saved preferences; existing sessions read changes at their next task.

The main renderer is sandboxed, and its OS bridge checks the originating window and document. Settings supports keyboard focus containment, Escape, visible field labels and scrolling within small windows. These are tested boundaries and workflows, not a full security or accessibility audit. Live autonomous coding remains inconsistent; passing tool regressions does not establish reliable completion of unfamiliar applications.

## Verify and package

```sh
npm run test:cli
npm run test:ide
npm run build
npm run check:sync
npm run test:browser
```

Browser and desktop runtime checks require a graphical macOS session. Cross-repo checking requires the sibling `nalumobile` and `train` checkouts.

```sh
npm run dist:mac
npm run dist:win
```

Distribution requires the appropriate platform signing and notarization credentials. The current signed macOS review package and its byte hashes, signature assessment, runtime logs and screenshots are under `review-build/release-0.1.28-complete/`. Gatekeeper reports that package as unnotarized. See the [runtime upgrade evidence](docs/RUNTIME_UPGRADE.md) for dependency, development and packaged-app verification.

See [verification evidence](docs/IDE_VERIFICATION.md), the [full quality goal](docs/QUALITY_GOAL.md), [CLI documentation](cli/README.md), and the original [build plan](docs/NALU_DESKTOP_PLAN.md). No 10/10 readiness or competitor-parity claim follows from the current test results.

The Mac app now downloads signed updates and restarts automatically when work is safe to pause. Older builds need one manual upgrade. See [desktop updates](docs/DESKTOP_UPDATES.md) for release assets, verification and rollout requirements.
