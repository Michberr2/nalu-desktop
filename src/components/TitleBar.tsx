import { Search, PanelLeft, TerminalSquare, Settings } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import wolfUrl from '../lib/wolf'

export default function TitleBar() {
  const ws = useWorkspace()
  const ide = ws.appMode === 'ide'
  const initial = (ws.user?.displayName || ws.user?.id || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="drag flex h-11 shrink-0 items-center gap-2 px-3">
      {ide && (
        <button
          onClick={() => ws.setFilesOpen(!ws.filesOpen)}
          title="Toggle files (⌘B)"
          className={`no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${ws.filesOpen ? 'text-gold' : 'text-dim hover:text-ink'}`}
        >
          <PanelLeft size={16} />
        </button>
      )}
      <div className="flex shrink-0 items-center gap-2 pl-0.5">
        <img src={wolfUrl} alt="Nalu" className="h-5 w-5 object-contain" style={{ filter: 'brightness(0) invert(1)' }} />
        <span className="text-[13px] font-semibold tracking-tight text-ink">Nalu</span>
      </div>

      {/* Nalu (website-like chat) ⇄ IDE — interchangeable */}
      <div className="no-drag ml-1 flex shrink-0 rounded-full border border-glass/[0.1] bg-panel/60 p-0.5 text-[11px] backdrop-blur">
        <button onClick={() => ws.setAppMode('nalu')} className={`rounded-full px-2.5 py-0.5 transition-colors ${ws.appMode === 'nalu' ? 'bg-gold text-[#15170f]' : 'text-dim hover:text-ink'}`}>Nalu</button>
        <button onClick={() => ws.setAppMode('ide')} className={`rounded-full px-2.5 py-0.5 transition-colors ${ide ? 'bg-gold text-[#15170f]' : 'text-dim hover:text-ink'}`}>IDE</button>
      </div>

      {ide ? (
        <button
          onClick={() => ws.setPaletteOpen(true)}
          className="no-drag mx-auto flex h-7 w-full min-w-0 max-w-md items-center gap-2 rounded-full border border-glass/[0.08] bg-panel/60 px-3.5 text-[12px] text-dim backdrop-blur hover:border-gold/30 hover:text-ink"
        >
          <Search size={12} />
          <span className="truncate">{ws.folder ? ws.folder.split('/').pop() : 'Search or run a command'}<span className="ml-1.5 text-dim/60">⌘K</span></span>
        </button>
      ) : (
        <div className="mx-auto" />
      )}

      {ide && (
        <button
          onClick={() => ws.setTermOpen(!ws.termOpen)}
          title="Toggle terminal (⌘`)"
          className={`no-drag flex h-7 w-7 items-center justify-center rounded-lg ${ws.termOpen ? 'text-gold' : 'text-dim hover:text-ink'}`}
        >
          <TerminalSquare size={16} />
        </button>
      )}

      {/* Avatar when signed in (click → Settings); gear otherwise */}
      {ws.user ? (
        <button
          onClick={() => ws.setSettingsOpen(true)}
          title={`${ws.user.displayName} — account & settings`}
          className="no-drag flex h-7 w-7 items-center justify-center rounded-full bg-gold/90 text-[11px] font-semibold text-[#15170f] hover:brightness-110"
        >
          {initial}
        </button>
      ) : (
        <button
          onClick={() => ws.setSettingsOpen(true)}
          title="Sign in"
          className="no-drag flex h-7 items-center gap-1.5 rounded-full border border-gold/40 px-2.5 text-[11px] font-medium text-gold hover:bg-gold/10"
        >
          <Settings size={12} /> Sign in
        </button>
      )}
    </div>
  )
}
