import { streamChat, type WireMessage } from './naluApi'

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
