import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { checkForUpdate, DOWNLOAD_PAGE, type UpdateInfo } from '../lib/update'

// Slim banner under the title bar: appears when a newer release is published so
// an already-installed app can update with one click.
export default function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    const run = () => checkForUpdate().then((u) => { if (alive && u && localStorage.getItem('nalu-skip-update') !== u.latest) setInfo(u) })
    run()
    const t = setInterval(run, 6 * 60 * 60 * 1000) // re-check every 6h
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (!info || dismissed) return null
  return (
    <div className="no-drag mx-2 mb-2 flex items-center gap-3 rounded-xl border border-gold/40 bg-gold/[0.12] px-3 py-2 text-[12px] backdrop-blur">
      <span className="flex-1 text-ink">
        <b className="text-gold">Nalu {info.latest}</b> is available <span className="text-dim">(you have {info.current})</span>
      </span>
      <button
        onClick={() => window.open(DOWNLOAD_PAGE, '_blank')}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gold/90 px-2.5 py-1 text-[11px] font-medium text-[#15170f] hover:bg-gold"
      >
        <Download size={12} /> Download update
      </button>
      <button onClick={() => { localStorage.setItem('nalu-skip-update', info.latest); setDismissed(true) }} title="Skip this version" className="rounded p-1 text-dim hover:text-ink"><X size={13} /></button>
    </div>
  )
}
