import type { ReactNode } from 'react'

/** Checkbox drawn as a switch; the whole row is the hit area. */
export function Switch({ checked, onChange, children, title }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string }) {
  return (
    <label className="switch" title={title}>
      <span className="switch-label">{children}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden />
    </label>
  )
}

/** Small set of mutually exclusive options shown side by side. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
  disabled?: boolean
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const ICONS = {
  open: 'M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14',
  share: 'M12 15V4m0 0L8 8m4-4 4 4M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6',
  rotateLeft: 'M4 5v5h5M4.6 10A8 8 0 1 1 6 16.5',
  rotateRight: 'M20 5v5h-5M19.4 10A8 8 0 1 0 18 16.5',
  prev: 'm14.5 6-6 6 6 6',
  next: 'm9.5 6 6 6-6 6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  close: 'M6 6l12 12M18 6 6 18',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  check: 'm5 12.5 4.5 4.5L19 7',
} as const

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}

/** Five-line staff mark used as the logo. */
export function StaffMark() {
  return (
    <svg className="staff-mark" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" />
      <path d="M6 10h20M6 14h20M6 18h20M6 22h20" />
      <circle cx="19" cy="18" r="2.6" />
      <path d="M21.4 18V8.5" />
    </svg>
  )
}
