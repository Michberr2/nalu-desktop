import { useEffect, useState } from 'react'
import { ExternalLink, Globe, Square } from 'lucide-react'
import type { BrowserPreview as PreviewState } from '../../electron/chromeBrowser'
import ResizeGrip from './ResizeGrip'
import { clampPanelSize, usePanelSize } from '../lib/panelSize'

export default function BrowserPreview({ busy, onStop }: { busy: boolean; onStop: () => void }) {
  const [preview, setPreview] = useState<PreviewState | null>(null), [error, setError] = useState('')
  const [height, setHeight] = usePanelSize('nalu-chrome-preview-h')
  useEffect(() => {
    let mounted = true
    void window.nalu.pc.preview().then(state => { if (mounted) setPreview(state) })
    const off = window.nalu.pc.onPreview(setPreview)
    return () => { mounted = false; off() }
  }, [])
  const show = async () => { const result = await window.nalu.pc.browserShow(); setError(result.ok ? '' : result.out) }
  return <section className="browser-preview" aria-label="Live Chrome preview" style={height === null ? undefined : { height }}>
    <header><Globe size={13}/><span>{preview?.connected ? 'Chrome · live' : 'Chrome'}</span><span className="browser-preview-address" title={preview?.url}>{preview?.url && preview.url !== 'about:blank' ? preview.url : 'Ready for your task'}</span>
      {busy && <button aria-label="Stop browser task" title="Stop task" onClick={onStop}><Square size={12}/></button>}
      <button aria-label="Open Chrome window" title="Open Chrome" onClick={() => void show()}><ExternalLink size={13}/></button>
    </header>
    {preview?.image ? <button className="browser-preview-page" aria-label="Click in Chrome preview" onClick={async event => {
      if (!event.detail) { void show(); return }
      const image = event.currentTarget.querySelector('img')!, rect = image.getBoundingClientRect()
      const scale = Math.min(rect.width / preview.width, rect.height / preview.height)
      const x = (event.clientX - rect.left - (rect.width - preview.width * scale) / 2) / scale
      const y = (event.clientY - rect.top - (rect.height - preview.height * scale) / 2) / scale
      if (x < 0 || y < 0 || x > preview.width || y > preview.height) return
      if (busy) onStop()
      await window.nalu.pc.browserCancel()
      const result = await window.nalu.pc.previewClick(x, y)
      setError(result.ok ? '' : result.out)
    }}><img src={preview.image} alt="Live Chrome page" draggable={false}/></button>
      : <button className="browser-preview-start" onClick={() => void show()}>Open Chrome <span>Watch Nalu browse, click and type here.</span></button>}
    {(error || preview?.error) && <p role="status">{error || preview?.error}</p>}
    <ResizeGrip label="Resize Chrome preview" axis="y" onResize={({ start, dy }) => setHeight(clampPanelSize(start.height + dy, 110, Math.max(110, Math.min(480, (document.querySelector('.assistant-column')?.clientHeight || innerHeight) - 280))))} onReset={() => setHeight(null)} />
  </section>
}
