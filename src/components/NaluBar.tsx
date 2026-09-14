import { interpretTask, type WorkMode } from '../lib/taskIntent'
import { execWithSignal } from '../lib/execWithSignal'
import { createTerminalExecutor, runTerminalAgent } from '../lib/terminalAgent'
import { extractProposedFile } from '../lib/editProposal'
import { awaitApproval } from '../lib/approval'
import { useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react'
import { ArrowUp, Check, Square, ChevronDown, X, FileText, FolderTree, Search as SearchIcon, Terminal, Pencil, CheckCircle2, Monitor, MousePointerClick, Sparkles, ArrowRight, Loader2 } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { logTask, streamChat, type WireMessage } from '../lib/naluApi'
import { getModelSettings } from '../lib/settings'
import { indexWorkspace, CONTEXT_INDEX_LIMIT } from '../lib/workspaceIndex'

// A local id so we can log a task's start and finish without waiting on the
// server round-trip for an id. Time+random keeps it unique per run.
function newTaskId(): string {
  return 'ide_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
import { runAgent, runComputer, type AgentStep, type AgentTool, type PcStep, type PcTool } from '../lib/agent'
import wolfUrl from '../lib/wolf'
import ChangePreview from './ChangePreview'
import BrowserPreview from './BrowserPreview'
import MessageContent from './MessageContent'
import type { FileChangePreview } from '../lib/agent'

type Msg = { role: 'user' | 'assistant'; text: string; specialist?: string; proposed?: FileChangePreview; proposalError?: string; appliedPath?: string }
type TermLine = { req?: string; cmd?: string; out?: string; running?: boolean; done?: string }
type Mode = WorkMode | 'auto'
const MODES: [Mode, string, string][] = [
  ['auto', 'Auto', 'Describe your task. Nalu chooses the right tools and asks when it needs more detail.'],
  ['chat', 'Chat', 'Ask questions, write, research or plan. Chat does not run commands or change files.'],
  ['agent', 'Agent', 'Let Nalu inspect, edit and verify your project. Review actions before they run.'],
  ['computer', 'PC', 'Ask Nalu to work with apps and websites. Review each action before it runs.'],
  ['edit', 'Edit', 'Describe a change to the open file, then review and apply the proposed diff.'],
  ['terminal', 'Terminal', 'Describe a terminal task. Nalu proposes commands and reads their results.'],
]

// The heart of the one-interface design: a Nalu prompt bar that's ALWAYS at the
// bottom. Asking opens a conversation thread that slides up above it; it can
// chat, edit the open file (Apply/Reject), or answer about your code.
export default function NaluBar() {
  const ws = useWorkspace()
  const [mode, setMode] = useState<Mode>('auto')
  const [automatic, setAutomatic] = useState(true)
  const selectedMode = automatic ? 'auto' : mode
  const [conversations, setConversations] = useState<{ chat: Msg[]; edit: Msg[] }>({ chat: [], edit: [] })
  const conversationMode = mode === 'edit' ? 'edit' : 'chat'
  const msgs = conversations[conversationMode]
  const setMsgs = (value: SetStateAction<Msg[]>) => setConversations(previous => ({ ...previous, [conversationMode]: typeof value === 'function' ? value(previous[conversationMode]) : value }))
  const [drafts, setDrafts] = useState<Record<Mode, string>>({ auto: '', chat: '', agent: '', computer: '', edit: '', terminal: '' })
  const draftMode = automatic ? 'auto' : mode
  const input = drafts[draftMode]
  const setInput = (value: SetStateAction<string>) => setDrafts(previous => ({ ...previous, [draftMode]: typeof value === 'function' ? value(previous[draftMode]) : value }))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [activeTask, setActiveTask] = useState('')
  const [taskMode, setTaskMode] = useState<Mode>('auto')
  const [notice, setNotice] = useState('')
  const [interpreting, setInterpreting] = useState(false)
  const [applying, setApplying] = useState<{ index: number; preview: FileChangePreview } | null>(null)
  const [open, setOpen] = useState(false) // thread expanded?
  const [agentLog, setAgentLog] = useState<AgentStep[]>([])
  const [pending, setPending] = useState<{ action: AgentTool; preview?: FileChangePreview; resolve: (ok: boolean) => void } | null>(null)
  const [pcLog, setPcLog] = useState<PcStep[]>([])
  const [pcPending, setPcPending] = useState<{ action: PcTool; resolve: (ok: boolean) => void } | null>(null)
  const [autoApprove, setAutoApprove] = useState(false)
  const autoRef = useRef(false); autoRef.current = autoApprove
  const [termLog, setTermLog] = useState<TermLine[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const terminalExecutors = useRef(new Map<string, ReturnType<typeof createTerminalExecutor>>())
  useEffect(() => () => { abortRef.current?.abort() }, [])
  useEffect(() => {
    if (!applying) return
    const applied = ws.tabs.some(tab => tab.path === applying.preview.path && tab.content === applying.preview.after)
    setConversations(previous => ({ ...previous, edit: previous.edit.map((message, index) => index !== applying.index ? message : applied
      ? { ...message, proposed: undefined, proposalError: undefined, text: message.text, appliedPath: applying.preview.path }
      : { ...message, proposalError: 'The original file changed or was closed. Review its current contents and request a new edit.' }) }))
    setApplying(null)
  }, [applying, ws.tabs])
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollDown = () => requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })

  // @-mentions (Cursor-style): type @ to fuzzy-pick a file/folder → drop its path
  // into the prompt so Nalu uses it as context.
  const [files, setFiles] = useState<string[]>([])
  const [indexStatus, setIndexStatus] = useState('')
  const [at, setAt] = useState<{ q: string; sel: number } | null>(null)
  useLayoutEffect(() => { setAt(null) }, [ws.folder])
  useLayoutEffect(() => {
    const controller = new AbortController()
    setFiles([])
    setIndexStatus(ws.folder ? 'Finding project files…' : 'Open a folder to add file context.')
    void (async () => {
      if (!ws.folder) return
      try {
        const result = await indexWorkspace(ws.folder, window.nalu.readDir, controller.signal)
        if (controller.signal.aborted) return
        setFiles(result.paths)
        setIndexStatus([
          result.limited ? `File context is limited to ${CONTEXT_INDEX_LIMIT} entries.` : '',
          result.unreadable ? 'Some folders could not be read.' : '',
        ].filter(Boolean).join(' '))
      } catch (error) {
        if (!controller.signal.aborted) setIndexStatus(`Could not list project files: ${String(error).replace(/^Error:\s*/, '').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')}`)
      }
    })()
    return () => controller.abort()
  }, [ws.folder, ws.refreshKey])
  const atMatches = at ? files.filter((f) => f.toLowerCase().includes(at.q.toLowerCase())).slice(0, 8) : []
  const atSelection = Math.min(at?.sel || 0, Math.max(0, atMatches.length - 1))
  const onInputChange = (v: string) => {
    setInput(v)
    const m = v.match(/(?:^|\s)@([^\s@]*)$/)
    setAt(m ? { q: m[1], sel: 0 } : null)
  }
  const pickAt = (rel: string) => { setInput((v) => v.replace(/@[^\s@]*$/, () => rel + ' ')); setAt(null) }

  const runAgentTask = async (task: string) => {
    setAgentLog([{ kind: 'thought', text: `Task: ${task}` }])
    setOpen(true); setBusy(true)
    const ctrl = new AbortController(); abortRef.current = ctrl
    // AutoPilot: this IDE task shows on the phone (per-user), live.
    const taskId = newTaskId()
    void logTask({ id: taskId, title: task.slice(0, 200), detail: `IDE agent · ${ws.folder?.split('/').pop() || 'workspace'}`, status: 'running', progress: 0.05, event: 'Agent task started' })
    let agentCompleted = false
    try {
      await runAgent({
        task, folder: ws.folder, signal: ctrl.signal,
        onStep: (s) => { if (s.kind === 'done') agentCompleted = true; if (s.kind === 'error') agentCompleted = false; setAgentLog((p) => [...p, s]); if (s.kind === 'result' || s.kind === 'action') { ws.refresh(); void ws.reloadTabs() } scrollDown() },
        approve: (action, preview) => (autoRef.current ? Promise.resolve(true) : awaitApproval(ctrl.signal, resolve => setPending({ action, preview, resolve }))),
      })
      void logTask({ id: taskId, status: ctrl.signal.aborted ? 'cancelled' : agentCompleted ? 'done' : 'failed', progress: agentCompleted && !ctrl.signal.aborted ? 1 : 0.5, event: ctrl.signal.aborted ? 'Stopped' : agentCompleted ? 'Completed' : 'Task incomplete' })
    } catch (e) {
      if (!ctrl.signal.aborted) setAgentLog((p) => [...p, { kind: 'error', text: e instanceof Error ? e.message : 'agent error' }])
      void logTask({ id: taskId, status: ctrl.signal.aborted ? 'cancelled' : 'failed', event: ctrl.signal.aborted ? 'Stopped' : e instanceof Error ? e.message.slice(0, 200) : 'agent error' })
    } finally { busyRef.current = false; setBusy(false); if (ctrl.signal.aborted) setNotice('Stopped.'); abortRef.current = null; setPending(null) }
  }

  const runComputerTask = async (task: string) => {
    setPcLog([{ kind: 'thought', text: `Task: ${task}` }]); setOpen(true); setBusy(true)
    const ctrl = new AbortController(); abortRef.current = ctrl
    const taskId = newTaskId()
    void logTask({ id: taskId, title: task.slice(0, 200), detail: 'IDE computer use', status: 'running', progress: 0.05, event: 'Computer task started' })
    let agentCompleted = false
    try {
      const perms = await window.nalu.pc.permissions(true)
      if (ctrl.signal.aborted) return
      if (perms.platform !== 'darwin') setPcLog(p => [...p, { kind: 'thought', text: 'Native app and screen control currently requires macOS. The built-in browser and shell are available on this platform.' }])
      else {
        if (!perms.accessibility) setPcLog((p) => [...p, { kind: 'thought', text: 'Native mouse and keyboard control requires macOS Accessibility permission in System Settings → Privacy & Security → Accessibility. The built-in browser and terminal remain available.' }])
        if (!perms.screen) setPcLog((p) => [...p, { kind: 'thought', text: 'Screen capture requires Screen Recording permission. Browser page capture remains available.' }])
      }
      await runComputer({
        task, capabilities: perms, signal: ctrl.signal, autoApprove: () => autoRef.current,
        onStep: (s) => { if (s.kind === 'done') agentCompleted = true; if (s.kind === 'error') agentCompleted = false; setPcLog((p) => [...p, s]); scrollDown() },
        approve: (action) => awaitApproval(ctrl.signal, resolve => setPcPending({ action, resolve })),
      })
      void logTask({ id: taskId, status: ctrl.signal.aborted ? 'cancelled' : agentCompleted ? 'done' : 'failed', progress: agentCompleted && !ctrl.signal.aborted ? 1 : 0.5, event: ctrl.signal.aborted ? 'Stopped' : agentCompleted ? 'Completed' : 'Task incomplete' })
    } catch (e) {
      if (!ctrl.signal.aborted) setPcLog((p) => [...p, { kind: 'error', text: e instanceof Error ? e.message : 'error' }])
      void logTask({ id: taskId, status: ctrl.signal.aborted ? 'cancelled' : 'failed', event: ctrl.signal.aborted ? 'Stopped' : e instanceof Error ? e.message.slice(0, 200) : 'error' })
    }
    finally { if (ctrl.signal.aborted) void logTask({ id: taskId, status: 'cancelled', event: 'Stopped' }); busyRef.current = false; setBusy(false); if (ctrl.signal.aborted) setNotice('Stopped.'); abortRef.current = null; setPcPending(null) }
  }

  // AI TERMINAL AGENT: you prompt it, and Nalu does whatever it takes on your
  // computer — running commands step by step, reading each result to decide the
  // next, with a PERSISTENT working directory (cd sticks across steps).
  const runTermCmd = async (request: string) => {
    setOpen(true); setBusy(true)
    const ctrl = new AbortController(); abortRef.current = ctrl
    const root = ws.folder || ''
    let runOne = terminalExecutors.current.get(root)
    if (!runOne) {
      runOne = createTerminalExecutor(root, (cwd, command) => execWithSignal(cwd, command, abortRef.current?.signal))
      terminalExecutors.current.set(root, runOne)
    }
    const termTaskId = newTaskId()
    let termErr = '', termCompleted = false
    try {
      setTermLog((p) => [...p, { req: request, cmd: '', out: '', running: true }]); scrollDown()
      void logTask({ id: termTaskId, title: request.slice(0, 200), detail: 'IDE terminal agent', status: 'running', progress: 0.05, event: 'Started' })
      termCompleted = await runTerminalAgent({
        request, signal: ctrl.signal, run: runOne,
        approve: command => autoRef.current ? Promise.resolve(true) : awaitApproval(ctrl.signal, resolve => setPending({ action: { tool: 'run', command }, resolve })),
        reply: async (history) => {
          let response = ''
          await streamChat(history, { specialist: 'code', signal: ctrl.signal, onDelta: t => { response += t } })
          return response
        },
        onLine: (line, replace) => {
          setTermLog(p => replace ? [...p.slice(0, -1), line] : [...p, line])
          scrollDown()
        },
      })
    } catch (e) {
      termErr = e instanceof Error ? e.message : String(e)
      if (!ctrl.signal.aborted) setTermLog(p => [...p, { out: termErr }])
    } finally {
      setTermLog(p => p.map(line => ({ ...line, running: false })))
      busyRef.current = false; setBusy(false); if (ctrl.signal.aborted) setNotice('Stopped.'); abortRef.current = null; setPending(null); scrollDown()
      if (termTaskId) {
        void logTask({
          id: termTaskId,
          status: ctrl.signal.aborted ? 'cancelled' : termCompleted ? 'done' : 'failed',
          progress: termCompleted && !ctrl.signal.aborted ? 1 : 0.5,
          event: ctrl.signal.aborted ? 'Stopped' : termErr ? termErr.slice(0, 200) : termCompleted ? 'Completed' : 'Task incomplete',
        })
      }
    }
  }

  const send = async () => {
    const content = input.trim()
    if (!content || busyRef.current) return
    if (!automatic && mode === 'edit' && !ws.active) { setNotice('Open a file before requesting an edit.'); return }
    busyRef.current = true
    setActiveTask(content); setTaskMode(automatic ? 'auto' : mode)
    setNotice(''); setAt(null)
    setOpen(true)
    let executionMode: WorkMode
    if (automatic || mode === 'auto') {
      const ctrl = new AbortController(); abortRef.current = ctrl
      setBusy(true); setInterpreting(true); setAutoApprove(false)
      try {
        const intent = await interpretTask(content, { folder: ws.folder, file: ws.active?.path || null }, async messages => {
          let response = ''
          await streamChat(messages, { specialist: 'reasoning', webSearch: false, maxTokens: 512, signal: ctrl.signal, onDelta: text => { response += text } })
          return response
        }, ctrl.signal)
        if ('question' in intent) {
          setNotice(intent.question); busyRef.current = false; setBusy(false)
          return
        }
        executionMode = intent.mode
        setMode(executionMode)
        setNotice(`${MODES.find(([m]) => m === executionMode)?.[1]} · ${intent.reason}`)
      } catch (error) {
        setNotice(ctrl.signal.aborted ? 'Stopped. Your task is still here.' : error instanceof Error ? error.message : 'Could not interpret the task. Try again.')
        busyRef.current = false; setBusy(false)
        return
      } finally { setInterpreting(false); abortRef.current = null }
    } else executionMode = mode
    setTaskMode(executionMode)
    setInput('')
    // Pin updates to the chosen transcript; a routing state update is asynchronous.
    const target = executionMode === 'edit' ? 'edit' : 'chat'
    const taskMessages = conversations[target]
    const updateMessages = (value: SetStateAction<Msg[]>) => setConversations(previous => ({ ...previous, [target]: typeof value === 'function' ? value(previous[target]) : value }))
    if (executionMode === 'agent') { void runAgentTask(content); return }
    if (executionMode === 'computer') { void runComputerTask(content); return }
    if (executionMode === 'terminal') { void runTermCmd(content); return }
    const file = ws.active
    let userContent = content
    if (file && executionMode === 'edit') {
      userContent = `${content}\n\nThe user is editing ${file.name}. Return the COMPLETE updated file in ONE fenced code block, nothing else. Use a longer outer fence if the file contains code fences.\n\nCurrent ${file.name}:\n${JSON.stringify(file.content)}`
    } else if (file) {
      userContent = `${content}\n\n(Context — the open file ${file.name}:)\n\`\`\`\n${file.content.slice(0, 8000)}\n\`\`\``
    }
    const history: WireMessage[] = [
      ...taskMessages.map((m) => ({ role: m.role, content: m.text }) as WireMessage),
      { role: 'user', content: userContent },
    ]
    updateMessages((p) => [...p, { role: 'user', text: content }, { role: 'assistant', text: '' }])
    scrollDown()
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let acc = ''
    try {
      await streamChat(history, {
        specialist: executionMode === 'chat' ? undefined : 'code',
        signal: ctrl.signal,
        onRoute: (name) => {
          ws.setRouteName(name)
          updateMessages((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], specialist: name }; return c })
        },
        onDelta: (t) => {
          acc += t
          if (!getModelSettings().streaming) return // stream OFF → reveal at the end
          updateMessages((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], text: acc }; return c })
          scrollDown()
        },
      })
      if (!getModelSettings().streaming) { updateMessages((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], text: acc }; return c }); scrollDown() }
      if (file && executionMode === 'edit' && !ctrl.signal.aborted) {
        const code = extractProposedFile(acc)
        if (code !== null && code !== file.content) updateMessages((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], proposed: { path: file.path, before: file.content, after: code } }; return c })
        else if (code === null) updateMessages(p => p.map((m, i) => i === p.length - 1 ? { ...m, proposalError: 'No complete file proposal was returned. Request the edit again.' } : m))
      }
    } catch (e) {
      if (!ctrl.signal.aborted) updateMessages((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], text: acc + `\n\n${e instanceof Error ? e.message : 'Request failed.'}` }; return c })
    } finally {
      busyRef.current = false; setBusy(false); if (ctrl.signal.aborted) setNotice('Stopped.'); abortRef.current = null
    }
  }

  const apply = (preview: FileChangePreview, i: number) => {
    if (preview.before !== null && ws.applyEditProposal(preview.path, preview.before, preview.after)) setApplying({ index: i, preview })
    else setMsgs(p => p.map((m, idx) => idx === i ? { ...m, proposalError: 'The original file changed, has a disk conflict, or was closed. Request a new edit from its current contents.' } : m))
  }

  const selectMode = (next: Mode) => {
    if (busyRef.current) return
    setMode(next); setAutomatic(next === 'auto'); setAt(null); setNotice(''); setOpen(true)
    setAutoApprove(false)
  }

  const historyCount = mode === 'auto' ? 0 : mode === 'computer' ? pcLog.length : mode === 'terminal' ? termLog.length : mode === 'agent' ? agentLog.length : msgs.length
  const starters: Record<Mode, string[]> = {
    auto: ['Build something from an idea', 'Help me with a work task'],
    chat: ['Explain this project', 'Help me understand this file'],
    agent: ['Find and fix a bug', 'Build a feature and test it'],
    computer: ['Help me work in the browser', 'Organize files on my computer'],
    edit: ['Make this file easier to read', 'Add useful comments'],
    terminal: ['Explain how to run this project', 'Check the project’s Git status'],
  }
  const startPrompt = (text: string) => { setInput(text); requestAnimationFrame(() => promptRef.current?.focus()) }
  useEffect(() => {
    const compose = (event: Event) => {
      const detail = (event as CustomEvent<{ mode: Mode; prompt?: string }>).detail
      if (busyRef.current || !detail || !MODES.some(([m]) => m === detail.mode)) return
      setMode(detail.mode); setAutomatic(detail.mode === 'auto'); setAutoApprove(false); setNotice(''); setOpen(true)
      if (detail.prompt !== undefined) setDrafts(p => ({ ...p, [detail.mode]: detail.prompt! }))
      requestAnimationFrame(() => promptRef.current?.focus())
    }
    window.addEventListener('nalu:compose', compose)
    return () => window.removeEventListener('nalu:compose', compose)
  }, [])
  useLayoutEffect(() => {
    const el=promptRef.current
    if (!el) return
    el.style.height='auto'; el.style.height=`${Math.min(150, Math.max(70, el.scrollHeight))}px`
  }, [input])

  const toolIcon = (t: string) => t === 'read_file' ? FileText : t === 'list_dir' ? FolderTree : t === 'search' ? SearchIcon : t === 'run' ? Terminal : Pencil
  const toolLabel = (a: AgentTool) => a.tool === 'read_file' ? `Read ${a.path}` : a.tool === 'list_dir' ? `List ${a.path}` : a.tool === 'search' ? `Search "${a.query}"` : a.tool === 'run' ? `Run: ${a.command}` : a.tool === 'write_file' ? `Create ${a.path}` : a.tool === 'edit_file' ? `Edit ${a.path}` : 'Done'

  // Short human title for an action.
  const stopTask = () => { setNotice('Stopping…'); abortRef.current?.abort(); void window.nalu.pc.browserCancel() }
  const pcLabel = (a: PcTool) => a.tool === 'browse' ? 'Open website' : a.tool === 'read_page' ? 'Read the page' : a.tool === 'page_js' ? 'Act on the page' : a.tool === 'click_el' ? 'Click element' : a.tool === 'fill' ? 'Fill field' : a.tool === 'scroll' ? 'Scroll page' : a.tool === 'type_text' ? 'Type text' : a.tool === 'press' ? `Press ${a.key}` : a.tool === 'open' ? `Open ${a.target}` : a.tool === 'shell' ? 'Run command' : a.tool === 'applescript' ? 'Control an app (AppleScript)' : a.tool === 'type' ? 'Type text' : a.tool === 'key' ? `Press ${a.combo}` : a.tool === 'click' ? `Click at ${a.x}, ${a.y}` : a.tool === 'see' ? 'Look at the screen' : 'Finish'
  // The exact thing being done — so you see (and can approve) precisely what runs.
  const pcDetail = (a: PcTool): string => a.tool === 'browse' ? a.url : a.tool === 'page_js' ? a.code : a.tool === 'click_el' ? a.selector : a.tool === 'fill' ? `${a.selector}: ${a.text}` : a.tool === 'scroll' ? `${a.x}, ${a.y} pixels` : a.tool === 'type_text' ? a.text : a.tool === 'shell' ? a.command : a.tool === 'applescript' ? a.script : a.tool === 'type' ? a.text : a.tool === 'open' ? a.target : ''

  const activityMessages = conversations[taskMode === 'edit' ? 'edit' : 'chat']
  const proposalReady = taskMode === 'edit' && !!activityMessages.at(-1)?.proposed
  const lastAgent = agentLog.at(-1), lastPc = pcLog.at(-1)
  const activityStatus = interpreting ? 'Understanding your task and choosing the right tools.'
    : pending ? `Waiting for approval: ${toolLabel(pending.action)}`
    : pcPending ? `Waiting for approval: ${pcLabel(pcPending.action)}`
    : proposalReady && !busy ? 'Your proposed edit is ready to review.'
    : !busy && notice && !/^(Chat|Agent|PC|Edit|Terminal) · /.test(notice) ? notice
    : taskMode === 'agent' && lastAgent ? lastAgent.kind === 'action' ? toolLabel(lastAgent.action) : lastAgent.kind === 'done' || lastAgent.kind === 'error' ? lastAgent.text.slice(0,300) : busy ? 'Checking the project and choosing the next step.' : 'Task finished.'
    : taskMode === 'computer' && lastPc ? lastPc.kind === 'action' ? pcLabel(lastPc.action) : lastPc.kind === 'done' || lastPc.kind === 'error' ? lastPc.text.slice(0,300) : busy ? 'Checking the result of the last computer action.' : 'Task finished.'
    : taskMode === 'terminal' ? busy ? 'Running or reviewing a terminal command.' : termLog.at(-1)?.done || 'Terminal task finished.'
    : taskMode === 'edit' && busy ? 'Preparing a proposed edit for your review.'
    : busy ? 'Writing a reply.' : activityMessages.at(-1)?.text.slice(0,300) || notice || 'Ready for your next task.'
  useEffect(() => { window.nalu.companion?.activity('assistant', busy, { task: activeTask, status: activityStatus, needsApproval: !!pending || !!pcPending || proposalReady }); }, [busy, activeTask, activityStatus, !!pending, !!pcPending, proposalReady])

  return (
    <section className="nalu-assistant">
      <div className="assistant-heading"><div className="flex items-center gap-2"><img src={wolfUrl} alt=""/><span>Nalu</span></div><span role="status" className={`assistant-status ${busy ? 'is-busy' : ''}`}>{busy ? <Loader2 size={12} className="animate-spin"/> : <span className="status-dot"/>}{pending || pcPending ? 'Needs approval' : interpreting ? 'Understanding' : busy ? 'Working' : 'Ready'}</span></div>
            <div role="tablist" aria-label="Nalu work mode" className="assistant-modes">
              {MODES.map(([m, label, description], i) => (
                <button key={m} id={`nalu-mode-${m}`} aria-controls="nalu-mode-panel" role="tab" aria-selected={selectedMode === m} tabIndex={selectedMode === m ? 0 : -1} disabled={busy} title={description} onClick={() => selectMode(m)} onKeyDown={e => {
                  const next = e.key === 'ArrowRight' ? (i + 1) % MODES.length : e.key === 'ArrowLeft' ? (i + MODES.length - 1) % MODES.length : e.key === 'Home' ? 0 : e.key === 'End' ? MODES.length - 1 : -1
                  if (next < 0 || busyRef.current) return
                  e.preventDefault(); selectMode(MODES[next][0]); (e.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus()
                }} className={`rounded-full px-2.5 py-0.5 transition-colors disabled:opacity-60 ${selectedMode === m ? 'bg-gold text-[#15170f]' : 'text-dim hover:text-ink'}`}>{label}</button>
              ))}
            </div>
      <p id="nalu-mode-description" className="assistant-description">{MODES.find(([m]) => m === selectedMode)?.[2]}</p>
      {mode === 'computer' && <BrowserPreview busy={busy} onStop={stopTask}/>}
      <div id="nalu-mode-panel" role="tabpanel" aria-labelledby={`nalu-mode-${selectedMode}`} className="assistant-thread">
      {(!open || !historyCount) && <div className="assistant-empty"><div className="assistant-empty-icon"><Sparkles size={22}/></div><h2>{mode === 'auto' ? 'What would you like to do?' : mode === 'edit' ? 'A better version, together.' : mode === 'terminal' ? 'Say what you want to run.' : mode === 'computer' ? 'Your next task, handled.' : mode === 'agent' ? 'From idea to working code.' : 'A little clarity goes a long way.'}</h2><p>{mode === 'edit' && !ws.active ? 'Open a file, describe the change, and review the result.' : 'Start with a question or choose an idea below.'}</p><div className="starter-list">{starters[mode].map(text => <button key={text} onClick={() => startPrompt(text)}>{text}<ArrowRight size={13}/></button>)}</div>{historyCount > 0 && <button className="text-gold" onClick={() => setOpen(true)}>Show conversation</button>}</div>}

      {/* COMPUTER transcript — Nalu Catalina operating the whole Mac (it SEES the screen) */}
      {open && mode === 'computer' && pcLog.length > 0 && (
        <div className="nalu-transcript">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-gold"><Monitor size={12} /> Computer actions</span>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-dim"><input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} className="accent-[#af8c56]" /> auto-run</label>
              <button aria-label="Clear PC history" disabled={busy} onClick={() => { setPcLog([]); setOpen(false) }} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink disabled:opacity-40"><X size={13} /></button>
            </div>
          </div>
          <div ref={scrollRef} className="transcript-scroll space-y-3">
            {pcLog.map((s, i) => {
              if (s.kind === 'thought') return <div key={i} className="text-[11px] italic text-dim">{s.text}</div>
              if (s.kind === 'action') {
                const d = pcDetail(s.action)
                return (
                  <div key={i}>
                    <div className="flex items-center gap-1.5 font-medium text-ink"><MousePointerClick size={13} className="shrink-0 text-gold" /><span>{pcLabel(s.action)}</span></div>
                    {d && <pre className="ml-[18px] mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-black/25 px-2 py-1 font-mono text-[10.5px] text-gold/90">{d}</pre>}
                  </div>
                )
              }
              // RESULT = the proof of what happened — shown in full (scrollable).
              if (s.kind === 'result') return <div key={i} className="ml-[18px] max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-glass/[0.04] px-2 py-1 text-[11px] text-dim">{s.text}</div>
              if (s.kind === 'screenshot') return <div key={i}><div className="mb-1 text-[10px] uppercase tracking-wide text-dim">what Nalu sees:</div><img src={s.url} alt="screen" className="max-h-56 w-full rounded-lg border border-glass/[0.12] object-contain" /></div>
              if (s.kind === 'done') return <div key={i} className="flex items-start gap-1.5 whitespace-pre-wrap font-medium text-gold"><CheckCircle2 size={14} className="mt-0.5 shrink-0" />{s.text}</div>
              return <div key={i} className="whitespace-pre-wrap rounded bg-red-500/10 px-2 py-1 text-red-300">{s.text}</div>
            })}
            {pcPending && (
              <div className="rounded-xl border border-gold/40 bg-panel2 p-2.5">
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-dim">Approve this action:</div>
                <div className="text-[12px] font-semibold text-gold">{pcLabel(pcPending.action)}</div>
                {pcDetail(pcPending.action) && <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 px-2 py-1 font-mono text-[10.5px] text-ink">{pcDetail(pcPending.action)}</pre>}
                <div className="mt-2 flex gap-1.5">
                  <button onClick={() => { pcPending.resolve(true); setPcPending(null) }} className="rounded-md bg-gold/90 px-2.5 py-1 text-[11px] font-medium text-[#15170f] hover:bg-gold">Approve</button>
                  <button onClick={() => { pcPending.resolve(false); setPcPending(null) }} className="rounded-md border border-glass/[0.1] px-2.5 py-1 text-[11px] text-dim hover:text-ink">Deny</button>
                  <label className="ml-auto flex cursor-pointer items-center gap-1 text-[10px] text-dim"><input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} className="accent-[#af8c56]" /> approve the rest</label>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TERMINAL — chat that runs shell commands in your folder */}
      {open && mode === 'terminal' && termLog.length > 0 && (
        <div className="nalu-transcript">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-gold"><Terminal size={12} /> Nalu Terminal</span>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-dim"><input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} className="accent-[#af8c56]" /> auto-run</label>
              <button aria-label="Clear Terminal history" disabled={busy} onClick={() => setTermLog([])} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink disabled:opacity-40"><X size={13} /></button>
            </div>
          </div>
          <div ref={scrollRef} className="transcript-scroll space-y-3">
            {termLog.map((l, i) => (
              <div key={i}>
                {l.req && <div className="text-dim">you ❯ <span className="text-ink">{l.req}</span></div>}
                {l.cmd && <div className="mt-0.5 text-gold">nalu ❯ <span className="text-ink">{l.cmd}</span></div>}
                {!l.cmd && !l.done && l.running && <div className="mt-0.5 text-dim/70">nalu ❯ thinking…</div>}
                {l.out && <pre className="mt-0.5 whitespace-pre-wrap text-[11px] text-dim">{l.out}</pre>}
                {l.done && <div className="flex items-center gap-1.5 font-medium text-gold"><CheckCircle2 size={13} /> {l.done}</div>}
              </div>
            ))}
            {pending?.action.tool === 'run' && (
              <div className="rounded-xl border border-gold/40 bg-panel2 p-2.5">
                <div className="mb-2 text-[11px] text-ink">Approve this command?</div>
                <pre className="mb-2 whitespace-pre-wrap break-all text-gold">{pending.action.command}</pre>
                <div className="flex gap-2">
                  <button onClick={() => { pending.resolve(true); setPending(null) }} className="rounded-md bg-gold px-2.5 py-1 text-[#15170f]">Approve</button>
                  <button onClick={() => { pending.resolve(false); setPending(null) }} className="rounded-md border border-glass/10 px-2.5 py-1 text-dim">Deny</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AGENT transcript — the autonomous read/edit/run loop */}
      {open && mode === 'agent' && agentLog.length > 0 && (
        <div className="nalu-transcript">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-gold">Agent</span>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-dim"><input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} className="accent-[#af8c56]" /> auto-run</label>
              <button aria-label="Clear Agent history" disabled={busy} onClick={() => { setAgentLog([]); setOpen(false) }} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink disabled:opacity-40"><X size={13} /></button>
            </div>
          </div>
          <div ref={scrollRef} className="transcript-scroll space-y-3">
            {agentLog.map((s, i) => {
              if (s.kind === 'thought') return <div key={i} className="text-dim">{s.text}</div>
              if (s.kind === 'action') { const Icon = toolIcon(s.action.tool); return <div key={i} className="flex items-center gap-1.5 font-medium text-ink"><Icon size={13} className="shrink-0 text-gold" /><span className="truncate">{toolLabel(s.action)}</span></div> }
              if (s.kind === 'result') return <pre key={i} className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-panel2 px-2 py-1.5 text-[11px] text-dim">{s.text.slice(0, 1200)}</pre>
              if (s.kind === 'done') return <div key={i} className="flex items-start gap-1.5 font-medium text-gold"><CheckCircle2 size={14} className="mt-0.5 shrink-0" />{s.text}</div>
              return <div key={i} className="text-red-300">{s.text}</div>
            })}
            {pending && (
              <div className="mt-1 rounded-xl border border-gold/40 bg-panel2 p-2">
                <div className="mb-1.5 text-[11px] text-ink">Approve this action?</div>
                <div className="mb-2 truncate text-[12px] font-medium text-gold">{toolLabel(pending.action)}</div>
                {pending.preview && <ChangePreview preview={pending.preview} hasUnsavedEdits={ws.tabs.some(tab => tab.path === pending.preview?.path && tab.dirty)} />}
                {pending.action.tool === 'run' && <pre className="mb-2 whitespace-pre-wrap rounded bg-panel px-2 py-1 text-[11px] text-dim">{pending.action.command}</pre>}
                <div className="flex gap-1.5">
                  <button onClick={() => { pending.resolve(true); setPending(null) }} className="flex items-center gap-1 rounded-md bg-gold/90 px-2.5 py-1 text-[11px] font-medium text-[#15170f] hover:bg-gold"><Check size={12} /> Approve</button>
                  <button onClick={() => { pending.resolve(false); setPending(null) }} className="rounded-md border border-glass/[0.1] px-2.5 py-1 text-[11px] text-dim hover:text-ink">Deny</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* conversation thread — expands above the prompt when there's a chat */}
      {open && (mode === 'chat' || mode === 'edit') && msgs.length > 0 && (
        <div className="nalu-transcript">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-dim">Nalu</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setMsgs([])} disabled={busy || !!applying} title="Clear" aria-label="Clear conversation" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink disabled:opacity-40"><X size={13} /></button>
              <button onClick={() => setOpen(false)} title="Collapse" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><ChevronDown size={14} /></button>
            </div>
          </div>
          <div ref={scrollRef} className="transcript-scroll space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                {m.role === 'assistant' && m.specialist && (
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-gold">{m.specialist}</div>
                )}
                <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left text-[12.5px] leading-relaxed ${m.role === 'user' ? 'bg-accent/20 text-ink' : 'bg-panel2 text-ink'}`}>
                  {m.proposed ? 'Review the proposed changes below.' : m.appliedPath ? <>Applied to {m.appliedPath.split(/[\\/]/).pop()}</> : m.role === 'assistant' ? <MessageContent text={m.text || (busy && i === msgs.length - 1 ? 'Thinking…' : '')}/> : m.text}
                </div>
                {m.proposed && (
                  <div className="mt-1.5 overflow-hidden rounded-xl border border-gold/30 bg-panel2 text-left">
                    <div className="border-b border-glass/[0.08] px-2.5 py-1.5 text-[11px] font-medium text-gold">Proposed change to <span title={m.proposed.path}>{ws.folder && m.proposed.path.startsWith(ws.folder + '/') ? m.proposed.path.slice(ws.folder.length + 1) : m.proposed.path}</span></div>
                    <ChangePreview preview={m.proposed} source="editor" />
                    <div className="flex gap-1.5 p-2">
                      <button disabled={busy || !!applying} onClick={() => apply(m.proposed!, i)} className="flex items-center gap-1 rounded-md bg-gold/90 px-2.5 py-1 text-[11px] font-medium text-[#15170f] hover:bg-gold disabled:opacity-40"><Check size={12} /> Apply</button>
                      <button disabled={busy || !!applying} onClick={() => setMsgs((p) => p.map((mm, idx) => (idx === i ? { ...mm, proposed: undefined, proposalError: undefined } : mm)))} className="rounded-md border border-glass/[0.1] px-2.5 py-1 text-[11px] text-dim hover:text-ink disabled:opacity-40">Reject</button>
                    </div>
                  </div>
                )}
                {m.proposalError && <div role="alert" className="mt-2 text-left text-[12px] text-red-300">{m.proposalError}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      {/* @-mention picker */}
      {at && (
        <div className="mb-1.5 overflow-hidden rounded-xl border border-glass/[0.12] bg-panel2/95 py-1 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <div className="px-3 py-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold">Add context</div>
          {indexStatus && <div role="status" className="px-3 py-1 text-[11px] text-dim">{indexStatus}</div>}
          {!indexStatus && !atMatches.length && <div className="px-3 py-1 text-[11px] text-dim">No matching files or folders.</div>}
          {atMatches.map((f, i) => (
            <button key={f} onMouseDown={(e) => { e.preventDefault(); pickAt(f) }} onMouseEnter={() => setAt((a) => (a ? { ...a, sel: i } : a))}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] ${i === atSelection ? 'bg-glass/[0.12] text-ink' : 'text-dim'}`}>
              <FileText size={12} className="shrink-0 opacity-70" /><span className="truncate">{f}</span>
            </button>
          ))}
        </div>
      )}

      {/* the always-on prompt bar */}
      <div className="assistant-composer">
        {(ws.folder || ws.active) && <div className="composer-context"><FileText size={12}/><span title={ws.active?.path || ws.folder || ''}>{mode === 'edit' ? ws.active?.name || 'No file selected' : ws.active?.name || ws.folder?.split('/').pop()}</span><span className="ml-auto">{mode === 'edit' ? 'File to edit' : 'Context'}</span></div>}
        {notice && <div role="alert" className="mb-1 px-2 text-[12px] text-gold">{notice}</div>}
        <div className="composer-input">
          <textarea
            ref={promptRef}
            aria-label="Nalu prompt"
            aria-describedby="nalu-mode-description"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (at && e.key === 'Escape') { e.preventDefault(); setAt(null); return }
              if (at && !atMatches.length && e.key === 'Enter') { e.preventDefault(); return }
              if (at && atMatches.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setAt({ ...at, sel: (atSelection + 1) % atMatches.length }); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setAt({ ...at, sel: (atSelection - 1 + atMatches.length) % atMatches.length }); return }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickAt(atMatches[atSelection]); return }
                if (e.key === 'Escape') { e.preventDefault(); setAt(null); return }
              }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
            }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
            onDrop={(e) => {
              // Drop a file/folder from the tree → drop its path into the prompt.
              const paths = [...(e.dataTransfer.files || [])].map((f) => (f as File & { path?: string }).path).filter(Boolean) as string[]
              const dropped = paths.length ? paths.join(' ') : e.dataTransfer.getData('text/plain')
              if (dropped) { e.preventDefault(); setInput((v) => (v ? v.replace(/\s*$/, ' ') : '') + dropped + ' ') }
            }}
            rows={1}
            placeholder={automatic ? 'Describe what you want to accomplish…' : mode === 'edit' ? 'Tell Nalu how to change this file…' : mode === 'agent' ? 'Give Nalu a coding task…' : mode === 'computer' ? 'Tell Nalu what to do on your computer…' : mode === 'terminal' ? 'Describe a terminal task…' : 'Ask Nalu anything…'}
            className={`max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] text-ink outline-none placeholder:text-dim ${mode === 'terminal' ? 'font-mono' : ''}`}
          />
          <div className="composer-actions"><span className="text-[11px] text-dim">Enter to send <span className="text-dim/50">·</span> @ for files</span>
            {(mode === 'chat' || mode === 'edit') && msgs.length > 0 && !open && (
              <button onClick={() => setOpen(true)} className="rounded-lg px-2 py-1 text-[11px] text-dim hover:text-ink">{msgs.length} msgs ▴</button>
            )}

            {busy ? (
              <button title="Stop task" aria-label="Stop task" onClick={stopTask} className="stop-button"><Square size={13} /> Stop</button>
            ) : (
              <button aria-label="Send prompt" onClick={() => void send()} disabled={!input.trim()} className="send-button"><span>Send</span><ArrowUp size={15} /></button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
