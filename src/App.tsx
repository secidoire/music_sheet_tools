import { useEffect, useState } from 'react'
import { useProject } from './lib/useProject.ts'
import { PageEditor } from './components/PageEditor.tsx'
import { PageList } from './components/PageList.tsx'
import { SettingsBar } from './components/SettingsBar.tsx'
import { isImage, isPdf } from './lib/source.ts'

export default function App() {
  const p = useProject()
  const [dragOver, setDragOver] = useState(false)
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

  return (
    <div
      className={`app${dragOver ? ' drag-over' : ''}`}
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
      <header>
        <h1>楽譜PDF補正</h1>
        {p.fileName && <span className="file-name">{p.fileName}</span>}
        <div className="spacer" />
        <label className="button">
          ファイルを開く
          <input
            type="file"
            accept="application/pdf,.pdf,image/*"
            multiple
            hidden
            onChange={(e) => {
              openFiles(e.target.files)
              e.target.value = ''
            }}
          />
        </label>
        <button type="button" className="primary" disabled={!p.pages.length || !!p.loading || !!p.exporting} onClick={() => void p.exportPdf()}>
          {p.exporting ? `書き出し中 ${p.exporting.done}/${p.exporting.total}` : 'A4 PDFを書き出し'}
        </button>
      </header>

      <SettingsBar settings={p.settings} onChange={p.setSettings} exportDpi={p.exportDpi} onExportDpi={p.setExportDpi} />

      {p.error && <div className="error" role="alert">{p.error}</div>}
      {p.loading && (
        <div className="progress">
          読み込み・解析中 {p.loading.done}/{p.loading.total}
          <progress value={p.loading.done} max={p.loading.total} />
        </div>
      )}

      {p.pages.length === 0 ? (
        <main className="drop-zone">
          <p>楽譜のPDF・画像をここにドラッグ&ドロップ</p>
          <p className="hint">
            見開きの分割・傾き補正・背景の白飛ばし・余白トリミングを行い、A4のPDFに書き出します。
            <br />
            画像(JPG・PNG など)は複数まとめて選ぶと、ファイル名順に1つのPDFになります。
            <br />
            処理はすべてブラウザ内で行われ、ファイルはどこにも送信されません。
          </p>
        </main>
      ) : (
        <main className="workspace">
          <PageList pages={p.pages} selected={p.selected} onSelect={p.setSelected} />
          {page && <PageEditor page={page} settings={p.settings} onOverrides={(o) => p.setOverrides(page.key, o)} onRotate={(r) => p.rotatePage(page.key, r)} />}
        </main>
      )}
    </div>
  )
}
