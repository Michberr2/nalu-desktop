import { Search, PanelLeft, TerminalSquare, Settings, FolderOpen, ChevronDown } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import wolfUrl from '../lib/wolf'
import RemoteTaskActivity from './RemoteTaskActivity'
import TeamDirectory from './TeamDirectory'
import { API_BASE, getToken } from '../lib/naluApi'

export default function TitleBar() {
  const ws = useWorkspace()
  const ide = ws.appMode === 'ide'
  const initial = (ws.user?.displayName || ws.user?.id || '?').trim().charAt(0).toUpperCase()
  return <header className="app-header drag">
    <div className="app-brand"><img src={wolfUrl} alt="" /><span>Nalu</span></div>
    <nav className="workspace-switch no-drag" aria-label="Main navigation">
      <button aria-pressed={ide} onClick={() => ws.setAppMode('ide')}>Workspace</button>
      <button aria-pressed={!ide} onClick={() => ws.setAppMode('nalu')}>Chats</button>
    </nav>
    {ide && <button className="project-switch no-drag" title={ws.folder || 'Open a project folder'} aria-label="Open project folder" onClick={() => void ws.openFolder()}><FolderOpen size={14}/><span>{ws.folder?.split(/[\\/]/).pop() || 'Open project'}</span><ChevronDown size={12}/></button>}
    <button className="command-search no-drag" aria-label="Search commands" onClick={() => ws.setPaletteOpen(true)}><Search size={14}/><span>Find anything</span><kbd>⌘K</kbd></button>
    <div className="header-tools no-drag">
      {ide && <>
        <button aria-label="Toggle files" title="Toggle files (⌘B)" aria-pressed={ws.filesOpen} className="icon-button" onClick={() => ws.setFilesOpen(!ws.filesOpen)}><PanelLeft size={16}/></button>
        <button aria-label="Toggle terminal" title="Toggle terminal (⌘`)" aria-pressed={ws.termOpen} className="icon-button" onClick={() => ws.setTermOpen(!ws.termOpen)}><TerminalSquare size={16}/></button>
      </>}
      <RemoteTaskActivity apiBase={API_BASE} readToken={getToken}/>
      <TeamDirectory apiBase={API_BASE} readToken={getToken}/>
      <button onClick={() => ws.setSettingsOpen(true)} title={ws.user ? `${ws.user.displayName} — account & settings` : 'Sign in'} aria-label={ws.user ? 'Account and settings' : 'Sign in and settings'} className={ws.user ? 'account-avatar' : 'account-button'}>
        {ws.user ? initial : <><Settings size={15}/><span>Sign in</span></>}
      </button>
    </div>
  </header>
}
