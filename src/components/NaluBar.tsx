import { useRef, useState } from 'react'
import { ArrowUp, Check, Square, ChevronDown, X, FileText, FolderTree, Search as SearchIcon, Terminal, Pencil, CheckCircle2, Monitor, MousePointerClick } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { streamChat, type WireMessage } from '../lib/naluApi'
import { runAgent, runComputer, type AgentStep, type AgentTool, type PcStep, type PcTool } from '../lib/agent'
import wolfUrl from '../lib/wolf'

type Msg = { role: 'user' | 'assistant'; text: string; specialist?: string; proposed?: string }
type TermLine = { cmd: string; out: string }
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

  const runAgentTask = async (task: string) => {
    setAgentLog([{ kind: 'thought', text: `Task: ${task}` }])
    setOpen(true); setBusy(true)
    const ctrl = new AbortController(); abortRef.current = ctrl
    try {
      await runAgent({
        task, folder: ws.folder, signal: ctrl.signal,
        onStep: (s) => { setAgentLog((p) => [...p, s]); if (s.kind === 'result' || s.kind === 'action') { ws.refresh() } scrollDown() },
        approve: (action) => new Promise((resolve) => setPending({ action, resolve })),
      })
    } catch (e) {
      setAgentLog((p) => [...p, { kind: 'error', text: e instanceof Error ? e.message : 'agent error' }])
    } finally { setBusy(false); abortRef.current = null; setPending(null) }
  }

  const runComputerTask = async (task: string) => {
    setPcLog([{ kind: 'thought', text: `Task: ${task}` }]); setOpen(true); setBusy(true)
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

  const runTermCmd = async (cmd: string) => {
    setOpen(true); setBusy(true)
    setTermLog((p) => [...p, { cmd, out: '' }])
    try { const r = await window.nalu.exec(ws.folder || '', cmd); setTermLog((p) => { const c = [...p]; c[c.length - 1] = { cmd, out: r.output || `(exit ${r.code})` }; return c }) }
    catch (e) { setTermLog((p) => { const c = [...p]; c[c.length - 1] = { cmd, out: String(e) }; return c }) }
    finally { setBusy(false); scrollDown() }
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
  const toolLabel = (a: AgentTool) => a.tool === 'read_file' ? `Read ${a.path}` : a.tool === 'list_dir' ? `List ${a.path}` : a.tool === 'search' ? `Search "${a.query}"` : a.tool === 'run' ? `Run: ${a.command}` : a.tool === 'write_file' ? `Edit ${a.path}` : 'Done'

  const pcLabel = (a: PcTool) => a.tool === 'open' ? `Open ${a.target}` : a.tool === 'shell' ? `Run: ${a.command}` : a.tool === 'applescript' ? 'AppleScript' : a.tool === 'type' ? `Type "${a.text.slice(0, 30)}"` : a.tool === 'key' ? `Press ${a.combo}` : a.tool === 'click' ? `Click ${a.x},${a.y}` : a.tool === 'screenshot' ? 'Look at screen' : 'Done'

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
              if (s.kind === 'thought') return <div key={i} className="text-dim">{s.text}</div>
              if (s.kind === 'action') return <div key={i} className="flex items-center gap-1.5 font-medium text-ink"><MousePointerClick size={13} className="shrink-0 text-gold" /><span className="truncate">{pcLabel(s.action)}</span></div>
              if (s.kind === 'result') return <div key={i} className="truncate text-[11px] text-dim">{s.text}</div>
              if (s.kind === 'screenshot') return <img key={i} src={s.url} alt="screen" className="w-full rounded-lg border border-glass/[0.12]" />
              if (s.kind === 'done') return <div key={i} className="flex items-start gap-1.5 font-medium text-gold"><CheckCircle2 size={14} className="mt-0.5 shrink-0" />{s.text}</div>
              return <div key={i} className="text-red-300">{s.text}</div>
            })}
            {pcPending && (
              <div className="rounded-xl border border-gold/40 bg-panel2 p-2">
                <div className="mb-2 truncate text-[12px] font-medium text-gold">Approve: {pcLabel(pcPending.action)}</div>
                <div className="flex gap-1.5">
                  <button onClick={() => { pcPending.resolve(true); setPcPending(null) }} className="rounded-md bg-gold/90 px-2.5 py-1 text-[11px] font-medium text-[#15170f] hover:bg-gold">Approve</button>
                  <button onClick={() => { pcPending.resolve(false); setPcPending(null) }} className="rounded-md border border-glass/[0.1] px-2.5 py-1 text-[11px] text-dim hover:text-ink">Deny</button>
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
          <div ref={scrollRef} className="max-h-[40vh] space-y-2 overflow-y-auto p-3 text-[12px]">
            {termLog.map((l, i) => (
              <div key={i}>
                <div className="text-gold">nalu ❯ <span className="text-ink">{l.cmd}</span></div>
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
            <div className="flex items-center gap-1">
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

      {/* the always-on prompt bar */}
      <div className="rounded-2xl border border-glass/[0.1] bg-panel/80 p-2 backdrop-blur-2xl">
        <div className="flex items-end gap-2">
          <img src={wolfUrl} alt="" className="mb-1 ml-1 h-5 w-5 shrink-0 rounded" style={{ filter: 'brightness(0) invert(1)' }} />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            rows={1}
            placeholder={mode === 'edit' ? 'Tell Nalu how to change this file…' : mode === 'agent' ? 'Give Nalu a coding task…' : mode === 'computer' ? 'Tell Nalu Catalina what to do on your Mac…' : mode === 'terminal' ? 'nalu ❯  type a command…' : 'Ask Nalu anything…'}
            className={`max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] text-ink outline-none placeholder:text-dim ${mode === 'terminal' ? 'font-mono' : ''}`}
          />
          <div className="mb-0.5 flex items-center gap-1.5">
            {msgs.length > 0 && !open && (
              <button onClick={() => setOpen(true)} className="rounded-lg px-2 py-1 text-[11px] text-dim hover:text-ink">{msgs.length} msgs ▴</button>
            )}
            <div className="flex rounded-lg border border-glass/[0.08] bg-panel2 p-0.5 text-[11px]">
              {([['chat', null], ['agent', null], ['computer', Monitor], ['edit', Pencil], ['terminal', Terminal]] as [Mode, typeof Monitor | null][]).map(([m, Icon]) => (
                <button key={m} onClick={() => setMode(m)} title={m} className={`flex items-center gap-1 rounded-md px-2 py-0.5 capitalize ${mode === m ? 'bg-gold/90 text-[#15170f]' : 'text-dim hover:text-ink'}`}>
                  {Icon ? <Icon size={11} /> : null}{m === 'computer' ? 'PC' : m}
                </button>
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
