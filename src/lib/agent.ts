import { streamChat, imageMessage, type WireMessage } from './naluApi'

// ============================================================================
// COMPUTER-USE AGENT — Nalu Catalina operates the whole Mac: it SEES the screen
// (screenshots → vision model) and ACTS (open apps/URLs, AppleScript, shell,
// mouse, keyboard). Every action is gated by approve() unless auto-approved.
// ============================================================================

export type PcTool =
  | { tool: 'see' }
  | { tool: 'open'; target: string }
  | { tool: 'browse'; url: string }
  | { tool: 'read_page' }
  | { tool: 'page_js'; code: string }
  | { tool: 'click_el'; selector: string }
  | { tool: 'type_text'; text: string }
  | { tool: 'press'; key: string }
  | { tool: 'shell'; command: string }
  | { tool: 'applescript'; script: string }
  | { tool: 'type'; text: string }
  | { tool: 'key'; combo: string }
  | { tool: 'click'; x: number; y: number; double?: boolean }
  | { tool: 'done'; summary: string }

export type PcStep =
  | { kind: 'thought'; text: string }
  | { kind: 'action'; action: PcTool }
  | { kind: 'result'; text: string }
  | { kind: 'screenshot'; url: string }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string }

const PC_SYSTEM = `You are Nalu Catalina — a world-class expert at operating a Mac. You complete the user's task by acting on the computer, ONE step at a time. You are DEADLY ACCURATE and prefer the fastest reliable method.

CRITICAL: You have FULL, REAL control of this Mac through your tools — files, shell, apps, browser, screen. NEVER say you "can't access" the computer or files — you CAN. For any file/folder/system question just run it (e.g. shell "ls -la ~/"). Never refuse; never punt to the user.

You have a built-in NALU BROWSER (your own Chromium window you fully control — no setup, logins persist across tasks). Use it for ALL web work.

You MUST reply with EXACTLY one JSON action inside a \`\`\`json fence (one short sentence of reasoning before the fence is allowed, nothing after). The tools:
{"tool":"browse","url":"https://..."}           // open a URL in the Nalu Browser (waits for load)
{"tool":"read_page"}                             // READ the current page: title, url, visible text, and clickable elements. Use this to SEE web pages and to READ other people's posts/comments before you act.
{"tool":"page_js","code":"..."}                  // run JavaScript IN the page to read/click/fill. Fast for normal sites.
{"tool":"click_el","selector":"..."}             // REAL trusted mouse click on the element matching this CSS selector (use for login/search/booking on strict sites — passes most bot-walls that reject page_js clicks)
{"tool":"type_text","text":"..."}                // REAL trusted typing into the focused field (click_el the field first)
{"tool":"press","key":"Return"}                  // REAL key press: Return, Tab, Escape, Backspace, ArrowDown…
{"tool":"open","target":"Mail"}                 // open an app by name (or a URL)
{"tool":"applescript","script":"..."}           // control native apps: Mail, Calendar, Messages, Finder, System Events
{"tool":"shell","command":"..."}                // run a terminal command
{"tool":"type","text":"..."}                    // type into the focused field
{"tool":"key","combo":"cmd+t"}                   // a shortcut: return, tab, esc, cmd+l…
{"tool":"see"}                                   // screenshot + description (ONLY for non-browser GUIs you must click)
{"tool":"click","x":100,"y":200}                // click screen coordinates from a "see" description
{"tool":"done","summary":"..."}                 // task complete (or report the outcome/blocker)

STRATEGY — be fast, thorough, and DEADLY ACCURATE. Do NOT give up after one or two steps.
1. WEB TASKS (reservations, email, forms, booking, posting) — DRIVE THE BROWSER with browse + read_page + page_js. This reads/acts on the real DOM and is far more reliable than screenshots. NEVER just "web search and report" — actually go to the site and complete the task, step by step, all the way to a confirmation.
   - RESERVATIONS — DEFAULT IS BOOK FULLY ONLINE. Unless the user explicitly said "call", you MUST try to complete the booking online first and only fall back to phoning if online genuinely can't finish.
     a) browse the booking platform (https://www.opentable.com — most restaurants incl. Hillstone are here; also https://resy.com), read_page.
     b) page_js: type the restaurant + city into the search box and submit; read_page the results; open the restaurant's page.
     c) page_js: SELECT the party size, the DATE, and the TIME the user asked for (or the nearest available); click the available time slot; read_page after each step to confirm what changed.
     d) Continue through the reservation form (name/phone/email are usually pre-filled by the logged-in account) and click the final "Complete/Reserve/Book" button. read_page to confirm you SEE a confirmation. Report "done" ONLY when you see the confirmation.
     e) FALLBACK TO CALLING — only after you've genuinely tried online and it can't complete (no online availability for that date/time, the restaurant isn't bookable online, or a step is truly blocked): then {"tool":"open","target":"tel:PHONE"} to call, and tell the user you're calling because online booking wasn't possible. If the user said "call" up front, skip straight to this.
   - STANDING / RECURRING reservations: platforms don't offer "recurring" natively — so REPEAT the full online booking flow once per requested date (e.g. every Friday 7pm for 4 people), one at a time, until all requested dates are booked; then report each confirmation.
   - EMAIL: browse "https://mail.google.com", read_page, and use page_js/keys to read, compose, archive, or reorganize. For Mail.app, use applescript.
2. NATIVE apps → applescript. System/CLI things → shell. These are instant and need no screenshot.
3. Use "see"/"click" only for non-web native GUI elements you can't reach through the DOM.
4. READ BEFORE YOU ACT: on social/email, read_page to understand other people's posts/comments (what they actually said) BEFORE composing a reply, so your response is relevant. For Gmail cleanup, read the list, then use page_js to label/archive/delete in batches.
5. If a page needs a LOGIN, shows a CAPTCHA, or returns "Access Denied"/a bot-wall you can't pass, DON'T give up on the whole task: the Nalu Browser is VISIBLE and your session persists. Say (via done) exactly what the user should do in that window — "please sign in / solve the check / click into the site in the Nalu Browser, then re-run this and I'll continue" — and stop. When they re-run, read_page again and pick up from the new state. Never fabricate accounts or credentials.
6. Prefer navigating WITHIN a site (search box + clicking results via page_js) over browsing deep URLs directly — some sites block direct deep links but allow in-site navigation.
Persist across MANY steps (booking/posting/cleanup can take 8-20). NEVER reply with prose only — ALWAYS emit a JSON action. Report "done" only on a confirmed result or a concrete blocker.`

