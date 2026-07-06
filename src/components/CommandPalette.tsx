import { Command } from 'cmdk'
import { FolderOpen, Save, TerminalSquare, Sparkles, FileText, Settings, GitBranch, Search } from 'lucide-react'
import { useWorkspace } from '../lib/store'

export default function CommandPalette() {
  const ws = useWorkspace()
  const close = () => ws.setPaletteOpen(false)
  const run = (fn: () => void) => () => { fn(); close() }

  const actions = [
    { icon: Sparkles, label: 'Ask Nalu to edit this file', kw: 'ai edit', run: run(() => ws.setAiOpen(true)) },
    { icon: Sparkles, label: 'Explain the current selection', kw: 'ai explain', run: run(() => ws.setAiOpen(true)) },
    { icon: FolderOpen, label: 'Open folder…', kw: 'open', run: run(() => void ws.openFolder()) },
    { icon: Save, label: 'Save', kw: 'save', hint: '⌘S', run: run(() => void ws.saveActive()) },
    { icon: TerminalSquare, label: 'New terminal', kw: 'terminal', hint: '⌘`', run: run(() => ws.setTermOpen(true)) },
    { icon: Search, label: 'Search across files', kw: 'find', run: run(() => ws.setView('search')) },
    { icon: GitBranch, label: 'Source control', kw: 'git', run: run(() => ws.setView('git')) },
    { icon: FileText, label: 'Nalu Studio', kw: 'studio', run: run(() => ws.setView('studio')) },
    { icon: Settings, label: 'Settings', kw: 'preferences', run: run(() => ws.setView('settings')) },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh] backdrop-blur-sm" onClick={close}>
      <Command
        loop
        className="w-full max-w-lg animate-fadeIn overflow-hidden rounded-xl border border-glass/[0.12] bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') close() }}
      >
        <div className="flex items-center gap-2 border-b border-glass/[0.08] px-3">
          <Command.Input
            autoFocus
            placeholder="Type a command or search…"
            className="h-11 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-dim"
          />
          <span className="text-[11px] text-dim">esc</span>
        </div>
        <Command.List className="max-h-80 overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-[12px] text-dim">No matching commands.</Command.Empty>
          {actions.map((a) => (
            <Command.Item
              key={a.label}
              value={a.label + ' ' + a.kw}
              onSelect={a.run}
              className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-ink data-[selected=true]:bg-glass/[0.08] data-[selected=true]:text-ink"
            >
              <a.icon size={15} className="shrink-0 text-gold" />
              <span className="flex-1">{a.label}</span>
              {a.hint && <span className="text-[11px] text-dim">{a.hint}</span>}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}
