import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, ArrowUp, Square, FileText, Table, Presentation, Palette, Film, Loader2, MessageSquare } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { getToken, loadChats, saveChats, streamChat, type Chat, type ChatMsg, type WireMessage } from '../lib/naluApi'
import wolfUrl from '../lib/wolf'
import MessageContent from './MessageContent'
import ResizeGrip, { type ResizeDelta } from './ResizeGrip'
import { clampPanelSize, usePanelSize } from '../lib/panelSize'

// All the online Nalu experts — same models the website routes to. "Auto" lets
// Nalu pick the best expert per message (recommended); or force a specific one.
const SPECIALISTS: { key: string; label: string }[] = [
  { key: '', label: 'Auto — best expert' },
  { key: 'code', label: 'Nalu Code' },
  { key: 'reasoning', label: 'Nalu Reason' },
  { key: 'studio', label: 'Nalu Studio' },
  { key: 'finance', label: 'Nalu Financial' },
  { key: 'legal', label: 'Nalu Law' },
  { key: 'health', label: 'Nalu Health' },
  { key: 'medical', label: 'Nalu Medical' },
  { key: 'math', label: 'Nalu Math' },
  { key: 'science', label: 'Nalu Science' },
  { key: 'realestate', label: 'Nalu Real Estate' },
  { key: 'cre', label: 'Nalu CRE' },
  { key: 'crypto', label: 'Nalu Crypto' },
  { key: 'marketing', label: 'Nalu Marketing' },
  { key: 'hr', label: 'Nalu HR' },
  { key: 'social', label: 'Nalu Social' },
  { key: 'construction', label: 'Nalu Construction' },
]

const ARTIFACTS: [keyof ChatMsg, string, typeof FileText][] = [
  ['doc', 'Document', FileText], ['sheet', 'Sheet', Table], ['deck', 'Deck', Presentation],
  ['design', 'Design', Palette], ['video', 'Video', Film], ['cad', 'CAD model', FileText],
]

function ArtifactChips({ m }: { m: ChatMsg }) {
  const chips = ARTIFACTS.filter(([k]) => m[k])
  if (!chips.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map(([k, label, Icon]) => (
        <span key={k} className="inline-flex items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/[0.08] px-2 py-1 text-[11px] text-gold">
          <Icon size={12} /> {label}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <span className="text-dim">{(m as any)[k]?.title ? `· ${(m as any)[k].title}` : ''}</span>
        </span>
      ))}
      <a href="https://n4lu.ai" target="_blank" rel="noopener noreferrer" className="self-center text-[11px] text-gold underline">Open Nalu on the web to edit</a>
    </div>
  )
}

