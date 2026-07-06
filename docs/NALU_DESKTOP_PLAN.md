# Nalu Desktop — Build Plan

*A clean, signed, easy-to-download desktop IDE — VS Code / Cursor / Codex-class — that carries the whole Nalu app onto your computer and lets you actually code in it. Wolf-head app icon, dark + gold, uncluttered.*

Research-backed (6-track deep dive, 2026 sources). This is the plan to build from.

---

## 1. What we're building (the goals, restated)

| Your ask | What it means technically |
|---|---|
| "A desktop app you download and it goes right on your computer" | Native installers: signed `.dmg` (macOS), signed `.exe`/`.msi` (Windows), `.AppImage`/`.deb` (Linux). Double-click, done. |
| "Without malware or shit / easy download" | **Apple notarization + Windows code signing on every build** so Gatekeeper and SmartScreen open it silently — zero "unidentified developer" scares. |
| "Same app as train, but desktop" | Reuse the existing Nalu web app (chat, all specialists, Studio, Map, AutoPilot) **as-is** via a shared code package — one codebase, two shells. |
| "Like an IDE / VS Code / Codex where I can code" | Real code editor (Monaco), file tree, tabs, split panes, integrated terminal, command palette, git — plus an **AI coding agent** (read files, edit with diffs, run commands) powered by Nalu's own models. |
| "Nalu wolf head as the app logo" | Wolf-head icon across the `.app`/`.exe`, dock/taskbar, title bar, splash, and About. |
| "Super clean" | One accent color (Nalu gold), generous spacing, VS Code/Zed/Linear-grade polish, nothing cluttered. |

---

## 2. The stack (decided — no hedging)

**Verdict: Electron, not Tauri.** Two research threads liked Tauri's tiny binaries, but they optimized for engineering elegance, not *your* priorities. For a Cursor-style IDE that (a) wraps a graphics-heavy app (three.js, fabric, pdf.js), (b) needs a terminal + run-code + language servers, and (c) must **not** trip malware warnings, Electron wins on the three things that matter: **fewer AV false positives** (a known fingerprint beats an unknown small binary), **consistent Chromium rendering** for the Studio's WebGL/canvas/PDF, and **Node-in-the-main-process** so pty/ripgrep/language-servers just work. Cursor is Electron. VS Code is Electron. That is not a coincidence.

| Layer | Pick | Why |
|---|---|---|
| **Shell** | **Electron 38** (Chromium 140 / Node 22) | Node in main → terminal/run-code/LSP subprocesses are trivial; established fingerprint = fewer SmartScreen/Defender false positives. |
| **Editor** | **Monaco 0.55** + `@monaco-editor/react` | VS Code's own editor. ~90-language highlighting built in; the only mature LSP path. |
| **Language intelligence** | **monaco-languageclient 10.7** + `@codingame/monaco-vscode-api` | Real autocomplete / diagnostics / hover / go-to-def / rename by bridging actual language servers. |
| **Terminal** | **`@xterm/xterm`** + addons + **`node-pty`** | A real shell, out of the box, in Electron. |
| **Layout / docking** | **dockview 7** | Tabs + split panes + floating panels in one zero-dependency lib — the whole IDE frame. |
| **File tree** | **react-arborist** | Virtualized 10k+ nodes, drag-drop, inline rename — the VS Code sidebar equivalent. |
| **Command palette** | **cmdk** | Tiny, ubiquitous, keyboard-first. |
| **Cross-file search** | spawned **`ripgrep --json`** | Exactly what VS Code does; stream results with throttled batching. |
| **Code sharing** | **pnpm workspaces + Turborepo** | 2026 monorepo default; free remote cache via Vercel. |
| **macOS signing** | **Apple Developer ID + notarization** | Gatekeeper opens silently. Cert valid ~5 yr. |
| **Windows signing** | **Azure Trusted Signing** (~$10/mo) | Cloud HSM-backed OV signing, no hardware token to babysit. |
| **Auto-update** | **electron-updater** (Squirrel) | Battle-tested delta updates, staged rollouts, GitHub Releases feed. |

Everything except the two signing certs is MIT/BSD → **$0 in licenses.** Accepted trade-off of Electron: ~100 MB installer, ~250 MB idle RAM. Neither causes malware warnings (Slack, Figma, VS Code, Cursor all ship this way), and Linux comes almost free because it's the same Chromium.

---

## 3. Project structure (one monorepo, two shells)