// Robust parse: fenced json, bare json, or the first {...}; tolerant of extra prose.
function parsePc(text: string): { thought: string; action: PcTool | null } {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  let raw = fence ? fence[1] : ''
  if (!raw) { const m = text.match(/\{[\s\S]*?"tool"[\s\S]*?\}/); raw = m ? m[0] : '' }
  const thought = (raw ? text.slice(0, text.indexOf(raw)).replace(/```json|```/g, '') : text).trim().slice(0, 300)
  if (!raw) return { thought, action: null }
  try { return { thought, action: JSON.parse(raw) as PcTool } } catch {
    // last-ditch: repair common issues (trailing commas, smart quotes)
    try { return { thought, action: JSON.parse(raw.replace(/,\s*}/g, '}').replace(/[""]/g, '"')) as PcTool } } catch { return { thought, action: null } }
  }
}

export async function runComputer(opts: {
  task: string
  onStep: (s: PcStep) => void
  approve: (a: PcTool) => Promise<boolean>
  autoApprove?: () => boolean
  signal?: AbortSignal
  maxSteps?: number
}): Promise<void> {
  const { task, onStep, approve, signal } = opts
  const maxSteps = opts.maxSteps ?? 40
  // PLANNING uses the code/reasoning model (reliable at the JSON protocol); the
  // vision model is used ONLY to describe a screenshot when we need to "see".
  const history: WireMessage[] = [
    { role: 'system', content: PC_SYSTEM },
    { role: 'user', content: `TASK: ${task}\n\nDecide the first action. Prefer open/applescript/shell — don't take a screenshot unless you must click a visual element.` },
  ]

  // Read the current Nalu Browser page as text + a compact list of clickable
  // elements — the agent's reliable way to "see" and act on the web. Runs in our
  // own Chromium (no Chrome toggle needed).
  const readPage = async (): Promise<string> => {
    const code = `(function(){try{var els=[].slice.call(document.querySelectorAll('a,button,input,textarea,select,[role=button],[role=option],[data-testid]'));var items=[];for(var i=0;i<els.length&&items.length<60;i++){var e=els[i];var t=(e.innerText||e.value||e.placeholder||e.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,70);if(t)items.push('<'+e.tagName.toLowerCase()+(e.name?' name='+JSON.stringify(e.name):'')+(e.type?' type='+e.type:'')+'> '+t);}return JSON.stringify({title:document.title,url:location.href,text:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,3000),elements:items});}catch(err){return JSON.stringify({error:String(err)});}})()`
    const r = await window.nalu.pc.webJs(code, true)
    if (!r.ok || !r.out) return `could not read the page (${r.out?.slice(0, 200) || 'open a page first with browse'}).`
    try {
      const p = JSON.parse(r.out) as { title: string; url: string; text: string; elements: string[] }
      return `PAGE: ${p.title}\nURL: ${p.url}\nTEXT: ${p.text}\n\nCLICKABLE ELEMENTS:\n${(p.elements || []).join('\n')}`
    } catch { return r.out.slice(0, 3000) }
  }

  const describeScreen = async (): Promise<string> => {
    const url = await window.nalu.pc.screenshot()
    if (!url) return 'screenshot unavailable — Screen Recording permission may be off; use terminal/AppleScript instead.'
    onStep({ kind: 'screenshot', url })
    // Tell the model the LOGICAL screen size so the (x,y) it reports are already
    // in the coordinate space cliclick uses — clicks land precisely.
    const sz = await window.nalu.pc.screenSize().catch(() => ({ w: 0, h: 0 }))
    const dims = sz.w ? `The screen is ${sz.w}x${sz.h} points (top-left origin). Give every coordinate in THIS ${sz.w}x${sz.h} space. ` : ''
    let desc = ''
    try {
      await streamChat(
        [imageMessage(`You are the eyes of a Mac automation agent. ${dims}Report, precisely: the app/window in focus; each clickable element (buttons, links, fields, menu items) with its LABEL and the (x,y) of its CENTER; and the single best next element to click for the task. Be exact with coordinates and concise.`, url)],
        { specialist: 'vision', signal, onDelta: (t) => (desc += t) },
      )
    } catch { desc = 'could not analyze the screenshot; use terminal/AppleScript.' }
    return sz.w ? `[screen ${sz.w}x${sz.h}] ${desc}` : desc
  }

  const askPlanner = async (): Promise<string> => {
    let reply = ''
    // retry up to 3x if the model fails to emit a parseable action
    for (let attempt = 0; attempt < 3; attempt++) {
      reply = ''
      await streamChat(history, { specialist: 'code', signal, onDelta: (t) => (reply += t) })
      if (parsePc(reply).action) return reply
      history.push({ role: 'assistant', content: reply }, { role: 'user', content: 'That was not a valid action. Reply with ONLY one JSON action in a ```json fence, e.g. {"tool":"open","target":"https://mail.google.com"}. Do not describe — ACT.' })
    }
    return reply
  }

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return
    const reply = await askPlanner()
    const { thought, action } = parsePc(reply)
    if (thought) onStep({ kind: 'thought', text: thought })
    history.push({ role: 'assistant', content: reply })

    if (!action) {
      // Terminal fallback: if the model still won't emit an action, complete the
      // request deterministically — for common intents we can act directly.
      onStep({ kind: 'thought', text: 'Vision/plan unclear — using terminal fallback.' })
      const t = task.toLowerCase()
      const url = /gmail|google mail|my email|my mail|inbox/.test(t) ? 'https://mail.google.com'
        : /reddit/.test(t) ? 'https://reddit.com' : /linkedin/.test(t) ? 'https://linkedin.com'
        : /calendar/.test(t) ? 'https://calendar.google.com' : ''
      if (url) { await window.nalu.pc.open(url); onStep({ kind: 'done', text: `Opened ${url} (terminal fallback).` }); return }
      onStep({ kind: 'error', text: 'Could not determine an action. Try rephrasing the task (e.g. "open Mail" or a specific site).' })
      return
    }
    if (action.tool === 'done') { onStep({ kind: 'done', text: action.summary || 'Done.' }); return }
    onStep({ kind: 'action', action })

    // gate anything that changes the machine (screenshots/see are read-only)
    const risky = action.tool !== 'see'
    if (risky && !(opts.autoApprove?.() ?? false) && !(await approve(action))) {
      onStep({ kind: 'result', text: 'DENIED by user.' })
      history.push({ role: 'user', content: 'The user denied that action. Try a different approach.' })
      continue
    }

    let result = ''
    try {
      if (action.tool === 'see') { result = await describeScreen() }
      else if (action.tool === 'browse') { const ok = await window.nalu.pc.webOpen(action.url); if (ok) { const shot = await window.nalu.pc.webShot(); if (shot) onStep({ kind: 'screenshot', url: shot }) } result = ok ? `opened ${action.url} in the Nalu Browser. Use read_page to see it.` : `could not open ${action.url}` }
      else if (action.tool === 'read_page') { result = await readPage(); const shot = await window.nalu.pc.webShot(); if (shot) onStep({ kind: 'screenshot', url: shot }) }
      else if (action.tool === 'page_js') { const r = await window.nalu.pc.webJs(action.code, true); const shot = await window.nalu.pc.webShot(); if (shot) onStep({ kind: 'screenshot', url: shot }); result = r.ok ? `ran. result: ${r.out.slice(0, 3000)}` : `page_js error: ${r.out.slice(0, 500)}` }
      else if (action.tool === 'click_el') { const r = await window.nalu.pc.webClickSel(action.selector); const shot = await window.nalu.pc.webShot(); if (shot) onStep({ kind: 'screenshot', url: shot }); result = r.out }
      else if (action.tool === 'type_text') { const r = await window.nalu.pc.webType(action.text); result = r.out }
      else if (action.tool === 'press') { const r = await window.nalu.pc.webKey(action.key); const shot = await window.nalu.pc.webShot(); if (shot) onStep({ kind: 'screenshot', url: shot }); result = r.out }
      else if (action.tool === 'open') { result = (await window.nalu.pc.open(action.target)) ? `opened ${action.target}` : `could not open ${action.target}` }
      else if (action.tool === 'shell') { const r = await window.nalu.exec('', action.command); result = `exit ${r.code}\n${r.output.slice(0, 6000)}` }
      else if (action.tool === 'applescript') { const r = await window.nalu.pc.applescript(action.script); result = (r.ok ? 'ok ' : 'error ') + r.out.slice(0, 4000) }
      else if (action.tool === 'type') { await window.nalu.pc.type(action.text); result = 'typed.' }
      else if (action.tool === 'key') { await window.nalu.pc.key(action.combo); result = `pressed ${action.combo}.` }
      else if (action.tool === 'click') { const ok = await window.nalu.pc.click(action.x, action.y, action.double); result = ok ? 'clicked.' : 'click failed — cliclick not installed; using keyboard/AppleScript instead.' }
    } catch (e) { result = `ERROR: ${e instanceof Error ? e.message : 'failed'}` }
    onStep({ kind: 'result', text: result })
    history.push({ role: 'user', content: `RESULT: ${result}\n\nContinue, or {"tool":"done"} if the task is complete.` })
  }
  onStep({ kind: 'error', text: `Stopped after ${maxSteps} steps.` })
}


