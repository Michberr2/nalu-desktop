import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { FolderOpen, Save, TerminalSquare, FileText, Settings, Sparkles, Search, GitBranch } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import { indexWorkspace } from '../lib/workspaceIndex'
import { matchFiles } from '../lib/quickOpen'
import UtilityDialog from './UtilityDialog'

export default function CommandPalette() {
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [indexNotice, setIndexNotice] = useState('')
  const close = () => ws.setPaletteOpen(false)
  const run = (fn: () => void) => () => { fn(); close() }
  const compose = (mode: string) => { ws.setAppMode('ide'); window.dispatchEvent(new CustomEvent('nalu:compose',{detail:{mode}})) }
  useEffect(() => {
    const controller = new AbortController()
    if(ws.folder)void indexWorkspace(ws.folder,window.nalu.readDir,controller.signal).then(result=>{if(!controller.signal.aborted){setFiles(result.files);setIndexNotice(result.limited ? 'File search is limited to the indexed project files.' : result.unreadable ? 'Some project folders could not be read.' : '')}},()=>{if(!controller.signal.aborted)setIndexNotice('Project files could not be indexed. You can still use commands.')})
    return ()=>controller.abort()
  }, [ws.folder])
  const matches = useMemo(() => query.trim() ? matchFiles(files,query).slice(0,8) : [],[files,query])
  const open = (file: string) => { if(!ws.folder)return;ws.setAppMode('ide');const separator=ws.folder.includes('\\')?'\\':'/';void ws.openFile(ws.folder.replace(/[\\/]+$/,'')+separator+file.replace(/\//g,separator),file.split('/').pop()!);close() }
  const actions = [
    { icon: Sparkles, label: 'Describe a task to Nalu', kw: 'auto ai build business work computer question help understand explain', hint: '', run: run(() => compose('auto')) },
    { icon: Sparkles, label: 'Give Nalu a coding task', kw: 'agent build fix feature', hint: '', run: run(() => compose('agent')) },
    ...(ws.active ? [{ icon: Sparkles, label: 'Edit this file with Nalu', kw: 'edit rewrite change ai', hint: '', run: run(() => compose('edit')) }] : []),
    { icon: FileText, label: 'Open file…', kw: 'quick find file path', hint: '⌘P', run: run(() => { ws.setAppMode('ide'); ws.setQuickOpen(true) }) },
    { icon: FolderOpen, label: 'Open folder…', kw: 'open project', hint: '', run: run(() => void ws.openFolder()) },
    { icon: Save, label: 'Save', kw: 'save', hint: '⌘S', run: run(() => void ws.saveActive()) },
    { icon: Save, label: 'Save as…', kw: 'save as copy recover', hint: '⌘⇧S', run: run(() => void ws.saveActiveAs()) },
    { icon: Search, label: 'Search in project', kw: 'search content text', hint: '⌘⇧F', run: run(() => { ws.setAppMode('ide'); ws.setFilesOpen(true); ws.setDrawerMode('search') }) },
    { icon: GitBranch, label: 'Review changes', kw: 'git source control commit diff', hint: '⌘⇧G', run: run(() => { ws.setAppMode('ide'); ws.setFilesOpen(true); ws.setDrawerMode('git') }) },
    { icon: TerminalSquare, label: 'Toggle terminal', kw: 'terminal shell', hint: '⌘`', run: run(() => { ws.setAppMode('ide'); ws.setTermOpen(!ws.termOpen) }) },
    { icon: FileText, label: 'Toggle files', kw: 'explorer sidebar', hint: '⌘B', run: run(() => ws.setFilesOpen(!ws.filesOpen)) },
    { icon: FileText, label: 'Close workspace', kw: 'close hide companion background', hint: '', run: run(() => void window.nalu.closeWorkspace()) },
    { icon: Settings, label: 'Settings', kw: 'preferences token account appearance theme', hint: '', run: run(() => ws.setSettingsOpen(true)) },
  ]
  return <UtilityDialog title="Find anything" onClose={close}>
    <Command loop className="command-menu">
      <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Search files, actions, or ask Nalu…" className="command-input" />
      <Command.List className="max-h-[50vh] overflow-y-auto py-2">
        <Command.Empty className="px-3 py-6 text-center text-[12px] text-dim">No matching files or commands.</Command.Empty>
        {matches.length>0 && <Command.Group heading="Project files">{matches.map(file=><Command.Item key={file} value={file} onSelect={()=>open(file)} className="command-item"><FileText size={15}/><span>{file}</span><span className="command-kind">File</span></Command.Item>)}</Command.Group>}
        <Command.Group heading="Actions">{actions.map(a=><Command.Item key={a.label} value={a.label+' '+a.kw} onSelect={a.run} className="command-item"><a.icon size={15}/><span>{a.label}</span>{a.hint && <kbd>{a.hint}</kbd>}</Command.Item>)}</Command.Group>
      </Command.List>
      {indexNotice && <p className="px-2 py-1 text-xs text-dim">{indexNotice}</p>}
      <div className="command-footer">↑↓ to choose <span>Enter to open</span><span>Esc to close</span></div>
    </Command>
  </UtilityDialog>
}
