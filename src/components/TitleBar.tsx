import { Search, PanelLeft, TerminalSquare, Settings } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import wolfUrl from '../lib/wolf'

export default function TitleBar() {
  const ws = useWorkspace()
  // Detect macOS from the renderer directly — reliable, and independent of the
  // preload bridge (window.nalu.platform came back undefined through contextBridge).
  const isMac = /Mac/i.test(navigator.userAgent)
  return (
    <div
      className="drag flex h-11 shrink-0 items-center gap-2 px-3"
      style={{ paddingLeft: isMac ? 92 : undefined }}
    >
      {/* inline padding above reserves space for the macOS traffic lights so
          nothing overlaps them (a Tailwind arbitrary width can get JIT-purged). */}
      <button
        onClick={() => ws.setFilesOpen(!ws.filesOpen)}
        title="Toggle files (⌘B)"
        className={`no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ws.filesOpen ? 'text-gold' : 'text-dim hover:text-ink'}`}
      >
        <PanelLeft size={16} />
      </button>
      <div className="flex shrink-0 items-center gap-2 pl-0.5">
        <img src={wolfUrl} alt="Nalu" className="h-5 w-5 object-contain" style={{ filter: 'brightness(0) invert(1)' }} />
        <span className="text-[13px] font-semibold tracking-tight text-ink">Nalu</span>
      </div>
      <button
        onClick={() => ws.setPaletteOpen(true)}
        className="no-drag mx-auto flex h-7 w-full min-w-0 max-w-md items-center gap-2 rounded-full border border-glass/[0.08] bg-panel/60 px-3.5 text-[12px] text-dim backdrop-blur hover:border-gold/30 hover:text-ink"
      >
        <Search size={12} />
        <span className="truncate">{ws.folder ? ws.folder.split('/').pop() : 'Search or run a command'}<span className="ml-1.5 text-dim/60">⌘K</span></span>
      </button>
      <button
        onClick={() => ws.setTermOpen(!ws.termOpen)}
        title="Toggle terminal (⌘`)"
        className={`no-drag flex h-7 w-7 items-center justify-center rounded-lg ${ws.termOpen ? 'text-gold' : 'text-dim hover:text-ink'}`}
      >
        <TerminalSquare size={16} />
      </button>
      <button
        onClick={() => ws.setSettingsOpen(true)}
        title="Settings"
        className="no-drag flex h-7 w-7 items-center justify-center rounded-lg text-dim hover:text-ink"
      >
        <Settings size={16} />
      </button>
    </div>
  )
}
