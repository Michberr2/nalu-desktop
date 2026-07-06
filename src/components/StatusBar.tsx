import { GitBranch, Check, Sparkles } from 'lucide-react'
import { useWorkspace } from '../lib/store'

export default function StatusBar() {
  const ws = useWorkspace()
  const lang = ws.active?.name.split('.').pop()?.toUpperCase() || ''
  return (
    <div className="flex h-6 shrink-0 items-center gap-4 border-t border-glass/[0.08] bg-panel px-3 text-[11px] text-dim">
      <span className="flex items-center gap-1"><GitBranch size={11} /> main</span>
      <span className="flex items-center gap-1"><Check size={11} className="text-accent" /> 0</span>
      <div className="flex-1" />
      {ws.active && <span className="text-dim">{ws.active.dirty ? 'Unsaved' : 'Saved'}</span>}
      {lang && <span>{lang}</span>}
      <span className="flex items-center gap-1 text-gold"><Sparkles size={11} /> Nalu</span>
      <button onClick={() => ws.setPaletteOpen(true)} className="hover:text-ink">⌘K</button>
    </div>
  )
}
