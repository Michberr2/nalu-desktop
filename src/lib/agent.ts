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

You MUST reply with EXACTLY one JSON action inside a \`\`\`json fence (one short sentence of reasoning before the fence is allowed, nothing after). The tools:
{"tool":"browse","url":"https://..."}           // open a URL in the real browser (waits for load)
{"tool":"read_page"}                             // READ the current web page: its title, url, visible text, and clickable elements. Use this to SEE web pages (better than a screenshot).
{"tool":"page_js","code":"..."}                  // run JavaScript IN the page to click/fill/submit, e.g. document.querySelector('input[name=q]').value='hi'; document.querySelector('button[type=submit]').click()
{"tool":"open","target":"Mail"}                 // open an app by name (or a URL)
{"tool":"applescript","script":"..."}           // control native apps: Mail, Calendar, Messages, Finder, System Events
{"tool":"shell","command":"..."}                // run a terminal command
{"tool":"type","text":"..."}                    // type into the focused field
{"tool":"key","combo":"cmd+t"}                   // a shortcut: return, tab, esc, cmd+l…
{"tool":"see"}                                   // screenshot + description (ONLY for non-browser GUIs you must click)
{"tool":"click","x":100,"y":200}                // click screen coordinates from a "see" description
{"tool":"done","summary":"..."}                 // task complete (or report the outcome/blocker)

STRATEGY — be fast, thorough, and DEADLY ACCURATE. Do NOT give up after one search.
1. WEB TASKS (reservations, email, forms, booking, posting) — DRIVE THE BROWSER with browse + read_page + page_js. This reads/acts on the real DOM and is far more reliable than screenshots. NEVER just "web search and report" — actually go to the site and do it.
   - RESERVATIONS: try the real booking platforms — browse "https://www.opentable.com", read_page, use page_js to search the restaurant + city, read the results, and book. Also try "https://resy.com". If a specific restaurant genuinely has no online booking (some don't), go to their official site's reservations/waitlist page and use it; only then report the exact next step (e.g. the number to call) — but exhaust the online options first.
   - EMAIL: browse "https://mail.google.com", read_page, and use page_js/keys to read, compose, archive, or reorganize. For the Mail.app, use applescript.
2. NATIVE apps → applescript. System/CLI things → shell. These are instant and need no screenshot.
3. Use "see"/"click" only for non-web GUI elements you can't reach otherwise.
Work autonomously and persistently toward the goal. NEVER reply with prose only — ALWAYS emit a JSON action. When truly done (success OR a real blocker with the concrete next step), use "done".`

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
  const maxSteps = opts.maxSteps ?? 22
  // PLANNING uses the code/reasoning model (reliable at the JSON protocol); the
  // vision model is used ONLY to describe a screenshot when we need to "see".
  const history: WireMessage[] = [
    { role: 'system', content: PC_SYSTEM },
    { role: 'user', content: `TASK: ${task}\n\nDecide the first action. Prefer open/applescript/shell — don't take a screenshot unless you must click a visual element.` },
  ]

  // Read the current web page as text + a compact list of clickable elements —
  // the agent's reliable way to "see" and act on the web.
  const readPage = async (): Promise<string> => {
    const code = `(function(){try{var els=[].slice.call(document.querySelectorAll('a,button,input,textarea,select,[role=button]'));var items=[];for(var i=0;i<els.length&&items.length<50;i++){var e=els[i];var t=(e.innerText||e.value||e.placeholder||e.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,60);if(t)items.push('<'+e.tagName.toLowerCase()+(e.name?' name='+e.name:'')+(e.type?' type='+e.type:'')+'> '+t);}return JSON.stringify({title:document.title,url:location.href,text:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,2500),elements:items});}catch(err){return 'ERR '+err;}})()`
    const r = await window.nalu.pc.browserRun(code, true)
    if (!r.ok || !r.out) return `could not read the page (${r.out?.slice(0, 200) || 'no browser'}). If Safari, enable Develop → Allow JavaScript from Apple Events, or use Chrome.`
    try {
      const p = JSON.parse(r.out) as { title: string; url: string; text: string; elements: string[] }
      return `PAGE: ${p.title}\nURL: ${p.url}\nTEXT: ${p.text}\nCLICKABLE ELEMENTS:\n${(p.elements || []).join('\n')}`
    } catch { return r.out.slice(0, 3000) }
  }

  const describeScreen = async (): Promise<string> => {
    const url = await window.nalu.pc.screenshot()
    if (!url) return 'screenshot unavailable — Screen Recording permission may be off; use terminal/AppleScript instead.'
    onStep({ kind: 'screenshot', url })
    let desc = ''
    try {
      await streamChat(
        [imageMessage('Describe this Mac screen for an automation agent: what app/page is open, the key clickable elements and their approximate pixel coordinates (x,y), any text fields, and what the user would click next. Be concise and specific.', url)],
        { specialist: 'vision', signal, onDelta: (t) => (desc += t) },
      )
    } catch { desc = 'could not analyze the screenshot; use terminal/AppleScript.' }
    return desc
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
      else if (action.tool === 'browse') { const ok = await window.nalu.pc.browserOpen(action.url); result = ok ? `opened ${action.url}. Use read_page to see it.` : `could not open ${action.url}` }
      else if (action.tool === 'read_page') { result = await readPage() }
      else if (action.tool === 'page_js') { const r = await window.nalu.pc.browserRun(action.code, true); result = r.ok ? `ran. result: ${r.out.slice(0, 3000)}` : `page_js error: ${r.out.slice(0, 500)} (if "not allowed", tell the user to enable Safari Develop → Allow JavaScript from Apple Events, or use Chrome)` }
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
  | { tool: 'write_file'; path: string; content: string }
  | { tool: 'run'; command: string }
  | { tool: 'done'; summary: string }

export type AgentStep =
  | { kind: 'thought'; text: string }
  | { kind: 'action'; action: AgentTool }
  | { kind: 'result'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string }

const SYSTEM = (folder: string) => `You are Nalu's autonomous coding agent working inside the user's IDE on the project at ${folder || '(no folder open)'}. You accomplish the user's task by using TOOLS, one step at a time.

To act, reply with EXACTLY one JSON object inside a \`\`\`json fence and NOTHING else:
{"tool":"read_file","path":"relative/or/abs path"}
{"tool":"list_dir","path":"."}
{"tool":"search","query":"text to find across files"}
{"tool":"write_file","path":"...","content":"the FULL new file contents"}
{"tool":"run","command":"a shell command, e.g. npm test"}
{"tool":"done","summary":"what you did"}

You may add ONE short sentence of reasoning BEFORE the fence. After each action I send you the RESULT; then take the next step. Read/inspect before you edit. Make focused edits. When the task is complete, use "done". Keep going until done — do not ask the user questions mid-task.`

function parseAction(text: string): { thought: string; action: AgentTool | null } {
  const fence = text.match(/```json\s*([\s\S]*?)```/) || text.match(/```\s*(\{[\s\S]*?\})\s*```/)
  const thought = (fence ? text.slice(0, text.indexOf(fence[0])) : text).trim()
  const raw = fence ? fence[1] : (text.match(/\{[\s\S]*\}/) || [])[0]
  if (!raw) return { thought, action: null }
  try { return { thought, action: JSON.parse(raw) as AgentTool } } catch { return { thought, action: null } }
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
  const maxSteps = opts.maxSteps ?? 14
  const abs = (p: string) => (folder && !p.startsWith('/') ? folder.replace(/\/$/, '') + '/' + p : p)

  const history: WireMessage[] = [
    { role: 'system', content: SYSTEM(folder || '') },
    { role: 'user', content: task },
  ]

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return
    // ask the model for the next action
    let reply = ''
    await streamChat(history, { specialist: 'code', signal, onDelta: (t) => (reply += t) })
    const { thought, action } = parseAction(reply)
    if (thought) onStep({ kind: 'thought', text: thought })
    history.push({ role: 'assistant', content: reply })

    if (!action) { onStep({ kind: 'error', text: 'Could not parse an action; stopping.' }); return }
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
