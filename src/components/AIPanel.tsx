import { useRef, useState } from 'react'
import { ArrowUp, Check, Sparkles, Square } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { streamChat, type WireMessage } from '../lib/naluApi'

type Msg = { role: 'user' | 'assistant'; text: string; specialist?: string; proposed?: string }
type Mode = 'chat' | 'agent' | 'edit'

// Pull a fenced code block out of a model reply (the proposed new file content).
function extractCode(text: string): string | null {
  const m = text.match(/```[a-zA-Z0-9]*\n([\s\S]*?)```/)
  return m ? m[1].replace(/\n$/, '') : null
}

export default function AIPanel() {
  const ws = useWorkspace()
  const [mode, setMode] = useState<Mode>('chat')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const scrollDown = () => requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })

  const send = async () => {
    const content = input.trim()
    if (!content || busy) return
    setInput('')
    const file = ws.active

    // Build the message with file context + a mode-specific instruction.
    let userContent = content
    if (file && (mode === 'edit' || mode === 'agent')) {
      userContent =
        `${content}\n\nThe user is editing ${file.name}. Return the COMPLETE updated file in ONE fenced code block, nothing else.\n\nCurrent ${file.name}:\n\`\`\`\n${file.content}\n\`\`\``
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
        onRoute: (name) => setMsgs((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], specialist: name }; return c }),
        onDelta: (t) => {
          acc += t
          setMsgs((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], text: acc }; return c })
          scrollDown()
        },
      })
      // In edit/agent mode, surface the proposed file as an applyable diff.
      if (file && (mode === 'edit' || mode === 'agent')) {
        const code = extractCode(acc)
        if (code && code !== file.content) {
          setMsgs((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], proposed: code }; return c })
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) setMsgs((p) => { const c = [...p]; c[c.length - 1] = { ...c[c.length - 1], text: acc + `\n\n⚠️ ${e instanceof Error ? e.message : 'error'} — set your token in Settings.` }; return c })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  const apply = (code: string, i: number) => {
    ws.editActive(code)
    void ws.saveActive()
    setMsgs((p) => p.map((m, idx) => (idx === i ? { ...m, proposed: undefined, text: m.text + '\n\n_Applied ✓_' } : m)))
  }

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-glass/[0.08] bg-panel">
      {/* header + mode switch */}
      <div className="flex items-center gap-2 border-b border-glass/[0.08] px-3 py-2.5">
        <img src="/wolf-icon.png" alt="" className="h-4 w-4 rounded" style={{ filter: 'brightness(0) invert(1)' }} />
        <span className="text-[12px] font-semibold text-ink">Nalu</span>
        <div className="ml-auto flex rounded-lg border border-glass/[0.08] bg-panel2 p-0.5 text-[11px]">
          {(['chat', 'agent', 'edit'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2 py-0.5 capitalize ${mode === m ? 'bg-gold/90 text-[#15170f]' : 'text-dim hover:text-ink'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center gap-2 pt-10 text-center">
            <Sparkles size={20} className="text-gold" />
            <p className="text-[12px] text-dim">Ask about your code, or switch to <b className="text-ink">Edit</b> to change the open file.</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            {m.role === 'assistant' && m.specialist && (
              <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-gold">{m.specialist}</div>
            )}
            <div
              className={`inline-block max-w-full whitespace-pre-wrap rounded-xl px-3 py-2 text-left text-[12.5px] leading-relaxed ${
                m.role === 'user' ? 'bg-accent/20 text-ink' : 'bg-panel2 text-ink'
              }`}
            >
              {m.text || (busy && i === msgs.length - 1 ? '…' : '')}
            </div>
            {m.proposed && (
              <div className="mt-1.5 overflow-hidden rounded-xl border border-gold/30 bg-panel2 text-left">
                <div className="border-b border-glass/[0.08] px-2.5 py-1.5 text-[11px] font-medium text-gold">
                  Proposed change to {ws.active?.name}
                </div>
                <div className="flex gap-1.5 p-2">
                  <button onClick={() => apply(m.proposed!, i)} className="flex items-center gap-1 rounded-md bg-gold/90 px-2.5 py-1 text-[11px] font-medium text-[#15170f] hover:bg-gold">
                    <Check size={12} /> Apply
                  </button>
                  <button
                    onClick={() => setMsgs((p) => p.map((mm, idx) => (idx === i ? { ...mm, proposed: undefined } : mm)))}
                    className="rounded-md border border-glass/[0.1] px-2.5 py-1 text-[11px] text-dim hover:text-ink"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* composer */}
      <div className="border-t border-glass/[0.08] p-2.5">
        {ws.active && (
          <div className="mb-1.5 flex items-center gap-1 px-1 text-[11px] text-dim">
            <span className="rounded bg-glass/[0.06] px-1.5 py-0.5 text-ink">@{ws.active.name}</span>
          </div>
        )}
        <div className="flex items-end gap-1.5 rounded-xl border border-glass/[0.1] bg-panel2 p-1.5 focus-within:border-gold/40">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            rows={1}
            placeholder={mode === 'edit' ? 'Describe the change to this file…' : 'Ask Nalu anything…'}
            className="max-h-32 flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] text-ink outline-none placeholder:text-dim"
          />
          {busy ? (
            <button onClick={() => abortRef.current?.abort()} className="flex h-7 w-7 items-center justify-center rounded-lg bg-glass/10 text-ink">
              <Square size={13} />
            </button>
          ) : (
            <button onClick={() => void send()} disabled={!input.trim()} className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/90 text-[#15170f] disabled:opacity-40">
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
