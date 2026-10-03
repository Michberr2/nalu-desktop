import { useEffect, useRef, useState } from 'react'
import { NaluAvatar } from './avatar/rig.mjs'
import artwork from './avatar/nalu-avatar.png'

export default function AvatarPresence({ size = 240, phase = null }: { size?: number; phase?: 'thinking' | 'listening' | 'talking' | null }) {
  const canvas = useRef<HTMLCanvasElement>(null), rig = useRef<NaluAvatar | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let current = true
    const avatar = new NaluAvatar(canvas.current!, { src: artwork, onError: () => { if (current) setReady(false) } })
    rig.current = avatar
    void avatar.loaded.then(() => { if (current) setReady(true) }).catch(() => { if (current) setReady(false) })
    return () => { current = false; avatar.destroy(); rig.current = null }
  }, [])
  useEffect(() => { rig.current?.setActivity(phase, 0) }, [phase])
  return <div className="avatar-presence" style={{width:size}} data-avatar-presence data-ready={ready}>
    <img src={artwork} alt={ready ? '' : 'Nalu, your little companion'} aria-hidden={ready}/>
    <canvas ref={canvas} className={ready ? 'is-ready' : ''} tabIndex={ready ? 0 : -1} aria-hidden={!ready} role="button" aria-label="Say hi to Nalu" />
  </div>
}

export function AvatarPageIntro({ label, title, detail, status = 'Right here with you', size = 190, busy = false }: { label: string; title: string; detail: string; status?: string; size?: number; busy?: boolean }) {
  return <section className="avatar-page-intro">
    <div className="avatar-intro-copy"><span className="avatar-eyebrow">{label}</span><h2>{title}</h2><p>{detail}</p><span className="avatar-presence-status"><i/>{status}</span></div>
    <AvatarPresence size={size} phase={busy ? 'thinking' : null}/>
  </section>
}
