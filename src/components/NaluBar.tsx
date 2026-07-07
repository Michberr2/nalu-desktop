import { useRef, useState } from 'react'
import { ArrowUp, Check, Square, ChevronDown, X } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { streamChat, type WireMessage } from '../lib/naluApi'
import wolfUrl from '../lib/wolf'

type Msg = { role: 'user' | 'assistant'; text: string; specialist?: string; proposed?: string }
type Mode = 'chat' | 'agent' | 'edit'

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
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollDown = () => requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })

  const send = async () => {
    const content = input.trim()
    if (!content || busy) return
    setInput('')
    setOpen(true)
    const file = ws.active
    let userContent = content
    if (file && (mode === 'edit' || mode === 'agent')) {
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
      if (file && (mode === 'edit' || mode === 'agent')) {
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

  return (
    <div className="shrink-0">
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
            placeholder={mode === 'edit' ? 'Tell Nalu how to change this file…' : mode === 'agent' ? 'Give Nalu a task…' : 'Ask Nalu anything…'}
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] text-ink outline-none placeholder:text-dim"
          />
          <div className="mb-0.5 flex items-center gap-1.5">
            {msgs.length > 0 && !open && (
              <button onClick={() => setOpen(true)} className="rounded-lg px-2 py-1 text-[11px] text-dim hover:text-ink">{msgs.length} msgs ▴</button>
            )}
            <div className="flex rounded-lg border border-glass/[0.08] bg-panel2 p-0.5 text-[11px]">
              {(['chat', 'agent', 'edit'] as Mode[]).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded-md px-2 py-0.5 capitalize ${mode === m ? 'bg-gold/90 text-[#15170f]' : 'text-dim hover:text-ink'}`}>{m}</button>
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
