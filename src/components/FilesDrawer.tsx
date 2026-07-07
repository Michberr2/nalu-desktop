import { FolderOpen, PanelLeftClose, FilePlus, FolderPlus, Files, Search, GitBranch } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import Explorer from './Explorer'
import SearchPanel from './SearchPanel'
import GitPanel from './GitPanel'

// The ONE drawer — Files by default, with Search and Git as modes (no extra
// activity bar; keeps the clean single-drawer look).
export default function FilesDrawer() {
  const ws = useWorkspace()

  const newAt = async (kind: 'file' | 'folder') => {
    if (!ws.folder) return void ws.openFolder()
    const name = window.prompt(kind === 'file' ? 'New file name' : 'New folder name')?.trim()
    if (!name) return
    try {
      if (kind === 'file') { const p = await window.nalu.createFile(ws.folder, name); ws.refresh(); await ws.openFile(p, name) }
      else { await window.nalu.mkdir(ws.folder, name); ws.refresh() }
    } catch { alert(`Could not create ${kind}`) }
  }

  const modes = [
    { key: 'files', icon: Files, title: 'Files' },
    { key: 'search', icon: Search, title: 'Search' },
    { key: 'git', icon: GitBranch, title: 'Source control' },
  ] as const

  return (
    <div className="flex w-60 shrink-0 flex-col overflow-hidden rounded-2xl border border-glass/[0.1] bg-panel/75 backdrop-blur-2xl">
      <div className="flex items-center gap-1 px-2 py-2">
        <div className="flex rounded-lg border border-glass/[0.08] bg-panel2 p-0.5">
          {modes.map((m) => (
            <button
              key={m.key}
              title={m.title}
              onClick={() => ws.setDrawerMode(m.key)}
              className={`flex h-6 w-7 items-center justify-center rounded-md ${ws.drawerMode === m.key ? 'bg-gold/90 text-[#15170f]' : 'text-dim hover:text-ink'}`}
            >
              <m.icon size={13} />
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {ws.drawerMode === 'files' && <>
            <button onClick={() => void newAt('file')} title="New file" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><FilePlus size={13} /></button>
            <button onClick={() => void newAt('folder')} title="New folder" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><FolderPlus size={13} /></button>
          </>}
          <button onClick={() => void ws.openFolder()} title="Open folder" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><FolderOpen size={13} /></button>
          <button onClick={() => ws.setFilesOpen(false)} title="Hide (⌘B)" className="rounded p-1 text-dim hover:bg-glass/10 hover:text-ink"><PanelLeftClose size={13} /></button>
        </div>
      </div>
      {ws.drawerMode === 'files' && <Explorer />}
      {ws.drawerMode === 'search' && <SearchPanel />}
      {ws.drawerMode === 'git' && <GitPanel />}
    </div>
  )
}
