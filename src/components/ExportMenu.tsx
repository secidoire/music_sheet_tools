import { useEffect, useState } from 'react'
import type { ExportAction } from '../lib/deliver.ts'
import type { ExportProgress } from '../lib/useProject.ts'
import { Icon, Segmented } from './ui.tsx'

interface Props {
  disabled: boolean
  progress: ExportProgress | null
  dpi: number
  onDpi: (dpi: number) => void
  onExport: (action: ExportAction) => void
}

const ACTIONS: { action: ExportAction; label: string }[] = [
  { action: 'download', label: 'ダウンロード' },
  { action: 'print', label: '印刷' },
  { action: 'open', label: '新しいタブで開く' },
]

/** Export button with a small menu: resolution, then what to do with the PDF. */
export function ExportMenu({ disabled, progress, dpi, onDpi, onExport }: Props) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="export-menu">
      <button
        type="button"
        className="primary export-button"
        disabled={disabled || !!progress}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {progress ? `PDFを作成中 ${progress.done}/${progress.total}` : '書き出し'}
        {!progress && <Icon name="down" />}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="menu" role="menu">
            <div className="menu-section">
              <span className="menu-label">解像度</span>
              <Segmented<number> label="解像度" value={dpi} onChange={onDpi} options={[600, 400, 300].map((d) => ({ value: d, label: `${d}dpi` }))} />
            </div>
            {ACTIONS.map((a) => (
              <button
                key={a.action}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setOpen(false)
                  onExport(a.action)
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
