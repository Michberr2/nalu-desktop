# Nalu CLI + Model — State, Plan, and the Path to Beating the Frontier

*Living plan doc. Scope: the Nalu terminal CLI (`~/naludesktop/cli`) and the model
that powers it (served from `~/train/api` + `~/train/training`). Last updated 2026-07-11.*

---

## TL;DR

- The CLI now works end-to-end: scans repos, edits files, runs shell, searches
  the web, writes plans, and reads `.nalu/` project docs — without stalling.
- Two classes of bug were the real blockers, both fixed today: (1) the agent
  **stalled** when the model narrated an action instead of emitting a tool call,
  and (2) the backend **timed out onto a dead fallback** because CLI turns used
  slow generation params. See [What was fixed today](#what-was-fixed-today).
- The single biggest remaining lever is the **model**. The base emits **0%
  native tool calls** and narrates instead of acting — we paper over it with
  text-form recovery. Fixing that at the source needs training, and that is also
  the honest answer to "beat Fable 5 / GPT-5.6": see
  [The model track](#the-model-track).
- You will **not** beat frontier models as a *general* model by fine-tuning
  DeepSeek. You **can** beat them **inside the Nalu CLI on your tasks** — that is
  a real, reachable goal, and the plan below is how.

---

## What Nalu is today

```
        ┌──────────────────────────── your machine ────────────────────────────┐
        │                                                                       │
        │   nalu (terminal)                                                     │
        │   ~/.nalu/bin/nalu.mjs  ── one file, zero deps, Node 18+ ── 1,594 loc  │
        │                                                                       │
        │   ┌─ agent loop ────────────────────────────────────────────────┐    │
        │   │  read user msg → POST /api/chat (SSE) → stream reply         │    │
        │   │       │                                     │                │    │
        │   │       │            native tool_calls?  OR   ▼                │    │
        │   │       │            recoverToolCalls(text)  (JSON/<tag>/      │    │
        │   │       │                                      shell/paren)    │    │
        │   │       ▼                                     │                │    │
        │   │  execute LOCALLY:  bash · read_file · write_file · edit_file │    │
        │   │                    list_dir · grep · web_search · fetch_url  │    │
        │   │       │  (permission prompt for anything that mutates)       │    │
        │   │       ▼                                                       │    │
        │   │  feed tool result back → loop until done (max 40 steps)      │    │
        │   └──────────────────────────────────────────────────────────────┘    │
        │            ▲                                                           │
        │   project memory: <cwd>/.nalu/*.md + NALU.md  (loaded every turn)     │
        └────────────┼──────────────────────────────────────────────────────────┘
                     │  HTTPS (no auth today)
                     ▼
        ┌──────────────────────── n4lu.com (Vercel) ───────────────────────────┐
        │  /api/chat.ts  (1,114 loc)                                            │
        │    cli:true → cliPromptBlock + tools kept + lean params               │
        │    route: pickSpecialist()  ── keyword + semantic classifier          │
        │              │                                                        │
        │              ▼   one of 39 specialists (api/_specialists.ts)          │
        │    ┌───────────────────────────────────────────────────────────┐     │
        │    │ Nalu Code · Financial · Crypto · Legal · Medical · Vision …│     │
        │    └───────────────────────────────────────────────────────────┘     │
        │              │                                                        │
        │              ▼  provider chain (api/_llm.ts)                          │
        │    primary: Tinker (DeepSeek-V3.1)  ──►  fallback: HF router          │
        │                                          (⚠ monthly credits depleted) │
        └───────────────────────────────────────────────────────────────────────┘
```

**Distribution:** `curl -fsSL https://n4lu.com/install.sh | sh` → `~/.nalu/bin`,
symlinked onto PATH. `nalu update` self-updates (atomic write). Source of truth is
`~/naludesktop/cli`; `publish.sh` copies `nalu.mjs`+`install.sh` into
`~/train/client/public/`, and deploying `train` makes them live.

---

## What was fixed today

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | Agent announces "Let me explore the files." and **stops** | stall-detector only fired on colon/unpunctuated endings; a period-terminated announcement slipped through | rewrote `announcesIntent()` — robust to any trailing punctuation, checks the last line for intent; allows up to 3 nudges/turn |
| 2 | Model writes `bash\nls -la` or a ```` ```bash ```` block, nothing runs | recovery caught JSON/tag/paren forms but not the **shell** form the model uses for bash | added shell-form recovery (fenced + bare label + `$`-prompt), guarded so illustrative blocks in prose aren't executed |
| 3 | Big raw JSON blob printed before every `write_file` | renderer only suppressed **single-line** JSON calls | renderer now holds and suppresses **multi-line** pretty-printed JSON calls |
| 4 | `Nalu engine error 402` mid-task | CLI turns used `max_tokens: 8192` + `frequency_penalty` → DeepSeek slow → blew the 75s failover timeout → landed on the **depleted** HF fallback | CLI turns now use lean params (`max_tokens: 4096`, no penalty) → 14-17s responses; primary is retried before fallback; CLI first-token watchdog 7s→20s |
| 5 | Model invents arg names (`file_path`, `cmd`) | strict arg names | `execTool` normalizes aliases and returns self-correcting errors for missing args |

Plus the features you asked for: **`.nalu/` project memory**, **`/plan`** (writes
checkbox plans to `.nalu/plans/`, auto-approved), **`/search`**, explicit
live-web-access prompting, and a "don't beg off on specialized domains" posture.

---

## The plan — prioritized

### P0 — make the current model reliable enough to trust (mostly DONE + one gap)

- [x] Kill the stall (nudge + shell recovery).
- [x] Kill the timeout-to-dead-fallback (lean params + primary retry).
- [ ] **Backend billing/capacity (ACTION NEEDED — yours).** The HF fallback's
      monthly credits are depleted, and Tinker rate-limits under load. Until the
      model is self-hosted (P2), do one of:
      - top up HuggingFace Inference credits, **or**
      - point the fallback at a working provider:
        `NALU_FALLBACK_BASE_URL` / `NALU_FALLBACK_API_KEY` / `NALU_FALLBACK_MODEL`
        (any OpenAI-compatible endpoint), **or**
      - accept primary-only (Tinker) with the retry logic now in place.

### P1 — close the harness gap with Claude Code / Codex

Ranked by value ÷ effort:

1. **Session persistence / resume.** Today history is in-memory and dies on exit.
   Write each session to `~/.nalu/sessions/<id>.jsonl`; add `nalu resume`
   (`--last` / `<id>`). This is the #1 thing users expect that Nalu lacks.
2. **`NALU.md` auto-init.** A `/init` that scans the repo and writes a `NALU.md`
   so project memory is populated without manual doc-dropping.
3. **A real `apply_patch`/diff view.** `edit_file` is exact-string only; show a
   colored diff at the permission prompt and support multi-hunk patches.
4. **Token/step meter.** Show context usage and step count (`◆ Nalu · step 3/40`),
   so long tasks are legible. Both competitors surface this.
5. **Windows support.** The CLI spawns `/bin/bash` unconditionally — add a
   PowerShell/cmd path or require WSL explicitly in the installer.
6. **MCP client (later).** Both competitors support MCP; a minimal client would
   let power users add tools without changing the CLI.

### P2 — conceptual/architecture changes (drawings below)

- **Self-host the model** (remove the Tinker/HF dependency and its billing cliff).
- **Train the model for agentic tool-use** (fix reliability at the source; the
  path to "beat the frontier *here*").
- **Auth + rate limiting** on `/api/chat` before wider distribution (today the
  endpoint is open and unmetered).
- **OS-level sandbox for `--yolo`** (Codex uses Seatbelt/Landlock; Nalu's `--yolo`
  has no containment).

---

## Conceptual changes (layout drawings)

### A. Self-hosted model serving — remove the billing cliff

Today a single depleted provider can kill every CLI user. Own the serving:

```
   BEFORE (fragile)                         AFTER (owned)
   ───────────────                          ────────────
   /api/chat                                /api/chat
      │                                        │
      ▼                                        ▼
   Tinker  ──(fail)──►  HF router          your vLLM / TGI endpoint
   (rate     (402 —      DEAD                 (nalu-code-agent-v1 on a GPU host:
    limits)   depleted)                        Runpod / Modal / Fly GPU / Lambda)
                                                │  ├─ autoscale 0→N
                                                │  └─ OpenAI-compatible /v1
                                             fallback: a 2nd region or a paid API
```

Wire with the existing env knobs — **no app-code change**:
`NALU_DEFAULT_MODEL=nalu-code-agent-v1`, `NALU_<KIND>_BASE_URL=…`,
`NALU_<KIND>_API_KEY=…`.

### B. Session persistence

```
   runTurn() ──► append {role,content,tool_calls} ──► ~/.nalu/sessions/<id>.jsonl
                                                            │
   nalu resume [--last | <id>]  ◄── read + replay ─────────┘
   (rebuild state.messages; keep the same trimHistory budget)
```

### C. Tool-use reliability: recovery today → native calls after training

```
   TODAY (heuristic band-aid)          TARGET (trained behavior)
   ─────────────────────────           ─────────────────────────
   model emits TEXT:                   model emits NATIVE tool_calls:
     "Let me look.                       delta.tool_calls = [
      bash                                 {function:{name:"bash",
      ls -la"                                arguments:'{"command":"ls -la"}'}}]
        │                                         │
        ▼                                         ▼
   recoverToolCalls() guesses          executed directly — no guessing,
   → sometimes wrong, sometimes         no stalls, no illustrative-block
     stalls (the freeze you hit)        false-positives
```

The recovery layer stays as a safety net, but the trained model should make it
rarely fire. **This is what training buys — and why it matters more than any
feature.**

---

## The model track

### The honest verdict on "better than Fable 5 / GPT-5.6"

Straight answer: **fine-tuning DeepSeek will not produce a *general* model that
beats Fable 5 or GPT-5.6.** Those are trained with orders of magnitude more
compute, data, and RLHF than any single project can match, and general-capability
leaderboards reflect that. Anyone claiming a LoRA on a small base beats the
frontier *in general* is measuring one narrow slice and calling it the whole.

But that is the wrong target. The right one — and a genuinely reachable one:

> **Make the model better than a frontier model *inside the Nalu CLI, on your
> tasks*.**

That is achievable because:

1. **Narrow distillation closes the gap where it's measured.** A model distilled
   hard on one domain, from a frontier teacher, can match that teacher *in that
   domain* — and you run 39 of them, routed. (This is the fleet thesis, and it's
   well-supported.)
2. **Frontier models aren't tuned to your harness.** GPT-5.6 dropped into the
   Nalu CLI cold doesn't know your tool schema, your `.nalu/plan` convention, or
   your output rules. A model trained *on your harness* can be more reliable
   *here* than a smarter model that keeps fighting your format.
3. **The current failure is a training-shaped problem.** The base emits **0%
   native tool calls** and narrates instead of acting. That's not an
   intelligence ceiling — it's a formatting/behavior gap that supervised
   fine-tuning on tool-use trajectories fixes directly.

So: not "beat GPT-5.6 at everything." Instead, "a Nalu model that, in your
terminal, plans and calls tools so reliably it feels better than dropping GPT-5.6
in cold — and costs you nothing per token because you own it."

### The single highest-leverage training target: agentic tool-use

Everything else is secondary to this. Today's freeze, the recovery heuristics,
the empty responses — all trace to the base model not reliably emitting tool
calls. Fix that first.

```
   AGENTIC TRAJECTORY DISTILLATION  (new — the piece that fixes reliability)
   ────────────────────────────────────────────────────────────────────────
   (1) TEACHER runs REAL tasks inside a Nalu-CLI-shaped harness
       "fix this failing test", "add a flag", "scan repo & write SUMMARY.md"
                 │  teacher = a frontier model with the Nalu tool schema
                 ▼
       records full multi-turn trajectories:
         user → assistant(tool_call) → tool(result) → … → assistant(final)
                 │
                 ▼
   (2) FILTER to trajectories that actually SUCCEEDED (tests pass, file written)
                 │
                 ▼
   (3) SFT DeepSeek on them — loss on the assistant's tool_call + answer tokens
       (base: DeepSeek-V3.1 or DeepSeek-Coder-V2 for the code lane)
                 │
                 ▼
   (4) optional RL polish (GRPO/DRO): reward = task completed + tools well-formed
       (train_catalina_dro.py already exists as a starting point)
                 │
                 ▼
   (5) SERVE (self-host, drawing A) and WIRE:  NALU_CODE_MODEL=nalu-code-agent-v1
                 │
                 ▼
   (6) PROVE: replay a held-out task battery through the real CLI; measure
       tool-call validity %, task-completion %, steps-to-done vs the base and
       vs GPT-5.6-in-cold.
```

### What already exists vs what's needed

| Stage | Exists | Needed |
|-------|--------|--------|
| Domain QA distillation | `training/distill_gen.mjs` (single-turn Q→A; 2 domains × 10 rows so far) | scale to 300–2000 rows/domain |
| SFT trainer | `training/train_nalu_sft.py` (Tinker + LoRA, masks to answer tokens) | point at agentic data; pick per-lane base |
| RL polish | `training/train_catalina_dro.py` (DRO) | reward fn for tool-call validity + task success |
| **Agentic trajectories** | **— (nothing yet)** | **a trajectory generator that runs a teacher through the CLI tool loop and logs successful multi-turn tool-use** |
| Serving | env-var wiring in `api/chat.ts` (`NALU_<KIND>_MODEL`) | a self-hosted OpenAI-compatible endpoint (drawing A) |
| Eval | `scripts/router-eval*.mjs` | an agentic task battery scored through the real CLI |

The **one missing piece** that unlocks the rest is the agentic-trajectory
generator (step 1–2). That's the concrete next build.

### Concrete next steps (in order)

1. **You:** resolve the fallback provider (P0) — top up HF **or** set
   `NALU_FALLBACK_*` to a working endpoint, so users aren't one Tinker blip from
   a dead CLI.
2. **Build the agentic-trajectory generator** — a Workflow that drives a frontier
   teacher through the exact Nalu tool schema on ~500 seeded coding tasks and
   logs successful trajectories to `training/data/nalu-agent.jsonl`.
3. **SFT** DeepSeek on `nalu-agent.jsonl` with `train_nalu_sft.py` → `nalu-code-agent-v1`.
4. **Self-host** it (drawing A) and wire `NALU_CODE_MODEL`.
5. **Prove it** on a held-out battery through the real CLI; iterate.
6. In parallel, **session resume** (P1 #1) and **`/init`** (P1 #2) for UX parity.

---

## Appendix — file map

```
~/naludesktop/cli/
  nalu.mjs        the entire CLI (agent loop, tools, recovery, renderer)   1,594 loc
  install.sh      curl|sh installer (Node 18+, PATH setup, verify)
  publish.sh      copy nalu.mjs+install.sh → ~/train/client/public/
  README.md       user-facing docs
  ROADMAP.md      this file

~/train/
  api/chat.ts         chat backend; cli:true mode, routing, provider chain   1,114 loc
  api/_specialists.ts 39-specialist registry + keyword/semantic router
  api/_llm.ts         provider chain + failover (Tinker → HF)
  api/web.ts          web_search / fetch_url (DuckDuckGo, Wikipedia, …)
  training/
    README_FLEET.md   distill → SFT → wire → prove
    distill_gen.mjs   domain QA distillation (single-turn)
    train_nalu_sft.py SFT (Tinker + LoRA, answer-token loss)
    train_catalina_dro.py  DRO RL polish
    data/*.jsonl      distilled rows (cre, medical — seeds)
```
