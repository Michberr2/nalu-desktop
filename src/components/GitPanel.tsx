import { useEffect, useState, useCallback } from 'react'
import { GitBranch, RefreshCw, Plus, Minus, ChevronDown, X } from 'lucide-react'
import { useWorkspace } from '../lib/store'

type GFile = { x: string; y: string; path: string }
type Status = { repo: boolean; branch?: string; files?: GFile[] }

// Source control — status, stage/unstage, the "Changes +X −Y" pill, Commit &
// Push, and a diff view so you can SEE exactly what changed (incl. the AI's edits).
export default function GitPanel() {
  const ws = useWorkspace()
  const [st, setSt] = useState<Status>({ repo: false })
  const [stat, setStat] = useState({ added: 0, removed: 0 })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null)

  const load = useCallback(async () => {
    if (!ws.folder) return
    const [s, n] = await Promise.all([window.nalu.git.status(ws.folder), window.nalu.git.stat(ws.folder)])
    setSt(s); setStat(n)
  }, [ws.folder])
  useEffect(() => { void load() }, [load, ws.refreshKey])
  // Live source-control: poll so edits/new files show up on their own (VS Code-style).
  useEffect(() => { const t = setInterval(() => void load(), 2000); return () => clearInterval(t) }, [load])
  // Keep an open diff fresh as you keep typing.
  useEffect(() => {
    if (!diff || !ws.folder) return
    const t = setInterval(async () => { const txt = await window.nalu.git.diff(ws.folder!, diff.path); if (txt) setDiff((d) => (d && d.path === diff.path ? { ...d, text: txt } : d)) }, 2000)
    return () => clearInterval(t)
  }, [diff, ws.folder])

  const staged = (st.files || []).filter((f) => f.x !== ' ' && f.x !== '?')
  const changed = (st.files || []).filter((f) => f.x === ' ' || f.x === '?' || f.y !== ' ')
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } finally { setBusy(false); await load() } }

  const showDiff = async (f: GFile) => {
    if (!ws.folder) return
    setDiff({ path: f.path, text: (await window.nalu.git.diff(ws.folder, f.path)) || '(no diff)' })
  }
  const commit = async (push: boolean) => {
    if (!msg.trim() || !ws.folder) return
    await act(async () => { push ? await window.nalu.git.commitPush(ws.folder!, msg.trim()) : await window.nalu.git.commit(ws.folder!, msg.trim()) })
    setMsg('')
  }

  if (!ws.folder) return <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-dim">Open a folder</div>
  if (!st.repo) return <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-dim">Not a git repository</div>

  const Row = ({ f, isStaged }: { f: GFile; isStaged: boolean }) => (
    <div className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-glass/[0.06]">
      <span className="w-3 shrink-0 text-center text-[10px] font-bold text-gold">{f.x !== ' ' && f.x !== '?' ? f.x : f.y === '?' ? 'U' : f.y}</span>
      <button onClick={() => void showDiff(f)} className="min-w-0 flex-1 truncate text-left text-[12px] text-dim hover:text-ink">{f.path}</button>
      <button onClick={() => ws.folder && void act(() => isStaged ? window.nalu.git.unstage(ws.folder!, f.path) : window.nalu.git.stage(ws.folder!, f.path))} title={isStaged ? 'Unstage' : 'Stage'} className="shrink-0 rounded p-0.5 text-dim opacity-0 hover:bg-glass/10 hover:text-ink group-hover:opacity-100">
        {isStaged ? <Minus size={12} /> : <Plus size={12} />}
      </button>
    </div>
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="flex items-center gap-1.5 text-[12px] text-ink"><GitBranch size={13} className="text-gold" /> {st.branch}</span>
        <button onClick={() => void load()} disabled={busy} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /></button>
      </div>

      {/* the buttons from the screenshot: Changes +X −Y  +  Commit & Push */}
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="flex items-center gap-1.5 rounded-full border border-glass/[0.1] bg-panel2 px-2.5 py-1 text-[11px] text-ink">
          Changes {stat.added > 0 && <span className="text-green-400">+{stat.added}</span>} {stat.removed > 0 && <span className="text-red-400">−{stat.removed}</span>}
          {stat.added === 0 && stat.removed === 0 && <span className="text-dim">0</span>}
        </span>
      </div>
      <div className="px-3 pb-2">
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder="Commit message" className="w-full resize-none rounded-lg border border-glass/[0.1] bg-panel2 px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-dim focus:border-gold/40" />
        <div className="mt-1.5 flex gap-1.5">
          <button onClick={() => void commit(true)} disabled={!msg.trim() || busy} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gold/90 px-3 py-1.5 text-[12px] font-medium text-[#15170f] hover:bg-gold disabled:opacity-40">Commit &amp; Push <ChevronDown size={12} /></button>
          <button onClick={() => void commit(false)} disabled={!msg.trim() || staged.length === 0 || busy} title="Commit only (staged)" className="rounded-lg border border-glass/[0.12] px-3 py-1.5 text-[12px] text-ink hover:bg-glass/10 disabled:opacity-40">Commit</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {staged.length > 0 && <>
          <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">Staged</div>
          {staged.map((f) => <Row key={'s' + f.path} f={f} isStaged />)}
        </>}
        <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">Changes</div>
        {changed.length === 0 && <div className="px-1.5 py-2 text-[11px] text-dim">No changes</div>}
        {changed.map((f) => <Row key={'c' + f.path} f={f} isStaged={false} />)}
      </div>

      {/* diff view — see exactly what changed */}
      {diff && (
        <div className="absolute inset-0 z-40 flex flex-col rounded-2xl bg-panel">
          <div className="flex items-center justify-between border-b border-glass/[0.08] px-3 py-2">
            <span className="truncate text-[12px] font-medium text-ink">{diff.path}</span>
            <button onClick={() => setDiff(null)} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><X size={14} /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed">
            {diff.text.split('\n').map((line, i) => (
              <div key={i} className={line.startsWith('+') && !line.startsWith('+++') ? 'text-green-400' : line.startsWith('-') && !line.startsWith('---') ? 'text-red-400' : line.startsWith('@@') ? 'text-accent' : 'text-dim'}>{line || ' '}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