// A real coding agent (Codex/Cursor-style): the Nalu model plans in the cloud,
// then drives LOCAL tools in a loop — read/list/search files, write files, and
// run terminal commands — until the task is done. Writes and commands go
// through an approval callback so the human stays in control.

export type AgentTool =
  | { tool: 'read_file'; path: string }
  | { tool: 'list_dir'; path: string }
  | { tool: 'search'; query: string }
  | { tool: 'edit_file'; path: string; find: string; replace: string }
  | { tool: 'write_file'; path: string; content: string }
  | { tool: 'run'; command: string }
  | { tool: 'done'; summary: string }

export type AgentStep =
  | { kind: 'thought'; text: string }
  | { kind: 'action'; action: AgentTool }
  | { kind: 'result'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string }

const SYSTEM = (folder: string) => `You are Nalu's autonomous coding agent — a world-class STAFF+ engineer and true polyglot, expert in EVERY language and stack: Python, JavaScript/TypeScript, Go, Rust, C, C++, C#, Java, Kotlin, Swift, Ruby, PHP, Scala, Elixir, Haskell, Clojure, SQL, Bash/Zsh, HTML/CSS, React/Vue/Svelte, Node, Django/Flask/FastAPI, Rails, Spring, .NET, systems/embedded, data/ML (PyTorch/TF), DevOps (Docker/K8s/Terraform), and more. You know each language's idioms, standard library, tooling, build systems, test frameworks, and package managers, and you write code an expert in THAT language would be proud of. You work directly inside the user's IDE${folder ? ` on the project at ${folder}` : ''} and get things DONE by using TOOLS on the real machine, one step at a time.

CRITICAL: You have FULL, REAL access to this computer through your tools — the filesystem, the shell, everything. NEVER say "I can't access your files" or "I can't browse your computer" — you CAN and you MUST. For ANY request about files, folders, the system, or "what's in X", just DO it with a tool (e.g. run "ls -la ~/" or list_dir). Never refuse, never punt back to the user.

To act, reply with EXACTLY one JSON object inside a \`\`\`json fence and NOTHING else:
{"tool":"read_file","path":"relative/or/abs path"}
{"tool":"list_dir","path":"."}          // "." = the open folder; use an absolute path like "/Users/you" for anywhere else
{"tool":"search","query":"text to find across files"}
{"tool":"edit_file","path":"...","find":"EXACT existing text to replace","replace":"new text"}   // PREFERRED for editing — surgical, no rewrites
{"tool":"write_file","path":"...","content":"the FULL file contents"}   // only for NEW files or a full rewrite
{"tool":"run","command":"any shell command, e.g. ls ~/, npm test, python x.py, git status"}
{"tool":"done","summary":"what you did / what you found"}

EDITING — this is how the best agents stay reliable:
- To change existing code, use edit_file with a "find" string copied EXACTLY from the file (enough surrounding lines that it matches ONE unique spot) and the "replace" it becomes. NEVER rewrite a whole file to change a few lines.
- read_file the file first so your "find" is byte-exact (indentation included). If edit_file reports not-found or multiple-matches, read again and include more context.
- Make several small edit_file calls rather than one giant write_file. Use write_file only to CREATE a new file.

WORK THROUGH THE FULL SOFTWARE-ENGINEERING LIFECYCLE — be an expert at each step:
1. UNDERSTAND: read the relevant files (read_file / list_dir / search) so you know the code, conventions, and stack before touching anything.
2. PLAN: in your one reasoning sentence, state the concrete change you're about to make and why.
3. IMPLEMENT: write correct, idiomatic code that matches the surrounding style. PREFER edit_file for changes. If you use write_file you MUST include the ENTIRE file — every existing function, import, and line stays; never drop code you aren't changing (a partial file that deletes existing exports is a bug).
4. TEST/VERIFY: after editing, ALWAYS run the project's build/tests (read_file package.json / look for the test command; e.g. "node test.js", "python3 test.py", "npm test", "cargo test", "pytest"). If it FAILS, read the error, fix it, and re-run — loop until green.
5. REVIEW: sanity-check your own diff for bugs, edge cases, and leftovers before "done".

RULES:
- NEVER emit "done"/"complete" until you have actually RUN the test or build in THIS session and SEEN it succeed. If you haven't run it yet, run it now instead of finishing.
- ONE short sentence of reasoning before the fence is allowed; the fence is REQUIRED every turn.
- "What's in my <folder>" / "look at my computer" → run "ls -la <path>" (use ~ for home), then report what you found in a "done".
- Keep going autonomously until it actually works, then "done". Never ask the user questions mid-task; never say you can't.
- Handle any language/stack at a senior level. Ship a working result, verified.`

