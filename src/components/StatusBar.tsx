import { useEffect, useState } from 'react'
import * as monaco from 'monaco-editor'
import { GitBranch, AlertCircle } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import wolfUrl from './avatar/nalu-avatar.png'

export default function StatusBar() {
  const ws = useWorkspace()
  const [branch, setBranch] = useState('No repository')
  const [problems, setProblems] = useState(0)
  useEffect(() => {
    let disposed = false, pending = false
    setBranch(ws.folder ? 'Checking Git…' : 'No repository')
    const update = async () => {
      if (!ws.folder || pending) return
      pending = true
      try { const status = await window.nalu.git.status(ws.folder); if (!disposed) setBranch(status.repo ? status.branch || 'Detached HEAD' : 'No repository') }
      catch { if (!disposed) setBranch('Git unavailable') }
      finally { pending = false }
    }
    void update()
    const timer = setInterval(() => { void update() }, 2000)
    return () => { disposed = true; clearInterval(timer) }
  }, [ws.folder, ws.refreshKey])
  useEffect(() => {
    const update = () => setProblems(monaco.editor.getModelMarkers({}).filter(m => m.severity >= monaco.MarkerSeverity.Warning).length)
    update()
    const subscription = monaco.editor.onDidChangeMarkers(update)
    return () => subscription.dispose()
  }, [])
  const lang = ws.active?.name.split('.').pop()?.toUpperCase() || ''
  return (
    <div className="flex h-6 shrink-0 items-center gap-4 px-4 text-[11px] text-dim">
      <span className="flex items-center gap-1"><GitBranch size={11} /> {branch}</span>
      <span className="flex items-center gap-1"><AlertCircle size={11} className={problems ? 'text-amber-400' : 'text-dim'} /> {problems}</span>
      <div className="flex-1" />
      {ws.active && <span className="text-dim">{ws.active.dirty ? 'Unsaved' : 'Saved'}</span>}
      {lang && <span>{lang}</span>}
      <span className="flex items-center gap-1.5 text-gold"><img src={wolfUrl} alt="" className="h-4 w-4 rounded object-contain" /> Nalu</span>
      <button onClick={() => ws.setPaletteOpen(true)} className="hover:text-ink">⌘K</button>
    </div>
  )
}
