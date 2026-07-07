import { FolderOpen, Sparkles, TerminalSquare, Command } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import wolfUrl from '../lib/wolf'

export default function Welcome() {
  const ws = useWorkspace()
  const actions = [
    { icon: FolderOpen, label: 'Open folder', hint: '', run: () => void ws.openFolder() },
    { icon: Sparkles, label: 'Ask Nalu', hint: '', run: () => (document.querySelector('textarea')?.focus()) },
    { icon: TerminalSquare, label: 'New terminal', hint: '⌘`', run: () => ws.setTermOpen(true) },
    { icon: Command, label: 'Command palette', hint: '⌘K', run: () => ws.setPaletteOpen(true) },
  ]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <img src={wolfUrl} alt="Nalu" className="h-16 w-16 rounded-2xl" style={{ filter: 'brightness(0) invert(1)' }} />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Nalu Desktop</h1>
        <p className="mt-1 text-[13px] text-dim">Code, create, and ship — with Nalu.</p>
      </div>
      <div className="grid w-full max-w-md grid-cols-2 gap-2">
        {actions.map(({ icon: Icon, label, hint, run }) => (
          <button
            key={label}
            onClick={run}
            className="flex items-center gap-2.5 rounded-xl border border-glass/[0.08] bg-panel px-3.5 py-3 text-left text-[13px] text-ink transition-colors hover:border-gold/40 hover:bg-panel2"
          >
            <Icon size={17} className="shrink-0 text-gold" />
            <span className="flex-1">{label}</span>
            {hint && <span className="text-[11px] text-dim">{hint}</span>}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-dim">Press ⌘K for anything</p>
    </div>
  )
}
