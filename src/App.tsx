import { useEffect, useRef, useState } from 'react'
import { useProject, type ExportResult } from './lib/useProject.ts'
import { PageControls, PageStage } from './components/PageEditor.tsx'
import { PageList } from './components/PageList.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { ExportMenu } from './components/ExportMenu.tsx'
import { Icon } from './components/ui.tsx'
import { isImage, isPdf } from './lib/source.ts'

export default function App() {
  const p = useProject()
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const page = p.pages[p.selected]

  // ←/→ (or j/k) to move between pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'ArrowRight' || e.key === 'j') p.setSelected((i) => Math.min(p.pages.length - 1, i + 1))
      else if (e.key === 'ArrowLeft' || e.key === 'k') p.setSelected((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [p])

  const openFiles = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])].filter((f) => isPdf(f) || isImage(f))
    if (files.length) void p.load(files)
  }
  const pickFiles = () => fileInput.current?.click()

  const exportMenu = (
    <ExportMenu disabled={!p.pages.length || !!p.loading} progress={p.exporting} dpi={p.exportDpi} onDpi={p.setExportDpi} onExport={(a) => void p.exportPdf(a)} />
  )
  const progress = p.loading ?? p.exporting

  return (
    <div
      className={`app${dragOver ? ' drag-over' : ''}${p.pages.length ? ' has-pages' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        openFiles(e.dataTransfer.files)
      }}
    >
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          openFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <header className="topbar">
        <h1>楽譜PDF補正</h1>
        {p.fileName && (
          <span className="file-name" title={p.fileName}>
            {p.fileName}
            <span className="file-count">{p.loading ? `読み込み中 ${p.loading.done}/${p.loading.total}` : `全${p.pages.length}ページ`}</span>
          </span>
        )}
        <div className="spacer" />
        {p.pages.length > 0 && (
          <>
            <button type="button" onClick={pickFiles}>
              ファイルを選択
            </button>
            <span className="topbar-export">{exportMenu}</span>
          </>
        )}
        {progress && (
          <div className="topbar-progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
            <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        )}
      </header>

      {p.error && (
        <div className="notice error" role="alert">
          {p.error}
        </div>
      )}
      {p.exported && <ExportedNotice result={p.exported} onClose={p.dismissExported} />}

      {p.pages.length === 0 ? (
        <main className="welcome">
          <p className="welcome-lead">スキャンした楽譜の傾きや余白を整えて、A4サイズのPDFにします。</p>
          <button type="button" className="primary" onClick={pickFiles}>
            ファイルを選択
          </button>
          <div className="welcome-note">
            <p className="drop-hint">PDF・画像ファイルは、ここにドラッグ＆ドロップしても追加できます。</p>
            <p>画像を複数選ぶと、ファイル名順に1つのPDFにまとめます。</p>
            <p>ファイルはサーバーに送信されず、すべてブラウザ内で処理されます。</p>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <PageList pages={p.pages} selected={p.selected} onSelect={p.setSelected} />
          {page ? (
            <PageStage
              page={page}
              settings={p.settings}
              onOverrides={(o) => p.setOverrides(page.key, o)}
              index={p.selected}
              count={p.pages.length}
              onSelect={p.setSelected}
            />
          ) : (
            <div className="stage" />
          )}
          <aside className="inspector">
            {page && <PageControls page={page} settings={p.settings} onOverrides={(o) => p.setOverrides(page.key, o)} onRotate={(r) => p.rotatePage(page.key, r)} />}
            <SettingsPanel settings={p.settings} onChange={p.setSettings} />
          </aside>
          <div className="bottom-bar">{exportMenu}</div>
        </main>
      )}

      {dragOver && <div className="drop-overlay" aria-hidden />}
    </div>
  )
}

/**
 * Shown after an export: the automatic download can be blocked or turned into a preview
 * on phones, so the file can be saved (or sent to the Files app / other apps) from here.
 */
function ExportedNotice({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [result.file] })
  return (
    <div className="notice" role="status">
      <span className="notice-text">
        PDFを作成しました<span className="notice-file">{result.name}</span>
      </span>
      <a className="button" href={result.viewUrl} target="_blank" rel="noopener">
        開く
      </a>
      {canShare && (
        <button type="button" onClick={() => void navigator.share({ files: [result.file] }).catch(() => {})}>
          共有
        </button>
      )}
      <a className="button primary" href={result.url} download={result.name}>
        ダウンロード
      </a>
      <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
        <Icon name="close" />
      </button>
    </div>
  )
}
