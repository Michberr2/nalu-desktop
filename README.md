# Nalu Desktop

A clean, signed, easy-to-download desktop IDE — VS Code / Cursor / Codex-class — that brings the whole Nalu app to your computer and lets you actually code in it. Wolf-head icon, dark + gold, uncluttered.

**Status:** planning.

- 📐 **[Build Plan →](docs/NALU_DESKTOP_PLAN.md)** — the full research-backed plan: stack, layout drawings, design system, AI-agent architecture, code-signing to avoid malware warnings, and a phased roadmap.

## The short version

- **Electron** shell (Chromium + Node) — same engine as VS Code and Cursor.
- **Reuses the existing Nalu web app** (chat, all specialists, Studio, Map, AutoPilot) via a shared package — one codebase, two shells (web + desktop).
- **Real IDE:** Monaco editor, file tree, tabs, split panes, integrated terminal, command palette, git.
- **AI coding agent** (read files, edit with diffs, run commands, approve/undo) powered by Nalu's own models.
- **Signed + notarized** on macOS and Windows so it downloads and installs with **no malware / "unidentified developer" warnings**.
- **~$220/yr** total to ship download-clean on macOS + Windows + Linux; everything else is free/open-source.