// Forgiving SEARCH/REPLACE applier (Aider/Cline-style): exact-unique → whitespace-
// tolerant line match → on miss, return the NEAREST real text so the model can
// retry byte-exact instead of looping on the same wrong string.
export function applyEdit(source: string, find: string, replace: string): { ok: boolean; text?: string; reason?: string; nearest?: string } {
  if (!find) return { ok: false, reason: 'empty find' }
  // 1) exact, unique
  const occ = source.split(find).length - 1
  if (occ === 1) return { ok: true, text: source.replace(find, replace) }
  if (occ > 1) return { ok: false, reason: `the "find" text appears ${occ} times — include more surrounding lines so it matches exactly ONE spot.` }
  // 2) whitespace-INSENSITIVE contiguous line-block match (tolerates the model
  // getting indentation or operator spacing slightly wrong).
  const srcLines = source.split('\n')
  const findLines = find.replace(/\n$/, '').split('\n')
  const repLines = replace.replace(/\n$/, '').split('\n')
  const nows = (s: string) => s.replace(/\s+/g, '')
  const fNows = findLines.map(nows)
  const hits: number[] = []
  for (let i = 0; i + findLines.length <= srcLines.length; i++) {
    let ok = true
    for (let j = 0; j < findLines.length; j++) if (nows(srcLines[i + j]) !== fNows[j]) { ok = false; break }
    if (ok) hits.push(i)
  }
  if (hits.length === 1) {
    const start = hits[0]
    const next = [...srcLines.slice(0, start), ...repLines, ...srcLines.slice(start + findLines.length)].join('\n')
    return { ok: true, text: next }
  }
  if (hits.length > 1) return { ok: false, reason: `the "find" text (ignoring whitespace) matched ${hits.length} places — add more context.` }
  // 3) nearest window by token overlap, to guide a byte-exact retry
  const toks = (s: string) => (s.toLowerCase().match(/[\w$]+/g) || [])
  const findTokens = new Set(toks(find))
  let best = -1, bestScore = 0
  const win = Math.max(1, findLines.length)
  for (let i = 0; i + win <= srcLines.length; i++) {
    const wt = toks(srcLines.slice(i, i + win).join(' '))
    let score = 0
    for (const t of wt) if (findTokens.has(t)) score++
    if (score > bestScore) { bestScore = score; best = i }
  }
  const nearest = best >= 0 && bestScore > 0
    ? srcLines.slice(best, best + win).join('\n')
    : srcLines.slice(0, Math.min(win, srcLines.length)).join('\n')
  return { ok: false, reason: 'the "find" text was not found', nearest }
}

