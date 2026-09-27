import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useProject, type ExportResult } from './lib/useProject.ts'
import { resolvePage } from './pipeline/process.ts'
import { AngleControl, Stage, type StageView } from './components/PageEditor.tsx'
import { PageList } from './components/PageList.tsx'
import { ExportMenu } from './components/ExportMenu.tsx'
import { MoreMenu } from './components/MoreMenu.tsx'
import { Icon } from './components/ui.tsx'
import { isImage, isPdf } from './lib/source.ts'
import { MAX_SKEW_DEG } from './pipeline/deskew.ts'

/** Slider value not yet written to the page's overrides (committed once the slider rests). */
interface Draft {
  key: string
  part: number
  value: number
}

const COMMIT_MS = 200
const SETTLE_MS = 600

export default function App() {
  const p = useProject()
  const [dragOver, setDragOver] = useState(false)
  const [view, setView] = useState<StageView>('adjust')
  const [activePart, setActivePart] = useState(0)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [settle, setSettle] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const page = p.pages[p.selected]
  const a = page?.analysis

  const resolved = a && page ? resolvePage(a, p.settings, page.overrides) : undefined
  if (resolved && draft && draft.key === page.key) {
    resolved.angles = resolved.angles.map((v, i) => (i === draft.part ? draft.value : v))
  }
  const part = resolved && activePart < resolved.angles.length ? activePart : 0

  const selectPage = (i: number) => {
    p.setSelected(i)
    setActivePart(0)
  }

  // Ease the page into its correction when the analysis lands (or the page is re-analysed
  // after a turn). Derived during render so the transition is in place in the same commit
  // as the new angle; an effect would apply the angle first and the transition too late.
  const [shown, setShown] = useState<{ key?: string; analysis?: unknown }>({})
  if (shown.key !== page?.key || shown.analysis !== a) {
    setShown({ key: page?.key, analysis: a })
    if (a && shown.key === page?.key) setSettle(true)
  }
  useEffect(() => {
    if (!settle) return
    const id = setTimeout(() => setSettle(false), SETTLE_MS)
    return () => clearTimeout(id)
  }, [settle])

  // Write the slider value once it stops moving; until then only the CSS transform follows it.
  useEffect(() => {
    if (!draft) return
    const id = setTimeout(() => {
      p.setOverrides(draft.key, (o) => {
        const angles = [...(o.angles ?? [])]
        angles[draft.part] = draft.value
        return { ...o, angles }
      })
      setDraft(null)
    }, COMMIT_MS)
    return () => clearTimeout(id)
  }, [draft, p])

  const setAngle = (v: number) => {
    if (!page || !resolved || resolved.bypass) return
    setSettle(false)
    setDraft({ key: page.key, part, value: Math.round(Math.max(-MAX_SKEW_DEG, Math.min(MAX_SKEW_DEG, v)) * 100) / 100 })
  }
  const resetAngle = () => {
    if (!page) return
    setDraft(null)
    setSettle(true)
    p.setOverrides(page.key, (o) => {
      const angles = [...(o.angles ?? [])]
      angles[part] = undefined
      return { ...o, angles }
    })
  }

  // ←/→ nudge the angle (Shift: coarser), PageUp/PageDown change page, Enter downloads.
  const keyState = useRef({ setAngle, resolved, part, selectPage, p })
  useLayoutEffect(() => {
    keyState.current = { setAngle, resolved, part, selectPage, p }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as Element
      if (t.closest('input, select, textarea, [role="slider"], [role="dialog"], [role="menu"]')) return
      const { setAngle, resolved, part, selectPage, p } = keyState.current
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && resolved) {
        const step = (e.shiftKey ? 0.5 : 0.05) * (e.key === 'ArrowLeft' ? -1 : 1)
        setAngle(resolved.angles[part] + step)
      } else if (e.key === 'PageDown') {
        selectPage(Math.min(p.pages.length - 1, p.selected + 1))
      } else if (e.key === 'PageUp') {
        selectPage(Math.max(0, p.selected - 1))
      } else if (e.key === 'Enter' && !t.closest('button, a') && p.pages.length && !p.loading && !p.exporting) {
        void p.exportPdf('download')
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    document.title = p.fileName ? `${p.fileName} - 楽譜PDF補正` : '楽譜PDF補正'
  }, [p.fileName])

  const openFiles = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])].filter((f) => isPdf(f) || isImage(f))
    if (files.length) void p.load(files)
  }
  const pickFiles = () => fileInput.current?.click()
  /** Opens the bundled sample through the same path as a user's file. */
  const loadSample = async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}sample.jpg`)
    const blob = await res.blob()
    void p.load([new File([blob], 'サンプル.jpg', { type: 'image/jpeg' })])
  }

  const o = page?.overrides ?? {}
  const rotated = !!a && a.rotation !== a.autoRotation
  const pageEdited = rotated || Object.values(o).some((v) => (Array.isArray(v) ? v.some((x) => x !== undefined) : v !== undefined))
  const toggleSplit = () => {
    if (!page || !a || !resolved) return
    const split = !resolved.split
    setActivePart(0)
    p.setOverrides(page.key, (prev) => ({ ...prev, split: split === a.isSpread ? undefined : split, angles: undefined }))
  }
  const resetPage = () => {
    if (!page) return
    setDraft(null)
    setSettle(true)
    if (rotated) void p.rotatePage(page.key, undefined)
    else p.setOverrides(page.key, {})
  }
  const autoAngle = a && (resolved?.split ? (a.angles.length === 2 ? a.angles[part] : a.wholeAngle) : a.wholeAngle)

  return (
    <div
      className={`app${p.pages.length ? ' has-pages' : ''}`}
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

      {p.pages.length === 0 ? (
        <main className="empty">
          <header className="empty-head">
            <h1>楽譜PDF補正</h1>
            <p>傾き・背景・余白をブラウザだけで直します</p>
          </header>
          <div className="view">
            <div className={`sheet-slot${dragOver ? ' over' : ''}`} onClick={pickFiles}>
              {/* Its click bubbles to the frame, which opens the file picker. */}
              <button type="button" className="slot-pick">
                <span className="for-pointer">楽譜のPDF・画像をドロップ、またはクリックして選択</span>
                <span className="for-touch">タップして楽譜のPDF・画像を選択</span>
              </button>
              <button
                type="button"
                className="slot-sample"
                onClick={(e) => {
                  e.stopPropagation()
                  void loadSample()
                }}
              >
                サンプルで試す
              </button>
            </div>
          </div>
          <p className="empty-foot">ファイルはサーバーに送信されず、ブラウザ内で処理されます</p>
        </main>
      ) : (
        <>
          <main className="workspace">
            {page && (
              <Stage
                page={page}
                resolved={resolved}
                index={p.selected}
                count={p.pages.length}
                onSelect={selectPage}
                onRotate={(r) => p.rotatePage(page.key, r)}
                onToggleSplit={toggleSplit}
                onSplitX={(x) => p.setOverrides(page.key, (prev) => ({ ...prev, splitX: x }))}
                activePart={part}
                onActivePart={setActivePart}
                settle={settle}
                view={view}
                onView={setView}
                more={
                  <MoreMenu
                    bypass={resolved?.bypass}
                    onBypass={(v) => p.setOverrides(page.key, (prev) => ({ ...prev, bypass: v || undefined }))}
                    onResetPage={pageEdited ? resetPage : undefined}
                    settings={p.settings}
                    onSettings={p.setSettings}
                  />
                }
              />
            )}
            {p.pages.length > 1 && <PageList pages={p.pages} selected={p.selected} onSelect={selectPage} />}
          </main>

          {p.error && (
            <div className="notice error" role="alert">
              {p.error}
            </div>
          )}
          {p.exported && <ExportedNotice result={p.exported} onClose={p.dismissExported} />}

          <footer className="bar">
            <button type="button" onClick={pickFiles}>
              開く
            </button>
            <AngleControl
              resolved={resolved}
              auto={autoAngle}
              manual={(draft?.key === page?.key && draft?.part === part) || o.angles?.[part] !== undefined}
              activePart={part}
              onActivePart={setActivePart}
              onChange={setAngle}
              onReset={resetAngle}
            />
            <ExportMenu disabled={!!p.loading} progress={p.exporting} dpi={p.exportDpi} onDpi={p.setExportDpi} onExport={(action) => void p.exportPdf(action)} />
          </footer>
        </>
      )}
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
      <button type="button" className="tool" onClick={onClose} aria-label="閉じる">
        <Icon name="close" />
      </button>
    </div>
  )
}
