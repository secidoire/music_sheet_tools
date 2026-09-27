import type { ExportAction } from '../lib/deliver.ts'
import type { ExportProgress } from '../lib/useProject.ts'
import { Icon, Popover, Segmented } from './ui.tsx'

interface Props {
  disabled: boolean
  progress: ExportProgress | null
  dpi: number
  onDpi: (dpi: number) => void
  onExport: (action: ExportAction) => void
}

const ACTIONS: { action: ExportAction; label: string; hint?: string }[] = [
  { action: 'download', label: 'ダウンロード', hint: 'Enter' },
  { action: 'print', label: '印刷' },
  { action: 'open', label: '新しいタブで開く' },
]

/** Export button with a small menu: resolution, then what to do with the PDF. */
export function ExportMenu({ disabled, progress, dpi, onDpi, onExport }: Props) {
  return (
    <Popover
      className="export-menu"
      button={({ open, toggle }) => (
        <button type="button" className="primary export-button" disabled={disabled || !!progress} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          {progress ? `PDFを作成中 ${progress.done}/${progress.total}` : '書き出し'}
          {!progress && <Icon name="down" />}
        </button>
      )}
    >
      {(close) => (
        <div role="menu">
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
                close()
                onExport(a.action)
              }}
            >
              {a.label}
              {a.hint && <kbd>{a.hint}</kbd>}
            </button>
          ))}
        </div>
      )}
    </Popover>
  )
}
