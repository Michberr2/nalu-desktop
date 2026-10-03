import { ArrowUpRight, MessageCircle, FolderOpen, Layers, Users, Settings2, ArrowRight } from 'lucide-react'
import { useWorkspace } from '../lib/store'
import AvatarPresence from './AvatarPresence'

export default function AvatarHome() {
  const ws = useWorkspace()
  const open = (name: string) => window.dispatchEvent(new Event(name))
  const project = ws.folder?.split(/[\\/]/).pop()
  return <main className="avatar-home" aria-label="Nalu home">
    <section className="avatar-home-scene">
      <div className="avatar-home-copy">
        <span className="avatar-presence-status"><i/>Right here with you</span>
        <h1>I'm right<br/>here.</h1>
        <p>A thought, a question, a new idea.<br/>A little help for whatever comes next.</p>
        <div className="avatar-home-actions">
          <button className="avatar-primary" onClick={() => ws.setAppMode('nalu')}><MessageCircle size={17}/>Start a conversation<ArrowRight size={16}/></button>
          <button className="avatar-secondary" onClick={() => ws.setAppMode('ide')}>Open your workspace<ArrowUpRight size={15}/></button>
        </div>
      </div>
      <div className="avatar-home-art"><AvatarPresence size={460}/><span>Move your cursor. Nalu looks where you go.</span></div>
    </section>
    <div className="avatar-home-destinations" aria-label="Your Nalu tools">
      <button onClick={() => ws.setAppMode('ide')}><FolderOpen/><span><strong>{project || 'Your workspace'}</strong><small>{project ? 'Pick up where you left off' : 'Ideas, files, and things to make'}</small></span><ArrowUpRight/></button>
      <button onClick={() => open('nalu:open-activity')}><Layers/><span><strong>AutoPilot</strong><small>Your work, moving forward</small></span><ArrowUpRight/></button>
      <button onClick={() => open('nalu:open-team')}><Users/><span><strong>Your team</strong><small>A little help from your people</small></span><ArrowUpRight/></button>
      <button onClick={() => ws.setSettingsOpen(true)}><Settings2/><span><strong>Your Nalu</strong><small>Make yourself at home</small></span><ArrowUpRight/></button>
    </div>
  </main>
}
