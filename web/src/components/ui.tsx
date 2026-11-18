import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Globe } from 'lucide-react'

export function ProviderIcon({ id, size = 16 }: { id: string; size?: number }) {
  if (id === 'github') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.9 10.9 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14 0 1.54-.01 2.79-.01 3.17 0 .31.21.66.79.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/>
    </svg>
  )
  if (id === 'google') return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8Z"/>
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.4 7.4 24 12 24Z"/>
      <path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10.1 0 12s.5 3.8 1.3 5.4l4-3.1Z"/>
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.4 0 3.3 2.6 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z"/>
    </svg>
  )
  if (id === 'gitlab') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#FC6D26" aria-hidden="true">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 5.52 2.16l2.44 7.49h8.08l2.44-7.51a.42.42 0 0 1 .81 0l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.96Z"/>
    </svg>
  )
  if (id === 'discord') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#5865F2" aria-hidden="true">
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3c-.2.4-.5.9-.6 1.3a18.3 18.3 0 0 0-5.5 0c-.2-.4-.4-.9-.7-1.3-1.7.3-3.4.8-4.9 1.4C.6 9.1-.2 13.7.2 18.2a20 20 0 0 0 6 3c.5-.7.9-1.4 1.3-2.1-.7-.3-1.4-.6-2-.9.2-.1.3-.3.5-.4 3.9 1.8 8.1 1.8 12 0 .2.1.3.3.5.4-.6.3-1.3.7-2 .9.4.7.8 1.5 1.3 2.1a20 20 0 0 0 6-3c.5-5.2-.8-9.7-3.5-13.8ZM8.1 15.4c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7.8 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z"/>
    </svg>
  )
  if (id === 'microsoft') return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z"/><path fill="#7FBA00" d="M13 1h10v10H13z"/>
      <path fill="#00A4EF" d="M1 13h10v10H1z"/><path fill="#FFB900" d="M13 13h10v10H13z"/>
    </svg>
  )
  return <Globe size={size} />
}

export function Select({ value, options, onChange, disabled }: { value: string; options: { value: string; label: string; icon?: ReactNode }[]; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    addEventListener('mousedown', h); return () => removeEventListener('mousedown', h)
  }, [])
  const cur = options.find(o => o.value === value)
  return (
    <div className="sel" ref={ref}>
      <button type="button" className="sel-btn" disabled={disabled} onClick={() => !disabled && setOpen(o => !o)}><span className="row" style={{ gap: 8 }}>{cur?.icon}{cur?.label ?? value}</span><ChevronDown size={15} /></button>
      {open && (
        <div className="sel-menu">
          {options.map(o => (
            <button key={o.value} type="button" className={`sel-opt ${o.value === value ? 'on' : ''}`} onClick={() => { onChange(o.value); setOpen(false) }}><span className="row" style={{ gap: 8 }}>{o.icon}{o.label}</span></button>
          ))}
        </div>
      )}
    </div>
  )
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-mask" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal card"><h3>{title}</h3>{children}</div>
    </div>
  )
}