```
nalu/                          # pnpm workspaces + Turborepo
├─ apps/
│  ├─ web/                     # the EXISTING Vite site → deploys to Vercel UNCHANGED
│  └─ desktop/                 # the new Electron IDE
│     ├─ electron/
│     │  ├─ main.ts            #  Node: window, menu, updater, lifecycle
│     │  ├─ preload.ts         #  contextBridge — the ONLY renderer↔Node bridge
│     │  └─ ipc/               #  pty · fs · search(rg) · lsp · git · agent-runner
│     ├─ src/                  #  Vite renderer: imports shared packages + the IDE UI
│     └─ build/                #  wolf-head icons, entitlements.plist, notarize hook
├─ packages/
│  ├─ core/                    # @nalu/core     — agentApi, agentTools, types, brandKit (pure TS)
│  ├─ workspace-ui/            # @nalu/workspace-ui — Studio/chat/map/cards/panels (React)
│  ├─ platform/                # @nalu/platform  — capability interface: fs/shell/dialog
│  │                           #                   web impl (remote/no-op) + electron impl (IPC)
│  └─ ide/                     # @nalu/ide       — Monaco/dockview/arborist/xterm/cmdk shell
│                              #                   (desktop-only; quarantines the Monaco/LSP churn)
├─ turbo.json
└─ pnpm-workspace.yaml
```

