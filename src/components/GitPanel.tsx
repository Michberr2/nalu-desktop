import { useEffect, useState, useCallback } from 'react'
import { GitBranch, RefreshCw, Plus, Minus } from 'lucide-react'
import { useWorkspace } from '../lib/store'

type GFile = { x: string; y: string; path: string }
type Status = { repo: boolean; branch?: string; files?: GFile[] }

// Source control — status, stage/unstage, commit (like VS Code's Git view).
export default function GitPanel() {
  const ws = useWorkspace()
  const [st, setSt] = useState<Status>({ repo: false })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!ws.folder) return
    setSt(await window.nalu.git.status(ws.folder))
  }, [ws.folder])

  useEffect(() => { void load() }, [load, ws.refreshKey])

  const staged = (st.files || []).filter((f) => f.x !== ' ' && f.x !== '?')
  const changed = (st.files || []).filter((f) => f.x === ' ' || f.x === '?' || f.y !== ' ')

  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn() } finally { setBusy(false); await load() } }
  const commit = async () => {
    if (!msg.trim() || !ws.folder) return
    await act(async () => { await window.nalu.git.commit(ws.folder!, msg.trim()) })
    setMsg('')
  }

  if (!ws.folder) return <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-dim">Open a folder</div>
  if (!st.repo) return <div className="flex flex-1 items-center justify-center p-6 text-center text-[12px] text-dim">Not a git repository</div>

  const Row = ({ f, staged: isStaged }: { f: GFile; staged: boolean }) => (
    <div className="group flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-glass/[0.06]">
      <span className="w-3 shrink-0 text-center text-[10px] font-bold text-gold">{f.x !== ' ' && f.x !== '?' ? f.x : f.y === '?' ? 'U' : f.y}</span>
      <button onClick={() => ws.folder && void ws.openAt(ws.folder + '/' + f.path, f.path.split('/').pop() || f.path, 1)} className="min-w-0 flex-1 truncate text-left text-[12px] text-dim hover:text-ink">{f.path}</button>
      <button
        onClick={() => ws.folder && void act(() => isStaged ? window.nalu.git.unstage(ws.folder!, f.path) : window.nalu.git.stage(ws.folder!, f.path))}
        title={isStaged ? 'Unstage' : 'Stage'}
        className="shrink-0 rounded p-0.5 text-dim opacity-0 hover:bg-glass/10 hover:text-ink group-hover:opacity-100"
      >
        {isStaged ? <Minus size={12} /> : <Plus size={12} />}
      </button>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="flex items-center gap-1.5 text-[12px] text-ink"><GitBranch size={13} className="text-gold" /> {st.branch}</span>
        <button onClick={() => void load()} disabled={busy} className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><RefreshCw size={12} className={busy ? 'animate-spin' : ''} /></button>
      </div>
      <div className="px-3 pb-2">
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} placeholder="Commit message" className="w-full resize-none rounded-lg border border-glass/[0.1] bg-panel2 px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-dim focus:border-gold/40" />
        <button onClick={() => void commit()} disabled={!msg.trim() || staged.length === 0} className="mt-1.5 w-full rounded-lg bg-gold/90 px-3 py-1.5 text-[12px] font-medium text-[#15170f] hover:bg-gold disabled:opacity-40">Commit {staged.length ? `(${staged.length})` : ''}</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {staged.length > 0 && <>
          <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">Staged</div>
          {staged.map((f) => <Row key={'s' + f.path} f={f} staged />)}
        </>}
        <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">Changes</div>
        {changed.length === 0 && <div className="px-1.5 py-2 text-[11px] text-dim">No changes</div>}
        {changed.map((f) => <Row key={'c' + f.path} f={f} staged={false} />)}
      </div>
    </div>
  )
}
