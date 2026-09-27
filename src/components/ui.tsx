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
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Shown next to a value only while it differs from the automatic one. */
export function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="icon-button reset" onClick={onClick} aria-label={label} title={label}>
      <Icon name="undo" />
    </button>
  )
}

const ICONS = {
  rotateLeft: 'M4 5v5h5M4.6 10A8 8 0 1 1 6 16.5',
  rotateRight: 'M20 5v5h-5M19.4 10A8 8 0 1 0 18 16.5',
  prev: 'm14.5 6-6 6 6 6',
  next: 'm9.5 6 6 6-6 6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  close: 'M6 6l12 12M18 6 6 18',
} as const

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  )
}
