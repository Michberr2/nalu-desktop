import { streamChat, imageMessage, type WireMessage } from './naluApi'

// ============================================================================
// COMPUTER-USE AGENT — Nalu Catalina operates the whole Mac: it SEES the screen
// (screenshots → vision model) and ACTS (open apps/URLs, AppleScript, shell,
// mouse, keyboard). Every action is gated by approve() unless auto-approved.
// ============================================================================

export type PcTool =
  | { tool: 'screenshot' }
  | { tool: 'open'; target: string }
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

const PC_SYSTEM = `You are Nalu Catalina — a world-class expert at operating a Mac who can do ANYTHING on this computer. You accomplish the user's task by controlling the machine step by step. You are shown SCREENSHOTS of the current screen; look carefully, then act.

Reply with EXACTLY one JSON object in a \`\`\`json fence and nothing else (one short reasoning sentence before it is allowed):
{"tool":"screenshot"}                          // see the screen right now
{"tool":"open","target":"Safari" | "https://..."}  // open an app or URL
{"tool":"applescript","script":"..."}          // PREFERRED for reliable app control (Mail, Safari, Calendar, Messages, System Events)
{"tool":"shell","command":"..."}               // run a terminal command
{"tool":"type","text":"..."}                   // type text into the focused field
{"tool":"key","combo":"cmd+t"}                  // press a key/shortcut (return, tab, cmd+l, etc.)
{"tool":"click","x":100,"y":200,"double":false} // click at screen coordinates (from the screenshot)
{"tool":"done","summary":"..."}

RULES: Prefer AppleScript for anything an app scripts (composing/sending mail, opening URLs in Safari, creating Calendar events, sending Messages) — it's far more reliable than clicking. Use screenshots + click only for GUI elements you can't script. Take a screenshot after actions that change the screen so you can verify. Work autonomously toward the goal; don't ask questions mid-task. When finished, use "done".`

function parsePc(text: string): { thought: string; action: PcTool | null } {
  const fence = text.match(/```json\s*([\s\S]*?)```/) || text.match(/```\s*(\{[\s\S]*?\})\s*```/)
  const thought = (fence ? text.slice(0, text.indexOf(fence[0])) : text).trim()
  const raw = fence ? fence[1] : (text.match(/\{[\s\S]*\}/) || [])[0]
  if (!raw) return { thought, action: null }
  try { return { thought, action: JSON.parse(raw) as PcTool } } catch { return { thought, action: null } }
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
  const maxSteps = opts.maxSteps ?? 20
  const history: WireMessage[] = [{ role: 'system', content: PC_SYSTEM }]
  let lastShot = ''

  const capture = async () => {
    const url = await window.nalu.pc.screenshot()
    if (url) { lastShot = url; onStep({ kind: 'screenshot', url }) }
    return url
  }
  await capture() // start by looking

  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return
    // ask the model, showing it the latest screenshot
    const prompt = step === 0 ? `TASK: ${task}\n\nHere is the current screen. Decide the next action.` : 'Here is the current screen. Decide the next action.'
    const turn: WireMessage = lastShot ? imageMessage(prompt, lastShot) : { role: 'user', content: prompt }
    let reply = ''
    await streamChat([...history, turn], { specialist: 'vision', signal, onDelta: (t) => (reply += t) })
    history.push(turn, { role: 'assistant', content: reply })

    const { thought, action } = parsePc(reply)
    if (thought) onStep({ kind: 'thought', text: thought })
    if (!action) { onStep({ kind: 'error', text: 'Could not parse an action; stopping.' }); return }
    if (action.tool === 'done') { onStep({ kind: 'done', text: action.summary || 'Done.' }); return }
    onStep({ kind: 'action', action })

    // gate anything that changes the machine
    const risky = action.tool !== 'screenshot'
    if (risky && !(opts.autoApprove?.() ?? false) && !(await approve(action))) {
      onStep({ kind: 'result', text: 'DENIED by user.' })
      history.push({ role: 'user', content: 'The user denied that action. Try a different approach or ask via done.' })
      continue
    }

    let result = ''
    try {
      if (action.tool === 'screenshot') { await capture(); result = 'screenshot taken.' }
      else if (action.tool === 'open') { result = (await window.nalu.pc.open(action.target)) ? `opened ${action.target}` : `could not open ${action.target}` }
      else if (action.tool === 'shell') { const r = await window.nalu.exec('', action.command); result = `exit ${r.code}\n${r.output.slice(0, 6000)}` }
      else if (action.tool === 'applescript') { const r = await window.nalu.pc.applescript(action.script); result = (r.ok ? 'ok ' : 'error ') + r.out.slice(0, 4000) }
      else if (action.tool === 'type') { await window.nalu.pc.type(action.text); result = 'typed.' }
      else if (action.tool === 'key') { await window.nalu.pc.key(action.combo); result = `pressed ${action.combo}.` }
      else if (action.tool === 'click') { const ok = await window.nalu.pc.click(action.x, action.y, action.double); result = ok ? 'clicked.' : 'click failed (install cliclick for precise clicks; use AppleScript/keys instead).' }
    } catch (e) { result = `ERROR: ${e instanceof Error ? e.message : 'failed'}` }
    onStep({ kind: 'result', text: result })
    history.push({ role: 'user', content: `RESULT: ${result}` })

    // auto-capture after screen-changing actions so the model can verify
    if (['open', 'type', 'key', 'click'].includes(action.tool)) { await new Promise((r) => setTimeout(r, 800)); await capture() }
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
