import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export default function UtilityDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const outside = useRef(false)
  useEffect(() => {
    const dialog = ref.current!
    const trigger = document.activeElement as HTMLElement | null
    dialog.showModal()
    return () => { dialog.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])
  const isOutside = (e: React.PointerEvent<HTMLDialogElement> | React.MouseEvent<HTMLDialogElement>) => {
    const r=e.currentTarget.getBoundingClientRect()
    return e.target === e.currentTarget && (e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)
  }
  return <dialog ref={ref} aria-label={title} aria-labelledby={id} className="utility-dialog" onCancel={e => { e.preventDefault(); onClose() }} onKeyDown={e => e.stopPropagation()} onPointerDown={e => { outside.current=isOutside(e) }} onClick={e => { if(outside.current && isOutside(e))onClose();outside.current=false }}>
    <div className="utility-dialog-header"><h2 id={id}>{title}</h2><button className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18}/></button></div>
    <div className="utility-dialog-body">{children}</div>
  </dialog>
}
