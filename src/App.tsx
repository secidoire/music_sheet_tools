import { useEffect, useRef, useState } from 'react'
import { useProject, type ExportResult } from './lib/useProject.ts'
import { PageControls, PageStage } from './components/PageEditor.tsx'
import { PageList } from './components/PageList.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { Icon, StaffMark } from './components/ui.tsx'
import { isImage, isPdf } from './lib/source.ts'

export default function App() {
  const p = useProject()
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const page = p.pages[p.selected]
  const busy = !!p.loading || !!p.exporting

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

  const exportButton = (
    <button type="button" className="primary export-button" disabled={!p.pages.length || busy} onClick={() => void p.exportPdf()}>
      <Icon name="download" />
      {p.exporting ? `書き出し中 ${p.exporting.done}/${p.exporting.total}` : 'A4 PDFを書き出す'}
    </button>
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
        <div className="brand">
          <StaffMark />
          <h1>楽譜PDF補正</h1>
        </div>
        {p.fileName && (
          <span className="file-chip" title={p.fileName}>
            {p.fileName}
            <span className="file-count">{p.loading ? `解析中 ${p.loading.done}/${p.loading.total}` : `${p.pages.length}ページ`}</span>
          </span>
        )}
        <div className="spacer" />
        {p.pages.length > 0 && (
          <>
            <button type="button" className="ghost" onClick={pickFiles} aria-label="別のファイルを開く">
              <Icon name="open" />
              <span className="label-wide">別のファイルを開く</span>
            </button>
            <div className="topbar-export">{exportButton}</div>
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
          <div className="welcome-card">
            <WelcomeStaff />
            <h2>スキャンした楽譜を、きれいなA4に。</h2>
            <p className="welcome-lead">見開きの分割・傾き補正・背景の白飛ばし・余白の調整を自動で行います。</p>
            <button type="button" className="primary big" onClick={pickFiles}>
              <Icon name="open" />
              PDF・画像を選ぶ
            </button>
            <p className="hint">またはここにドラッグ&ドロップ(複数の画像はファイル名順に1冊にまとめます)</p>
            <ol className="steps">
              <li><b>1</b>読み込む</li>
              <li><b>2</b>確認・微調整</li>
              <li><b>3</b>A4 PDFで保存</li>
            </ol>
            <p className="privacy">
              <Icon name="lock" />
              処理はすべてブラウザ内。ファイルはどこにも送信されません。
            </p>
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
            <SettingsPanel settings={p.settings} onChange={p.setSettings} exportDpi={p.exportDpi} onExportDpi={p.setExportDpi} />
          </aside>
          <div className="bottom-bar">{exportButton}</div>
        </main>
      )}

      {dragOver && (
        <div className="drop-overlay" aria-hidden>
          <p>ドロップして読み込む</p>
        </div>
      )}
    </div>
  )
}

/** Staff lines drawn in, then a short phrase of notes. */
function WelcomeStaff() {
  const notes = [
    [70, 26], [110, 21], [150, 16], [190, 21], [236, 11], [276, 16],
  ]
  return (
    <svg className="welcome-staff" viewBox="0 0 340 56" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={i} x1="10" x2="330" y1={8 + i * 10} y2={8 + i * 10} style={{ animationDelay: `${i * 0.06}s` }} />
      ))}
      {notes.map(([x, y], i) => (
        <g key={i} className="note" style={{ animationDelay: `${0.5 + i * 0.09}s` }}>
          <ellipse cx={x} cy={y} rx="5.4" ry="4" transform={`rotate(-20 ${x} ${y})`} />
          <line x1={x + 4.8} x2={x + 4.8} y1={y - 1} y2={y - 26} />
        </g>
      ))}
    </svg>
  )
}

/**
 * Shown after an export: the automatic download can be blocked or turned into a preview
 * on phones, so the file can be saved (or sent to the Files app / other apps) from here.
 */
function ExportedNotice({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [result.file] })
  return (
    <div className="notice success" role="status">
      <Icon name="check" />
      <span className="notice-text">
        書き出しました <b>{result.name}</b>
      </span>
      <a className="button primary" href={result.url} download={result.name}>
        <Icon name="download" />
        ダウンロード
      </a>
      {canShare && (
        <button type="button" onClick={() => void navigator.share({ files: [result.file] }).catch(() => {})}>
          <Icon name="share" />
          共有・保存
        </button>
      )}
      <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
        <Icon name="close" />
      </button>
    </div>
  )
}