**One prerequisite refactor, done first, in a single PR (so web and desktop can't drift):**
1. Replace the ~12 hardcoded `fetch('/api/...')` calls with a single `API_BASE = import.meta.env.VITE_API_BASE ?? ''` → web stays same-origin, desktop points at `https://n4lu.ai`.
2. Add a CORS allow-list on the Vercel functions for the desktop renderer origin (+ allow the `Authorization` header, incl. preflight).
3. Auth is already a **bearer token in localStorage**, not cookies — so cross-origin desktop→API calls work with zero cookie/SameSite pain. This is the single biggest enabler; the web deploy stays byte-for-byte unchanged.

> **Cloud vs local split:** the model always plans in the cloud (existing Vercel functions, keys stay server-side — the binary only ever holds the user's bearer token). File reads/writes, search, terminal, and running code happen **locally** on the user's machine. Files never have to leave the computer.

---

## 4. Layout drawings

### 4.1 The main window — "super clean" default

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ●○○   🐺 Nalu            ⌘K  Search or run a command…              ⤓ updates   – ▢ ✕ │  ← custom title bar (36px), gold wolf mark, centered command bar
├──┬───────────────────────┬──────────────────────────────────────────┬───────────────┤
│  │ EXPLORER          ⋯   │  index.ts ✕   App.tsx •   README.md ✕     │  🐺 NALU      │  ← editor tabs (unsaved = • gold dot)
│🐺│  ▾ my-project         │ ┌──────────────────────────────────────┐ │  ─────────    │
│  │    ▸ src              │ │  1  import { create } from './core'  │ │  Ask, edit,   │  ← AI agent panel
│📁│    ▸ public           │ │  2                                   │ │  or run.      │    (collapsible)
│  │      package.json     │ │  3  export function main() {         │ │               │
│🔍│      README.md        │ │  4    const app = create()          │ │  › refactor   │
│  │                       │ │  5    app.start()          ▏gold ci  │ │    this file  │
│⑂ │                       │ │  6  }                                │ │               │
│  │                       │ │                                      │ │  [ diff view ]│
│🧩│                       │ └──────────────────────────────────────┘ │  + 12  − 3    │
│  │                       ├──────────────────────────────────────────┤  ┌─────────┐  │
│⚙ │                       │ TERMINAL   PROBLEMS   OUTPUT       + ⌄ ✕  │  │ Approve │  │  ← approve AI edits/commands
│  │                       │ ~/my-project ❯ npm run dev               │  └─────────┘  │
│  │                       │ ▸ vite v5  ready in 240ms                │  ───────────  │
│  │                       │ ❯ █                                      │  ▢ chat  ▢ agent│
├──┴───────────────────────┴──────────────────────────────────────────┴───────────────┤
│ ⑂ main ↑2   ✓ 0  ⚠ 1   Ln 4, Col 18   UTF-8   TypeScript   Nalu Reason ●     ⌘K help │  ← status bar (24px)
└──────────────────────────────────────────────────────────────────────────────────────┘
   ↑ activity bar 48px       ↑ side panel (resizable)      ↑ editor group        ↑ AI panel 340px (resizable)
```

**Activity bar icons (left, 48px):** 🐺 Nalu home · 📁 Explorer · 🔍 Search · ⑂ Source control · 🧩 Studio (docs/site/image/video/carousel) · ⚙ Settings. One column, generous, gold highlight on the active item — nothing more.

### 4.2 The AI coding agent panel (Codex / Cursor-style)

```
┌─────────────────────────────┐
│  🐺 NALU                     │   Modes (segmented, top):
│  ┌────────┬────────┬───────┐ │   • Chat   — ask about the codebase
│  │  Chat  │ Agent  │ Edit  │ │   • Agent  — multi-step: edit → run → verify
│  └────────┴────────┴───────┘ │   • Edit   — Cmd-K inline edit on a selection
│                              │
│  @src/core.ts  @App.tsx  +   │ ← @-mention files for context
│  ───────────────────────     │
│  You: make main() async and  │
│  add error handling          │
│                              │
│  Nalu ▸ I'll update core.ts: │
│  ┌──────────────────────────┐│
│  │ core.ts            + 8 −2 ││ ← proposed diff, inline
│  │  - export function main( ││
│  │  + export async function ││
│  │  +   try {               ││
│  │  +     const app = …     ││
│  └──────────────────────────┘│
│  ┌─────────┐ ┌─────────────┐ │
│  │ Apply ✓ │ │ Reject  ✕   │ │ ← every write previewed; you approve
│  └─────────┘ └─────────────┘ │
│  ───────────────────────     │
│  ▸ ran: npm test  (2 passed) │ ← terminal actions gated behind approval
│                              │
│  ┌──────────────────────────┐│
│  │ Ask Nalu, or / for tools ││ ← composer; picks the right specialist
│  └──────────────────────────┘│
│   Nalu Reason · Auto ▾       │ ← model/specialist selector
└─────────────────────────────┘
```

### 4.3 Welcome / no-folder-open state (clean, inviting)

```
┌──────────────────────────────────────────────────────────────┐
│                                                                │
│                          🐺                                    │
│                     Nalu  Desktop                              │
│              Code, create, and ship — with Nalu.               │
│                                                                │
│     ┌────────────────────┐   ┌────────────────────┐           │
│     │  Open folder…       │   │  Clone repo…        │          │
│     └────────────────────┘   └────────────────────┘           │
│     ┌────────────────────┐   ┌────────────────────┐           │
│     │  New file           │   │  Open Nalu Studio   │          │
│     └────────────────────┘   └────────────────────┘           │
│                                                                │
│   Recent                                                       │
│   ▸ ~/train                              2h ago                │
│   ▸ ~/side-project                       yesterday             │
│                                                                │
│                    Press ⌘K for anything                       │
└──────────────────────────────────────────────────────────────┘
```

### 4.4 Command palette (⌘K)

```
        ┌───────────────────────────────────────────────┐
        │ ⌘K  ›                                          │
        ├───────────────────────────────────────────────┤
        │  ⌁  Ask Nalu to edit this file…                │  ← AI actions first
        │  ⌁  Explain the current selection              │
        │  ─────────────────────────────────────────     │
        │  📄 Go to File…                        ⌘P       │
        │  ⑂  Git: Commit…                                │
        │  ▸  Terminal: New Terminal            ⌃`        │
        │  🧩 Studio: New Website                         │
        │  ⚙  Preferences: Color Theme                    │
        └───────────────────────────────────────────────┘
```

---

## 5. Design system — dark + gold, taken straight from Nalu

These are the app's **real** tokens (from `globals.css`), so Desktop matches the web app exactly.

| Token | Value | Use |
|---|---|---|
| `canvas` | `#0B0C10` | window / editor background (near-black, cool) |
| `panel` | `#11141C` | side panels, title bar, AI panel |
| `panel2` | `#13151B` | secondary surfaces, hover rows, terminal |
| `ink` | `#EDEDED` | primary text |
| `dim` | `#8E8E8E` | muted text, inactive icons, line numbers |
| `accent` (**gold**) | `#AF8C56` | the ONE accent — active tab, cursor, run button, unsaved dot, agent highlights |
| `glass` | `rgba(255,255,255,.06)` | hairline borders, dividers |

**Typography.** UI: **Inter** (13px base, 12px in dense chrome). Code: a monospace with ligatures — **JetBrains Mono** (default) or the user's choice; 13–14px, 1.6 line-height. One display weight for the wolf wordmark.

**Spacing & density.** 4px base grid. Activity bar 48px, status bar 24px, title bar 36px, tab strip 36px. Panels resizable with a 6px drag handle. Generous padding (12–16px) inside panels — the "clean" feeling comes from whitespace + exactly one accent color, never a second hue.

**Chrome.** Custom frameless window; on macOS keep the native traffic-lights inset (`titleBarStyle: 'hiddenInset'`), on Windows draw minimal min/max/close. Rounded 10px window corners where the OS allows. Subtle 1px `glass` borders, no heavy shadows.

**Wolf-head branding.** App icon (`.icns` / `.ico` at all sizes) from `wolf-icon.png`; wolf mark top-left of the title bar and in the AI panel header; wolf splash on cold start; wolf in About. The pack-of-wolves build animation from the web app is reused for long AI/agent tasks.

---

## 6. AI coding agent — architecture (the "Codex" part)

**Principle: the model plans in the cloud; file & exec actions happen locally, behind approval.** No keys ever ship in the binary.

- **Model gateway (reuse):** the existing Vercel functions (SSE streaming, 300s max, tinker text + HF-router vision) at `https://n4lu.ai/api`. Desktop calls them with the bearer token. The **holistic intent router** and all **specialists** (Nalu Reason, Code, Science, Math…) come along for free, so the agent already picks the right brain per task.
- **Agent loop (renderer):** streams tokens from the gateway, parses tool calls, dispatches them to local handlers, feeds results back — until done.
- **Local tools (Electron main, over audited IPC — never in the cloud):** `read_file`, `write_file` / `apply_diff`, `list_dir`, `search` (ripgrep), `run_terminal` (node-pty), `git_*`, `run_tests`. These slot into `@nalu/core`'s existing `agentTools` registry behind `@nalu/platform` — the same registry the AutoPilot pipeline builder already uses, so **the IDE tools are just new nodes in a system you've already built.**
- **Context builder:** open files + current selection + workspace tree + LSP symbols + recent diffs → prompt. Add ripgrep/embedding retrieval for big repos in v1+.
- **Four modes:** (a) ghost-text completion, (b) Cmd-K inline edit, (c) chat-with-codebase, (d) autonomous **Agent** (multi-step edit→run→verify with a diff-review UI).
- **Safety/approval:** every write is previewed as a diff; terminal commands gated behind approval with a configurable auto-approve allow-list; each step checkpoints (git stash) for one-click undo. (Mirrors Zed's Agent Panel / Cursor's approval model; Zed's 2026 Agent Client Protocol is a future interop option.)

---

## 7. Ship it clean — code-signing & distribution (the "no malware" plan)

**macOS** — cost **$99/yr** (Apple Developer Program):
1. Developer ID Application certificate (valid ~5 yr).
2. Sign with **hardened runtime + entitlements**, then **notarize** via `notarytool` (2–20 min), then **staple** the ticket into the `.dmg`.
3. Result: Gatekeeper opens it silently — no "unidentified developer."

**Windows** — cost **~$120/yr** (Azure Trusted Signing, ~$10/mo):
1. Cloud HSM-backed OV code signing — no physical token to manage. (OV via HSM is now mandatory; EV certs are ~$250–400/yr and, note, **stopped instantly bypassing SmartScreen in 2024** — don't overpay expecting that.)
2. Sign **both** the app `.exe` **and** the installer. Prefer **MSI** over hand-rolled NSIS (trips SmartScreen less).
3. SmartScreen reputation accrues over real downloads — sign every build with the *same* cert, submit installers to Microsoft, ramp volume. Electron's known fingerprint accelerates this.

**Linux** — `$0`: AppImage + `.deb`, no signing gate.

**Distribution:** GitHub Releases (or S3 + CloudFront) hosts the signed artifacts and the `latest.yml` electron-updater feed; a simple download page on n4lu.ai links the signed installers directly. Auto-update is silent/delta after first install.

**Total cash cost to be "download-clean" on all three OSes: ~$220/yr.** Everything else is free.

---

## 8. Roadmap (phased, shippable at each step)

### MVP (~weeks 1–6) — "Nalu Desktop, signed and downloadable"
- Monorepo extraction + `API_BASE`/CORS refactor + `@nalu/platform` capability interface.
- Electron shell rendering the existing Nalu app: bearer login, all chat/Studio/generation working cross-origin (SSE verified).
- Open-folder → react-arborist tree → Monaco open/edit/save via Node `fs`.
- Integrated terminal (xterm + node-pty). Command palette (cmdk).
- **Wolf-head app icon, dark+gold theme, the clean layout in §4.**
- **Signed + notarized mac `.dmg` and signed Windows installer; auto-update feed live.** (Linux follows for free.)

### v1 (~weeks 7–14) — "A real coding IDE"
- LSP for TS/JS (typescript-language-server) + Python (pyright): diagnostics, completion, hover, go-to-def, rename.
- Cross-file search panel (ripgrep `--json`, streamed).
- dockview docking: split editors, tabbed groups, movable panels.
- Git basics (status / diff / stage / commit).
- **AI agent v1:** chat-with-codebase that reads files, proposes diffs, applies with preview, and runs commands behind approval.
- Auto-update hardened (delta, staged rollout).

### v1+ (~weeks 15+) — "Cursor-grade"
- Ghost-text inline completions + Cmd-K inline edit from Nalu models.
- **Agent mode:** autonomous edit→run→verify loop with diff-review UI + per-step checkpoint/undo.
- More language servers on demand (rust-analyzer, gopls, clangd) with download + lifecycle management.
- Bundled Node/Python sidecar so users run code with no runtime installed.
- Optional Open VSX extensions, theme/settings sync, Linux GA.

---

## 9. Week-1 go/no-go spikes (prove the architecture before committing)

All five green = the whole plan is de-risked:
1. Electron loads the Nalu web app + bearer login + **one cross-origin SSE generation call** succeeds.
2. **xterm ↔ node-pty** round-trip in a real shell.
3. **Monaco + typescript-language-server** autocomplete working.
4. A **signed + notarized mac build** opens with **zero Gatekeeper warning**.
5. A **signed Windows build** via Azure Trusted Signing installs cleanly.

---

## 10. Top risks & how we kill them

| Risk | Mitigation |
|---|---|
| **AV/SmartScreen "malware" warnings** (your #1 goal) | Electron's known fingerprint > small binaries; sign *everything* with one consistent cert; notarize on mac; submit to Microsoft; prefer MSI; ramp downloads to build reputation. |
| `node-pty` native ABI packaging | electron-rebuild in CI per Electron version × OS; pin Electron; use prebuilds; sign native binaries. |
| `@codingame/monaco-vscode-api` churn (most fragile dep, 100+ pkgs) | Version-lock the whole Monaco/LSP cluster inside `@nalu/ide`; upgrade in deliberate batches with a smoke test. |
| Language-server lifecycle (biggest eng surface) | Ship TS + Python only at v1; download others on demand; supervise/restart; scope roots; treat as its own subsystem with health checks. |
| Web/desktop drift | Land `API_BASE` + CORS + capability interface in **one PR before** package extraction; keep the web deploy unchanged. |
| CORS + SSE from the desktop origin | Add the Electron origin to the Vercel allow-list; allow `Authorization` + preflight; verify the streaming reader in the week-1 spike. |
| Electron security | `contextIsolation` on, `sandbox` on, `nodeIntegration` off, strict CSP; local fs/exec only through path-scoped, audited IPC. |
| Key leakage | All inference server-side; the binary carries only the user's bearer token. |

---

## 11. Cost summary

| Item | Cost |
|---|---|
| Apple Developer Program (notarization) | $99 / yr |
| Azure Trusted Signing (Windows) | ~$120 / yr |
| Electron, Monaco, dockview, react-arborist, xterm, cmdk, ripgrep, pnpm/Turborepo | $0 (MIT/BSD) |
| CI (GitHub Actions mac+win signing minutes) | usage-based, minimal |
| **Total to ship download-clean on mac + Windows + Linux** | **~$220 / yr** |

---

## 12. Immediate next steps

1. **Approve this plan** (or tell me what to change — framework, scope, timeline).
2. Scaffold the monorepo (`apps/web` = move current `train/client`; `apps/desktop` = Electron shell; `packages/*`).
3. Land the **prerequisite refactor PR** (`API_BASE` + CORS + `@nalu/platform`).
4. Run the **five week-1 spikes** in §9.
5. Buy the two certs ($99 Apple + Azure Trusted Signing) so signing is wired from the first build — not bolted on later.

*Once you're happy with this, I can start scaffolding `apps/desktop` and wiring the Electron shell around the existing Nalu app.*
