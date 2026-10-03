import { useEffect, useRef, useState } from 'react'
import { NaluAvatar, type AvatarPhase } from '../components/avatar/rig.mjs'
import artwork from '../components/avatar/nalu-avatar.png'

export default function FloatingNalu({ paused, reduced, phase }: { paused: boolean; reduced: boolean; phase: AvatarPhase }) {
  const canvas = useRef<HTMLCanvasElement>(null), rig = useRef<NaluAvatar | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!canvas.current) return
    let disposed = false
    const fail = () => { if (!disposed) setReady(false); avatar.destroy() }
    const avatar = new NaluAvatar(canvas.current, { src: artwork, transparent: true, autoPlay: false, onError: fail })
    rig.current = avatar
    void avatar.loaded.then(() => { if (!disposed && avatar.ready) setReady(true) }).catch(fail)
    const unsubscribe = window.companion.onCursor(({ x, y }) => {
      if (!canvas.current) return
      const r = canvas.current.getBoundingClientRect()
      avatar.setLook((x - r.left - r.width * .54) / (r.width * .64), (y - r.top - r.height * .51) / (r.height * .64))
    })
    return () => { disposed = true; unsubscribe(); avatar.destroy(); rig.current = null }
  }, [])
  useEffect(() => {
    const avatar = rig.current
    if (!avatar || !ready) return
    avatar.setReducedMotion(reduced)
    avatar.setActivity(phase)
    if (paused) avatar.pause(); else avatar.play()
  }, [ready, paused, reduced, phase])
  return <div className="floating-nalu" data-ready={ready} data-paused={paused} aria-hidden="true">
    {!ready && <img src={artwork} alt="" />}
    <canvas ref={canvas} style={{ opacity: ready ? 1 : 0 }} />
  </div>
}
