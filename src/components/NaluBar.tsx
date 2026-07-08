import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Square, ChevronDown, X, FileText, FolderTree, Search as SearchIcon, Terminal, Pencil, CheckCircle2, Monitor, MousePointerClick } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { streamChat, type WireMessage } from '../lib/naluApi'
import { runAgent, runComputer, type AgentStep, type AgentTool, type PcStep, type PcTool } from '../lib/agent'
import wolfUrl from '../lib/wolf'

type Msg = { role: 'user' | 'assistant'; text: string; specialist?: string; proposed?: string }
type TermLine = { req: string; cmd: string; out: string; running?: boolean }
type Mode = 'chat' | 'agent' | 'computer' | 'edit' | 'terminal'

function extractCode(text: string): string | null {
  const m = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/)
  return m ? m[1].replace(/\n$/, '') : null
}

// The heart of the one-interface design: a Nalu prompt bar that's ALWAYS at the
// bottom. Asking opens a conversation thread that slides up above it; it can
// chat, edit the open file (Apply/Reject), or answer about your code.
export default function NaluBar() {
  const ws = useWorkspace()
  const [mode, setMode] = useState<Mode>('chat')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false) // thread expanded?
  const [agentLog, setAgentLog] = useState<AgentStep[]>([])
  const [pending, setPending] = useState<{ action: AgentTool; resolve: (ok: boolean) => void } | null>(null)
  const [pcLog, setPcLog] = useState<PcStep[]>([])
  const [pcPending, setPcPending] = useState<{ action: PcTool; resolve: (ok: boolean) => void } | null>(null)
  const [autoApprove, setAutoApprove] = useState(false)
  const autoRef = useRef(false); autoRef.current = autoApprove
  const [termLog, setTermLog] = useState<TermLine[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollDown = () => requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })

  // @-mentions (Cursor-style): type @ to fuzzy-pick a file/folder → drop its path
  // into the prompt so Nalu uses it as context.
  const [files, setFiles] = useState<string[]>([])
  const [at, setAt] = useState<{ q: string; sel: number } | null>(null)
  useEffect(() => {
    let cancel = false
    void (async () => {
      if (!ws.folder) { setFiles([]); return }
      const out: string[] = []
      const walk = async (dir: string, depth: number) => {
        if (depth > 6 || out.length > 5000) return
        let ents: { name: string; path: string; dir: boolean }[] = []
        try { ents = await window.nalu.readDir(dir) } catch { return }
        for (const e of ents) {
          if (/^(node_modules|\.git|dist|release|build|\.next|out)$/.test(e.name)) continue
          out.push(e.path.replace((ws.folder || '') + '/', ''))
          if (e.dir) await walk(e.path, depth + 1)
        }
      }
      await walk(ws.folder, 0)
      if (!cancel) setFiles(out)
    })()
    return () => { cancel = true }
  }, [ws.folder])
  const atMatches = at ? files.filter((f) => f.toLowerCase().includes(at.q.toLowerCase())).slice(0, 8) : []
  const onInputChange = (v: string) => {
    setInput(v)
    const m = v.match(/(?:^|\s)@([\w./-]*)$/)
    setAt(m ? { q: m[1], sel: 0 } : null)
  }
  const pickAt = (rel: string) => { setInput((v) => v.replace(/@[\w./-]*$/, rel + ' ')); setAt(null) }

  const runAgentTask = async (task: string) => {
    setAgentLog([{ kind: 'thought', text: `Task: ${task}` }])
    setOpen(true); setBusy(true)
    const ctrl = new AbortController(); abortRef.current = ctrl
    try {
      await runAgent({
        task, folder: ws.folder, signal: ctrl.signal,
        onStep: (s) => { setAgentLog((p) => [...p, s]); if (s.kind === 'action' && s.action.tool === 'run') ws.setTermOpen(true); if (s.kind === 'result' || s.kind === 'action') { ws.refresh(); void ws.reloadTabs() } scrollDown() },
        approve: (action) => (autoRef.current ? Promise.resolve(true) : new Promise((resolve) => setPending({ action, resolve }))),
      })
    } catch (e) {
      setAgentLog((p) => [...p, { kind: 'error', text: e instanceof Error ? e.message : 'agent error' }])
    } finally { setBusy(false); abortRef.current = null; setPending(null) }
  }

  const runComputerTask = async (task: string) => {
    setPcLog([{ kind: 'thought', text: `Task: ${task}` }]); setOpen(true); setBusy(true)
    // one-time macOS permissions for clicks/keystrokes/browser control
    try {
      const perms = await window.nalu.pc.permissions(true)
      if (!perms.accessibility) setPcLog((p) => [...p, { kind: 'thought', text: 'One-time setup: grant Nalu Accessibility in the window that just opened (System Settings → Privacy & Security → Accessibility), so it can click, type, and drive the browser. I can still open apps, run AppleScript, and use the terminal without it.' }])
    } catch { /* not mac / ignore */ }
    const ctrl = new AbortController(); abortRef.current = ctrl
    try {
      await runComputer({
        task, signal: ctrl.signal, autoApprove: () => autoRef.current,
        onStep: (s) => { setPcLog((p) => [...p, s]); scrollDown() },
        approve: (action) => new Promise((resolve) => setPcPending({ action, resolve })),
      })
    } catch (e) { setPcLog((p) => [...p, { kind: 'error', text: e instanceof Error ? e.message : 'error' }]) }
    finally { setBusy(false); abortRef.current = null; setPcPending(null) }
  }

  // AI-driven terminal: describe what you want, Nalu picks + runs the command.
  const runTermCmd = async (request: string) => {
    setOpen(true); setBusy(true)
    setTermLog((p) => [...p, { req: request, cmd: '', out: '', running: true }])
    scrollDown()
    try {
      // If it already looks like a raw command, run it verbatim; otherwise ask
      // Nalu to translate the request into the exact shell command.
      const looksRaw = /^(cd |ls|pwd|git |npm |node |cat |grep |echo |mkdir|rm |cp |mv |brew |python|pip|curl |find |which |touch |code |open |sudo )/.test(request.trim())
      let cmd = request.trim()
      if (!looksRaw) {
        let out = ''
        await streamChat(
          [
            { role: 'system', content: 'You are a macOS shell (zsh) expert. The user tells you what they want to do in the terminal. Reply with ONLY the single exact shell command that does it — no explanation, no markdown, no code fences, no leading $. Chain steps with && if needed. Prefer safe, non-destructive commands.' },
            { role: 'user', content: request },
          ],
          { specialist: 'code', onDelta: (t) => (out += t) },
        )
        cmd = out.replace(/```[a-z]*|```/gi, '').replace(/^\$\s*/, '').trim().split('\n')[0].trim()
      }
      setTermLog((p) => { const c = [...p]; c[c.length - 1] = { req: request, cmd, out: '', running: true }; return c }); scrollDown()
      const r = await window.nalu.exec(ws.folder || '', cmd)
      setTermLog((p) => { const c = [...p]; c[c.length - 1] = { req: request, cmd, out: r.output || `(exit ${r.code})`, running: false }; return c })
    } catch (e) {
      setTermLog((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], out: String(e), running: false }; return c })
    } finally { setBusy(false); scrollDown() }
  }

  const send = async () => {
    const content = input.trim()
    if (!content || busy) return
    setInput('')
    setOpen(true)
    if (mode === 'agent') { void runAgentTask(content); return }
    if (mode === 'computer') { void runComputerTask(content); return }
    if (mode === 'terminal') { void runTermCmd(content); return }
    const file = ws.active
    let userContent = content
    if (file && mode === 'edit') {
      userContent = `${content}\n\nThe user is editing ${file.name}. Return the COMPLETE updated file in ONE fenced code block, nothing else.\n\nCurrent ${file.name}:\n\`\`\`\n${file.content}\n\`\`\``
    } else if (file) {
      userContent = `${content}\n\n(Context — the open file ${file.name}:)\n\`\`\`\n${file.content.slice(0, 8000)}\n\`\`\``
    }
    const history: WireMessage[] = [
      ...msgs.map((m) => ({ role: m.role, content: m.text }) as WireMessage),
      { role: 'user', content: userContent },
    ]
    setMsgs((p) => [...p, { role: 'user', text: content }, { role: 'assistant', text: '' }])
    scrollDown()
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    let acc = ''
    try {
      await streamChat(history, {
        specialist: mode === 'chat' ? undefined : 'code',
        signal: ctrl.signal,
        onRoute: (name) => {
          ws.setRouteName(name)
          setMsgs((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], specialist: name }; return c })
        },
        onDelta: (t) => {
          acc += t
          setMsgs((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], text: acc }; return c })
          scrollDown()
        },
      })
      if (file && mode === 'edit') {
        const code = extractCode(acc)
        if (code && code !== file.content) setMsgs((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], proposed: code }; return c })
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setMsgs((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], text: acc + `\n\n⚠️ ${e instanceof Error ? e.message : 'error'} — add your token in Settings.` }; return c })
    } finally {
      setBusy(false); abortRef.current = null
    }
  }

  const apply = (code: string, i: number) => {
    ws.editActive(code); void ws.saveActive()
    setMsgs((p) => p.map((m, idx) => (idx === i ? { ...m, proposed: undefined, text: m.text + '\n\n_Applied ✓_' } : m)))
  }

  const toolIcon = (t: string) => t === 'read_file' ? FileText : t === 'list_dir' ? FolderTree : t === 'search' ? SearchIcon : t === 'run' ? Terminal : Pencil
  const toolLabel = (a: AgentTool) => a.tool === 'read_file' ? `Read ${a.path}` : a.tool === 'list_dir' ? `List ${a.path}` : a.tool === 'search' ? `Search "${a.query}"` : a.tool === 'run' ? `Run: ${a.command}` : a.tool === 'write_file' ? `Create ${a.path}` : a.tool === 'edit_file' ? `Edit ${a.path}` : 'Done'

  // Short human title for an action.
  const pcLabel = (a: PcTool) => a.tool === 'browse' ? 'Open website' : a.tool === 'read_page' ? 'Read the page' : a.tool === 'page_js' ? 'Act on the page' : a.tool === 'click_el' ? 'Click element' : a.tool === 'type_text' ? 'Type text' : a.tool === 'press' ? `Press ${a.key}` : a.tool === 'open' ? `Open ${a.target}` : a.tool === 'shell' ? 'Run command' : a.tool === 'applescript' ? 'Control an app (AppleScript)' : a.tool === 'type' ? 'Type text' : a.tool === 'key' ? `Press ${a.combo}` : a.tool === 'click' ? `Click at ${a.x}, ${a.y}` : a.tool === 'see' ? 'Look at the screen' : 'Finish'
  // The exact thing being done — so you see (and can approve) precisely what runs.
  const pcDetail = (a: PcTool): string => a.tool === 'browse' ? a.url : a.tool === 'page_js' ? a.code : a.tool === 'click_el' ? a.selector : a.tool === 'type_text' ? a.text : a.tool === 'shell' ? a.command : a.tool === 'applescript' ? a.script : a.tool === 'type' ? a.text : a.tool === 'open' ? a.target : ''

  return (
    <div className="shrink-0">
      {/* COMPUTER transcript — Nalu Catalina operating the whole Mac (it SEES the screen) */}
      {open && pcLog.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-2xl border border-gold/30 bg-panel/80 backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-gold"><Monitor size={12} /> Nalu Catalina · Computer</span>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-dim"><input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} className="accent-[#af8c56]" /> auto-run</label>
              {busy && <button onClick={() => abortRef.current?.abort()} className="rounded p-1 text-dim hover:text-ink"><Square size={12} /></button>}
              <button onClick={() => { setPcLog([]); setOpen(false) }} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={13} /></button>
            </div>
          </div>
          <div ref={scrollRef} className="max-h-[46vh] space-y-1.5 overflow-y-auto p-3 text-[12px]">
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
              if (s.kind === 'screenshot') return <div key={i}><div className="mb-1 text-[10px] uppercase tracking-wide text-dim">what Nalu sees:</div><img src={s.url} alt="screen" className="w-full rounded-lg border border-glass/[0.12]" /></div>
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
        <div className="mb-2 overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/85 font-mono backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-gold"><Terminal size={12} /> Nalu Terminal</span>
            <button onClick={() => setTermLog([])} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={13} /></button>
          </div>
          <div ref={scrollRef} className="max-h-[40vh] space-y-2.5 overflow-y-auto p-3 text-[12px]">
            {termLog.map((l, i) => (
              <div key={i}>
                <div className="text-dim">you ❯ <span className="text-ink">{l.req}</span></div>
                {l.cmd ? <div className="mt-0.5 text-gold">nalu ❯ <span className="text-ink">{l.cmd}</span></div> : <div className="mt-0.5 text-dim/70">nalu ❯ deciding the command…</div>}
                {l.out && <pre className="mt-0.5 whitespace-pre-wrap text-[11px] text-dim">{l.out}</pre>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AGENT transcript — the autonomous read/edit/run loop */}
      {open && agentLog.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-2xl border border-gold/25 bg-panel/80 backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-gold">Agent</span>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1 text-[10px] text-dim"><input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} className="accent-[#af8c56]" /> auto-run</label>
              {busy && <button onClick={() => abortRef.current?.abort()} className="rounded p-1 text-dim hover:text-ink"><Square size={12} /></button>}
              <button onClick={() => { setAgentLog([]); setOpen(false) }} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={13} /></button>
            </div>
          </div>
          <div ref={scrollRef} className="max-h-[42vh] space-y-1.5 overflow-y-auto p-3 text-[12px]">
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
      {open && msgs.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/80 backdrop-blur-2xl">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-dim">Nalu</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setMsgs([])} title="Clear" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={13} /></button>
              <button onClick={() => setOpen(false)} title="Collapse" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><ChevronDown size={14} /></button>
            </div>
          </div>
          <div ref={scrollRef} className="max-h-[38vh] space-y-3 overflow-y-auto p-3">
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
                {m.role === 'assistant' && m.specialist && (
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-gold">{m.specialist}</div>
                )}
                <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-left text-[12.5px] leading-relaxed ${m.role === 'user' ? 'bg-accent/20 text-ink' : 'bg-panel2 text-ink'}`}>
                  {m.text || (busy && i === msgs.length - 1 ? '…' : '')}
                </div>
                {m.proposed && (
                  <div className="mt-1.5 overflow-hidden rounded-xl border border-gold/30 bg-panel2 text-left">
                    <div className="border-b border-glass/[0.08] px-2.5 py-1.5 text-[11px] font-medium text-gold">Proposed change to {ws.active?.name}</div>
                    <div className="flex gap-1.5 p-2">
                      <button onClick={() => apply(m.proposed!, i)} className="flex items-center gap-1 rounded-md bg-gold/90 px-2.5 py-1 text-[11px] font-medium text-[#15170f] hover:bg-gold"><Check size={12} /> Apply</button>
                      <button onClick={() => setMsgs((p) => p.map((mm, idx) => (idx === i ? { ...mm, proposed: undefined } : mm)))} className="rounded-md border border-glass/[0.1] px-2.5 py-1 text-[11px] text-dim hover:text-ink">Reject</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* @-mention picker */}
      {at && atMatches.length > 0 && (
        <div className="mb-1.5 overflow-hidden rounded-xl border border-glass/[0.12] bg-panel2/95 py-1 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <div className="px-3 py-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-gold">Add context</div>
          {atMatches.map((f, i) => (
            <button key={f} onMouseDown={(e) => { e.preventDefault(); pickAt(f) }} onMouseEnter={() => setAt((a) => (a ? { ...a, sel: i } : a))}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] ${i === at.sel ? 'bg-glass/[0.12] text-ink' : 'text-dim'}`}>
              <FileText size={12} className="shrink-0 opacity-70" /><span className="truncate">{f}</span>
            </button>
          ))}
        </div>
      )}

      {/* the always-on prompt bar */}
      <div className="rounded-2xl border border-glass/[0.1] bg-panel/80 p-2 backdrop-blur-2xl">
        <div className="flex items-end gap-2">
          <img src={wolfUrl} alt="" className="mb-1 ml-1 h-5 w-5 shrink-0 rounded" style={{ filter: 'brightness(0) invert(1)' }} />
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (at && atMatches.length) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setAt({ ...at, sel: (at.sel + 1) % atMatches.length }); return }
                if (e.key === 'ArrowUp') { e.preventDefault(); setAt({ ...at, sel: (at.sel - 1 + atMatches.length) % atMatches.length }); return }
                if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickAt(atMatches[at.sel]); return }
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
            placeholder={mode === 'edit' ? 'Tell Nalu how to change this file…' : mode === 'agent' ? 'Give Nalu a coding task…' : mode === 'computer' ? 'Tell Nalu what to do on your Mac…' : mode === 'terminal' ? 'nalu ❯  type a command…' : 'Ask Nalu anything…'}
            className={`max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] text-ink outline-none placeholder:text-dim ${mode === 'terminal' ? 'font-mono' : ''}`}
          />
          <div className="mb-0.5 flex items-center gap-1.5">
            {msgs.length > 0 && !open && (
              <button onClick={() => setOpen(true)} className="rounded-lg px-2 py-1 text-[11px] text-dim hover:text-ink">{msgs.length} msgs ▴</button>
            )}
            <div className="flex rounded-full border border-glass/[0.08] bg-panel2 p-0.5 text-[11px]">
              {([['chat', 'Chat'], ['agent', 'Agent'], ['computer', 'PC'], ['edit', 'Edit'], ['terminal', 'Terminal']] as [Mode, string][]).map(([m, label]) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-full px-2.5 py-0.5 transition-colors ${mode === m ? 'bg-gold text-[#15170f]' : 'text-dim hover:text-ink'}`}>{label}</button>
              ))}
            </div>
            {busy ? (
              <button onClick={() => abortRef.current?.abort()} className="flex h-8 w-8 items-center justify-center rounded-xl bg-glass/10 text-ink"><Square size={14} /></button>
            ) : (
              <button onClick={() => void send()} disabled={!input.trim()} className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/90 text-[#15170f] disabled:opacity-40"><ArrowUp size={16} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