// Code-tuned models often answer with prose + fenced code blocks (e.g. "**math.js**
// (updated):\n```js…```") instead of a JSON tool call. Pull those out so the agent
// still applies the work and can then run the tests. Skips test/spec files so the
// model can't overwrite the real test with a guessed one.
export function extractFileWrites(reply: string): { path: string; content: string }[] {
  const writes: { path: string; content: string }[] = []
  const seen = new Set<string>()
  const re = /(?:\*\*|`|FILE:\s*|#{1,4}\s*|^|\n)\s*([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,10})\**`?\s*(?:\([^)\n]*\))?\s*:?\s*\n+```[A-Za-z0-9+#]*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(reply))) {
    const path = m[1].trim()
    if (!/^[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,10}$/.test(path)) continue
    if (/(^|[./])(test|spec)|[._-](test|spec)\./i.test(path)) continue
    if (seen.has(path)) continue
    seen.add(path)
    writes.push({ path, content: m[2].replace(/\n$/, '') + '\n' })
  }
  return writes
}

// Models don't all speak our exact tool schema — many emit {"action":"run_command",…}
// or {"action":"complete","message":…}. Normalize any reasonable shape to AgentTool
// so the loop actually executes instead of silently no-op'ing. THIS is what makes
// the agent reliable across models.
const TOOL_MAP: Record<string, AgentTool['tool']> = {
  read_file: 'read_file', view_file: 'read_file', read: 'read_file', cat: 'read_file', open_file: 'read_file',
  list_dir: 'list_dir', ls: 'list_dir', list: 'list_dir', list_files: 'list_dir', listdir: 'list_dir',
  search: 'search', grep: 'search', find_in_files: 'search', find_text: 'search',
  edit_file: 'edit_file', str_replace: 'edit_file', replace: 'edit_file', edit: 'edit_file', apply_patch: 'edit_file',
  write_file: 'write_file', create_file: 'write_file', write: 'write_file', create: 'write_file', save_file: 'write_file',
  run: 'run', run_command: 'run', bash: 'run', shell: 'run', execute: 'run', exec: 'run', run_shell: 'run', run_terminal: 'run', terminal: 'run',
  done: 'done', complete: 'done', finish: 'done', stop: 'done', end: 'done', finished: 'done',
}
function normalizeAction(raw: unknown): AgentTool | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = String(r.tool || r.action || r.name || r.tool_name || r.command_name || '').toLowerCase().replace(/[^a-z_]/g, '')
  const tool = TOOL_MAP[name]
  if (!tool) return null
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined)
  return {
    tool,
    path: s(r.path) || s(r.file) || s(r.filename) || s(r.filepath) || s(r.file_path) || '',
    query: s(r.query) || s(r.q) || s(r.pattern) || '',
    find: s(r.find) ?? s(r.search) ?? s(r.old) ?? s(r.old_str) ?? s(r.old_string) ?? s(r.target) ?? '',
    replace: s(r.replace) ?? s(r.new) ?? s(r.new_str) ?? s(r.new_string) ?? s(r.replacement) ?? '',
    content: s(r.content) ?? s(r.text) ?? s(r.code) ?? s(r.data) ?? s(r.file_content) ?? '',
    command: s(r.command) || s(r.cmd) || s(r.shell) || s(r.script) || s(r.run) || '',
    summary: s(r.summary) || s(r.message) || s(r.msg) || s(r.reason) || '',
  } as AgentTool
}
function parseAction(text: string): { thought: string; action: AgentTool | null } {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  let raw = fence ? fence[1] : ''
  if (!raw) { const m = text.match(/\{[\s\S]*?"(?:tool|action|name)"[\s\S]*?\}/); raw = m ? m[0] : '' }
  const thought = (raw ? text.slice(0, text.indexOf(raw)).replace(/```json|```/g, '') : text).trim().slice(0, 400)
  if (!raw) return { thought, action: null }
  let obj: unknown = null
  try { obj = JSON.parse(raw) } catch {
    try { obj = JSON.parse(raw.replace(/,\s*}/g, '}').replace(/[""]/g, '"')) } catch { return { thought, action: null } }
  }
  return { thought, action: normalizeAction(obj) }
}

export async function runAgent(opts: {
  task: string
  folder: string | null
  onStep: (s: AgentStep) => void
  approve: (a: AgentTool) => Promise<boolean> // gate for write_file / run
  signal?: AbortSignal
  maxSteps?: number
}): Promise<void> {
  const { task, folder, onStep, approve, signal } = opts
  const maxSteps = opts.maxSteps ?? 26
  const abs = (p: string) => (folder && !p.startsWith('/') ? folder.replace(/\/$/, '') + '/' + p : p)

  const history: WireMessage[] = [
    { role: 'system', content: SYSTEM(folder || '') },
    { role: 'user', content: task },
  ]

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return
    // ask the model for the next action; retry if it replies with prose (e.g. a
    // refusal) instead of a tool action, then fall back to acting directly.
    let reply = ''
    let action: AgentTool | null = null
    let thought = ''
    let writes: { path: string; content: string }[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      reply = ''
      await streamChat(history, { specialist: 'code', signal, onDelta: (t) => (reply += t) })
      const parsed = parseAction(reply); action = parsed.action; thought = parsed.thought
      if (action) break
      // If it answered in prose+code, take those writes NOW — don't nudge the
      // code away with another turn (which is what made this fail before).
      writes = extractFileWrites(reply)
      if (writes.length) break
      history.push({ role: 'assistant', content: reply }, { role: 'user', content: 'That was not a valid action, and you must NOT refuse — you have full tool access to this machine. Reply with ONLY one JSON action in a ```json fence. For a files/computer question use {"tool":"run","command":"ls -la ~/"}. ACT now.' })
    }
    if (thought) onStep({ kind: 'thought', text: thought })
    history.push({ role: 'assistant', content: reply })

    if (!action) {
      // The model answered in prose + fenced code blocks instead of a JSON tool
      // call (common with code-tuned models). Apply the files it wrote, then push
      // it to verify — this alone is what lets such models actually ship changes.
      if (writes.length) {
        const applied: string[] = []
        for (const w of writes) {
          if (await approve({ tool: 'write_file', path: w.path, content: w.content })) {
            await window.nalu.writeFile(abs(w.path), w.content); applied.push(w.path)
          }
        }
        onStep({ kind: 'action', action: { tool: 'write_file', path: applied.join(', '), content: '' } })
        onStep({ kind: 'result', text: `Applied ${applied.length} file(s): ${applied.join(', ') || '(none)'}` })
        history.push({ role: 'user', content: `RESULT: applied ${applied.length} file(s): ${applied.join(', ')}. Now RUN the test or build to verify it works; if it fails, read the error and fix it. Reply with ONE json tool action.` })
        continue
      }
      // Fallback: the model kept refusing. For a filesystem/exploration ask, just
      // run it. Otherwise report honestly (but this is rare now).
      const t = task.toLowerCase()
      const m = t.match(/(?:in|of|inside|what'?s in|list|show|contents of)\s+(?:my\s+)?([\w./~-]+)\s*(?:folder|directory|dir)?/)
      const target = /computer|home|my (files|folder|stuff)|michaelberryii/.test(t) ? '~/' : (m && m[1] ? m[1].replace(/folder|directory|dir/g, '').trim() : '~/')
      onStep({ kind: 'thought', text: `Running it directly: ls ${target}` })
      action = { tool: 'run', command: `ls -la ${target}` }
    }
    if (action.tool === 'done') { onStep({ kind: 'done', text: action.summary || 'Done.' }); return }

    onStep({ kind: 'action', action })

    let result = ''
    try {
      if (action.tool === 'read_file') {
        result = await window.nalu.readFile(abs(action.path))
        result = result.slice(0, 12000)
      } else if (action.tool === 'list_dir') {
        const entries = await window.nalu.readDir(abs(action.path || '.'))
        result = entries.map((e) => (e.dir ? e.name + '/' : e.name)).join('\n')
      } else if (action.tool === 'search') {
        const hits = await window.nalu.search(folder || '', action.query)
        result = hits.slice(0, 40).map((h) => `${h.rel}:${h.line}: ${h.text}`).join('\n') || '(no matches)'
      } else if (action.tool === 'edit_file') {
        // Surgical find/replace with forgiving matching (no full-file rewrite).
        if (!(await approve(action))) { result = 'DENIED by user.' }
        else {
          let cur = ''; let missing = false
          try { cur = await window.nalu.readFile(abs(action.path)) } catch { missing = true }
          if (missing) { result = `edit_file: ${action.path} does not exist — use write_file to create it.` }
          else {
            const r = applyEdit(cur, action.find, action.replace)
            if (r.ok && r.text != null) {
              await window.nalu.writeFile(abs(action.path), r.text)
              const delta = r.text.split('\n').length - cur.split('\n').length
              result = `Edited ${action.path} (${delta >= 0 ? '+' : ''}${delta} lines).`
            } else {
              result = `edit_file couldn't apply: ${r.reason}.` + (r.nearest ? ` The CLOSEST existing text in ${action.path} is:\n---\n${r.nearest}\n---\nResend edit_file with "find" copied byte-exact from THIS (or use write_file).` : ` read_file ${action.path} and copy the exact text.`)
            }
          }
        }
      } else if (action.tool === 'write_file') {
        if (!(await approve(action))) { result = 'DENIED by user.' }
        else { await window.nalu.writeFile(abs(action.path), action.content); result = `Wrote ${action.path} (${action.content.length} chars).` }
      } else if (action.tool === 'run') {
        if (!(await approve(action))) { result = 'DENIED by user.' }
        else { const r = await window.nalu.exec(folder || '', action.command); result = `exit ${r.code}\n${r.output.slice(0, 8000)}` }
      }
    } catch (e) {
      result = `ERROR: ${e instanceof Error ? e.message : 'failed'}`
    }
    onStep({ kind: 'result', text: result })
    history.push({ role: 'user', content: `TOOL RESULT:\n${result}` })
  }
  onStep({ kind: 'error', text: `Stopped after ${maxSteps} steps.` })
}