export default function NaluChat() {
  const ws = useWorkspace()
  const [sidebarWidth, setSidebarWidth] = usePanelSize('nalu-chats-sidebar-w')
  const sidebarRef = useRef<HTMLDivElement>(null)
  const resizeSidebar = ({ start, dx }: ResizeDelta) => setSidebarWidth(clampPanelSize(start.width + dx, 180, Math.min(480, (sidebarRef.current?.parentElement?.clientWidth || innerWidth) - 360)))
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(true)
  const [syncError, setSyncError] = useState('')
  const unsaved = useRef(false)
  const saveVersion = useRef(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const input = drafts[activeId || 'new'] || ''
  const setInput = (value: string) => setDrafts(current => ({ ...current, [activeId || 'new']: value }))
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [chatTask, setChatTask] = useState({ task: '', status: '' })
  useEffect(() => { window.nalu.companion?.activity('chats', busy, chatTask) }, [busy, chatTask])
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [specialist, setSpecialist] = useState('') // '' = auto-route
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollDown = () => requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight })

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadChats().then((cs) => { if (!alive) return; setChats(cs); setActiveId((id) => id || cs[0]?.id || null) }).catch(e => { if (alive) setSyncError(e instanceof Error ? e.message : 'Could not load your chats.') }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [ws.user?.id])

  // SHARED: pull the latest chats from the server whenever the window regains
  // focus, so anything you did on n4lu.ai (or another device) shows up here.
  useEffect(() => {
    let alive = true
    const onFocus = () => { if (!busyRef.current && !unsaved.current) loadChats().then((cs) => { if (!alive || busyRef.current || unsaved.current) return; setSyncError(''); if (cs.length) setChats((cur) => (JSON.stringify(cur.map((c) => c.id)) !== JSON.stringify(cs.map((c) => c.id)) || cs.some((c, i) => (c.messages?.length || 0) !== (cur[i]?.messages?.length || 0)) ? cs : cur)) }).catch(e => { if (alive) setSyncError(e instanceof Error ? e.message : 'Could not load your chats.') }) }
    window.addEventListener('focus', onFocus)
    return () => { alive = false; window.removeEventListener('focus', onFocus) }
  }, [busy])

  useLayoutEffect(() => { const el=promptRef.current; if(el){el.style.height='auto';el.style.height=`${Math.min(160, Math.max(48, el.scrollHeight))}px`} }, [input])
  useEffect(() => () => abortRef.current?.abort(), [])
  const active = useMemo(() => chats.find((c) => c.id === activeId) || null, [chats, activeId])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? chats.filter((c) => (c.title || '').toLowerCase().includes(q)) : chats
  }, [chats, query])

  const newChat = () => {
    const c: Chat = { id: `d${Date.now()}`, title: 'New chat', messages: [], createdAt: Date.now() }
    setChats((p) => [c, ...p]); setActiveId(c.id)
  }

  const send = async () => {
    const content = input.trim()
    const accountToken = getToken()
    if (!content || busyRef.current) return
    const revision = ++saveVersion.current
    busyRef.current = true
    unsaved.current = true
    setChatTask({ task: content, status: 'Writing a reply in Chats.' })
    setInput('')
    let chat = active
    if (!chat) { chat = { id: `d${Date.now()}`, title: content.slice(0, 40), messages: [], createdAt: Date.now() }; setChats((p) => [chat as Chat, ...p]); setActiveId(chat.id) }
    const id = chat.id
    const userMsg: ChatMsg = { role: 'user', content }
    setChats((p) => p.map((c) => (c.id === id ? { ...c, title: c.messages.length === 0 ? content.slice(0, 40) : c.title, messages: [...c.messages, userMsg, { role: 'assistant', content: '' }] } : c)))
    scrollDown(); setBusy(true)
    const history: WireMessage[] = [...chat.messages, userMsg].map((m) => ({ role: m.role, content: m.content }))
    const ctrl = new AbortController(); abortRef.current = ctrl
    let acc = ''
    try {
      await streamChat(history, {
        signal: ctrl.signal,
        specialist: specialist || undefined,
        onRoute: (name) => { ws.setRouteName(name); setChats((p) => p.map((c) => (c.id === id ? { ...c, messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? { ...m, specialist: name } : m)) } : c))) },
        onDelta: (t) => { acc += t; setChats((p) => p.map((c) => (c.id === id ? { ...c, messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? { ...m, content: acc } : m)) } : c))); scrollDown() },
      })
    } catch (e) {
      acc += ctrl.signal.aborted ? '\n\nStopped.' : `\n\n${e instanceof Error ? e.message : 'Request failed.'}`
      setChats((p) => p.map((c) => (c.id === id ? { ...c, messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? { ...m, content: acc } : m)) } : c)))
    } finally {
      setChatTask({ task: content, status: ctrl.signal.aborted ? 'Stopped.' : acc.slice(0,300) || 'Reply finished.' })
      busyRef.current = false; setBusy(false); abortRef.current = null
      // persist back to the SAME DB the website reads (artifacts preserved server-side)
      setChats((cur) => {
        if (getToken() === accountToken) void saveChats(cur, accountToken).then(() => { if (saveVersion.current === revision) { unsaved.current = false; setSyncError('') } }).catch(e => { if (saveVersion.current === revision) setSyncError(e instanceof Error ? e.message : 'Your chats could not be saved.') })
        return cur
      })
    }
  }

  const retrySync = async () => {
    setLoading(true)
    try {
      if (unsaved.current) { await saveChats(chats); unsaved.current = false }
      else { const latest = await loadChats(); setChats(latest); setActiveId(id => id || latest[0]?.id || null) }
      setSyncError('')
    } catch (e) { setSyncError(e instanceof Error ? e.message : 'Could not sync your chats.') }
    finally { setLoading(false) }
  }

  return (
    <div className="chat-layout">
      {/* chat list — your website conversations */}
      <div ref={sidebarRef} className="chat-sidebar" style={sidebarWidth === null ? undefined : { width: sidebarWidth }}>
        <div className="p-2">
          <button onClick={newChat} className="flex w-full items-center gap-2 rounded-lg bg-gold/90 px-3 py-2 text-[13px] font-medium text-[#15170f] hover:bg-gold"><Plus size={14} /> New chat</button>
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-glass/[0.08] bg-panel2 px-2.5 py-1.5">
            <Search size={13} className="text-dim" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" className="w-full bg-transparent text-[12px] text-ink outline-none placeholder:text-dim" />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-dim"><Loader2 size={14} className="animate-spin" /> Loading your chats…</div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-8 text-center text-[12px] text-dim">{ws.user ? 'No chats yet — start one.' : 'Sign in (Settings) to see your chats.'}</div>
          ) : filtered.map((c) => (
            <button key={c.id} onClick={() => setActiveId(c.id)} className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] ${activeId === c.id ? 'bg-glass/10 text-ink' : 'text-dim hover:bg-glass/5 hover:text-ink'}`}>
              <MessageSquare size={13} className="shrink-0 opacity-70" />
              <span className="truncate">{c.title || 'Untitled'}</span>
            </button>
          ))}
        </div>
        <ResizeGrip label="Resize Chat list panel" onResize={resizeSidebar} onReset={() => setSidebarWidth(null)} />
      </div>

      {/* conversation */}
      <div className="chat-conversation">
        <ResizeGrip label="Resize Conversation panel" corner="left" target={() => sidebarRef.current} onResize={resizeSidebar} onReset={() => setSidebarWidth(null)} />
        <div className="chat-conversation-heading"><div><span className="text-dim text-[10px] uppercase tracking-widest">Nalu conversations</span><h1>{active?.title || 'A fresh conversation'}</h1></div><span className="text-xs text-dim">{busy ? 'Responding…' : ws.user ? 'Your Nalu account' : 'Sign in to save your chats'}</span></div>
        {syncError && <div role="alert" className="mx-4 mt-2 rounded-lg border border-gold/30 p-3 text-xs text-ink">{syncError} <button className="ml-2 underline" disabled={loading || busy} onClick={() => void retrySync()}>Retry sync</button></div>}
        <div ref={scrollRef} className="chat-messages space-y-5">
          {!active || active.messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <img src={wolfUrl} alt="" className="h-12 w-12" style={{ filter: 'brightness(0) invert(1)' }} />
              <h2 className="text-[28px] font-medium tracking-tight">A thought. A question. A new idea.</h2><p className="max-w-md text-[13px] leading-6 text-dim">Give it a place to begin. Your conversations stay connected across Nalu.</p>
            </div>
          ) : active.messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={i} className="flex justify-end"><div className="max-w-[80%] whitespace-pre-wrap rounded-xl bg-panel2 px-4 py-3 text-[13px] text-ink">{m.content}</div></div>
            ) : (
              <div key={i} className="flex gap-2.5">
                <img src={wolfUrl} alt="" className="mt-0.5 h-6 w-6 shrink-0" style={{ filter: 'brightness(0) invert(1)' }} />
                <div className="min-w-0 flex-1">
                  {m.specialist && <div className="mb-0.5 text-[10.5px] font-medium uppercase tracking-wide text-gold/80">{m.specialist}</div>}
                  {m.content ? <MessageContent text={m.content}/> : <Loader2 size={14} className="animate-spin text-dim" />}
                  <ArtifactChips m={m} />
                </div>
              </div>
            )
          ))}
        </div>
        {/* composer */}
        <div className="chat-composer">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[10.5px] text-dim">Expert:</span>
            <select aria-label="Choose expert" value={specialist} onChange={(e) => setSpecialist(e.target.value)} className="rounded-md border border-glass/[0.1] bg-panel2 px-2 py-1 text-[11px] text-ink outline-none focus:border-gold/40">
              {SPECIALISTS.map((s) => <option key={s.key} value={s.key} className="bg-panel text-ink">{s.label}</option>)}
            </select>
          </div>
          <div className="flex items-end gap-2 rounded-xl border border-glass/[0.1] bg-panel2 px-3 py-2">
            <textarea
              ref={promptRef}
              aria-label="Chat prompt"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="Ask Nalu to do anything…"
              rows={1}
              className="max-h-32 min-h-[24px] flex-1 resize-none bg-transparent text-[13px] text-ink outline-none placeholder:text-dim"
            />
            {busy ? (
              <button onClick={() => abortRef.current?.abort()} aria-label="Stop chat response" className="stop-button"><Square size={13} /> Stop</button>
            ) : (
              <button onClick={() => void send()} disabled={!input.trim()} aria-label="Send chat message" className="send-button"><span>Send</span><ArrowUp size={15} /></button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
