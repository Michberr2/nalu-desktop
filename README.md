# Nalu Desktop

A clean, signed, easy-to-download desktop IDE — VS Code / Cursor / Codex-class — that brings the whole Nalu app to your computer and lets you actually code in it. Wolf-head icon, dark + gold, uncluttered.

**Status:** v0.1 — runnable. The IDE shell is built (exact Nalu look & feel).

- 📐 **[Build Plan →](docs/NALU_DESKTOP_PLAN.md)** — the full research-backed plan: stack, layout drawings, design system, AI-agent architecture, code-signing to avoid malware warnings, and a phased roadmap.

## Run it

```bash
npm install
npm run dev      # launches the Electron app (Vite dev server + Electron window)
```

Build / package:

```bash
npm run build    # typecheck + build renderer, electron main & preload
npm run dist:mac # signed .dmg   (needs Apple Developer ID — see the plan §7)
npm run dist:win # signed .msi   (needs Azure Trusted Signing — see the plan §7)
```

To use Nalu AI in the app: sign in on n4lu.ai, then paste your session token in **Settings** (gear icon).

## What's in v0.1

- **Exact Nalu look & feel** — byte-for-byte the train dark+gold theme tokens; wolf-head branding.
- **File-tree explorer** (open any folder), **Monaco editor** with tabs and a matching Nalu theme, dirty-dot + ⌘S save.
- **Integrated terminal** (real shell) — ⌘\`.
- **⌘K command palette** (cmdk).
- **AI coding panel** — Chat / Agent / Edit modes streaming from Nalu's specialists; **Edit** proposes a full-file change you Apply or Reject.
- **Hardened Electron** — contextIsolation on, nodeIntegration off, all OS access through an audited preload bridge.

Next (per the plan): LSP intelligence, cross-file search, git, node-pty for full terminal interactivity, agent mode (edit→run→verify), and code-signing wired into CI.

## The short version

- **Electron** shell (Chromium + Node) — same engine as VS Code and Cursor.
- **Reuses the existing Nalu web app** (chat, all specialists, Studio, Map, AutoPilot) via a shared package — one codebase, two shells (web + desktop).
- **Real IDE:** Monaco editor, file tree, tabs, split panes, integrated terminal, command palette, git.
- **AI coding agent** (read files, edit with diffs, run commands, approve/undo) powered by Nalu's own models.
- **Signed + notarized** on macOS and Windows so it downloads and installs with **no malware / "unidentified developer" warnings**.
- **~$220/yr** total to ship download-clean on macOS + Windows + Linux; everything else is free/open-source.
