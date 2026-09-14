import { FolderOpen, ArrowUpRight, Code2, Sparkles, BriefcaseBusiness, TerminalSquare, Command, FileSearch } from 'lucide-react'
import { useWorkspace } from '../lib/store'

export default function Welcome() {
  const ws = useWorkspace()
  const compose = (mode: string, prompt = '') => window.dispatchEvent(new CustomEvent('nalu:compose', { detail: { mode, prompt } }))
  const project = ws.folder?.split(/[\\/]/).pop()
  return <div className="workspace-welcome">
    <div className="welcome-kicker"><span className="status-dot"/> YOUR WORKSPACE</div>
    <h1>{project ? 'Let’s make progress.' : 'What are we working on?'}</h1>
    <p>{project ? <>You’re in <strong>{project}</strong>. Open a file, explore an idea, or let Nalu take the first step.</> : 'Build an idea, improve your code, or get everyday work done. Describe the outcome; Nalu helps with the next step.'}</p>
    <div className="welcome-primary-actions">
      <button className="welcome-primary" onClick={() => project ? ws.setQuickOpen(true) : void ws.openFolder()}>{project ? <FileSearch size={16}/> : <FolderOpen size={16}/>} {project ? 'Open a file' : 'Open a project'}<ArrowUpRight size={15}/></button>
      <button className="welcome-secondary" onClick={() => compose('auto')}>Start with a task <ArrowUpRight size={14}/></button>
    </div>
    <div className="welcome-divider"><span>A FEW WAYS TO BEGIN</span></div>
    <div className="welcome-task-grid">
      <button onClick={() => compose('auto', 'Help me build a new project. My idea is: ')}><Sparkles size={19}/><strong>Build an idea</strong><span>Turn a brief into a working project.</span><ArrowUpRight size={14}/></button>
      <button onClick={() => compose('auto', 'Help me improve this code. I want to: ')}><Code2 size={19}/><strong>Work on existing code</strong><span>Understand, fix, and add features.</span><ArrowUpRight size={14}/></button>
      <button onClick={() => compose('auto', 'Help me with a work task. I need to: ')}><BriefcaseBusiness size={19}/><strong>Handle everyday work</strong><span>Write, research, or work in apps.</span><ArrowUpRight size={14}/></button>
    </div>
    <div className="welcome-shortcuts"><button onClick={() => ws.setPaletteOpen(true)}><Command size={13}/> All commands <kbd>⌘K</kbd></button><button onClick={() => ws.setTermOpen(true)}><TerminalSquare size={13}/> Open terminal <kbd>⌘`</kbd></button></div>
  </div>
}
