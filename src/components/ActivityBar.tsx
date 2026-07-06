import { Files, Search, GitBranch, Sparkles, Settings, MessageSquare, TerminalSquare } from 'lucide-react'
import { useWorkspace } from '../lib/store'

const ITEMS = [
  { key: 'explorer', icon: Files, title: 'Explorer' },
  { key: 'search', icon: Search, title: 'Search' },
  { key: 'git', icon: GitBranch, title: 'Source Control' },
  { key: 'studio', icon: Sparkles, title: 'Nalu Studio' },
] as const

export default function ActivityBar() {
  const ws = useWorkspace()
  return (
    <div className="flex w-14 shrink-0 flex-col items-center rounded-2xl border border-glass/[0.08] bg-panel py-3">
      {ITEMS.map(({ key, icon: Icon, title }) => {
        const activeV = ws.view === key
        return (
          <button
            key={key}
            title={title}
            onClick={() => ws.setView(key)}
            className={`relative my-0.5 flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
              activeV ? 'text-gold' : 'text-dim hover:text-ink'
            }`}
          >
            {activeV && <span className="absolute left-0 h-5 w-0.5 rounded-full bg-gold" />}
            <Icon size={19} strokeWidth={1.7} />
          </button>
        )
      })}
      <div className="flex-1" />
      <button
        title="Toggle terminal (⌘`)"
        onClick={() => ws.setTermOpen(!ws.termOpen)}
        className={`my-0.5 flex h-10 w-10 items-center justify-center rounded-lg ${ws.termOpen ? 'text-gold' : 'text-dim hover:text-ink'}`}
      >
        <TerminalSquare size={19} strokeWidth={1.7} />
      </button>
      <button
        title="Toggle Nalu AI (⌘B)"
        onClick={() => ws.setAiOpen(!ws.aiOpen)}
        className={`my-0.5 flex h-10 w-10 items-center justify-center rounded-lg ${ws.aiOpen ? 'text-gold' : 'text-dim hover:text-ink'}`}
      >
        <MessageSquare size={19} strokeWidth={1.7} />
      </button>
      <button
        title="Settings"
        onClick={() => ws.setView('settings')}
        className={`my-0.5 flex h-10 w-10 items-center justify-center rounded-lg ${ws.view === 'settings' ? 'text-gold' : 'text-dim hover:text-ink'}`}
      >
        <Settings size={19} strokeWidth={1.7} />
      </button>
    </div>
  )
}
