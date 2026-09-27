import { useRef, useState } from 'react'
import type { GlobalSettings, PageOverrides, Rotation } from '../pipeline/types.ts'
import { resolvePage } from '../pipeline/process.ts'
import { MAX_SKEW_DEG } from '../pipeline/deskew.ts'
import type { PageState } from '../lib/useProject.ts'
import { SourceView } from './SourceView.tsx'
import { Icon, ResetButton, Segmented, Switch } from './ui.tsx'

type SetOverrides = (o: PageOverrides | ((prev: PageOverrides) => PageOverrides)) => void

interface StageProps {
  page: PageState
  settings: GlobalSettings
  onOverrides: SetOverrides
  index: number
  count: number
  onSelect: (i: number) => void
}

/** Before/after view of the selected page. On narrow screens only one side is shown at a time. */
export function PageStage({ page, settings, onOverrides, index, count, onSelect }: StageProps) {
  const [view, setView] = useState<'before' | 'after'>('after')
  const swipe = useSwipe((dir) => {
    const i = index + dir
    if (i >= 0 && i < count) onSelect(i)
  })
  const a = page.analysis
  const r = a && resolvePage(a, settings, page.overrides)

  return (
    <div className="stage">
      <div className="stage-bar">
        <div className="pager">
          <button type="button" className="icon-button" disabled={index === 0} onClick={() => onSelect(index - 1)} aria-label="前のページ">
            <Icon name="prev" />
          </button>
          <span className="pager-pos">
            {page.pageNo} / {count}
          </span>
          <button type="button" className="icon-button" disabled={index === count - 1} onClick={() => onSelect(index + 1)} aria-label="次のページ">
            <Icon name="next" />
          </button>
        </div>
        {r && (
          <div className="view-switch">
            <Segmented
              label="表示"
              value={view}
              onChange={setView}
              options={[
                { value: 'before', label: '補正前' },
                { value: 'after', label: '補正後' },
              ]}
            />
          </div>
        )}
      </div>

      {!a || !r || !page.sourceUrl || !page.sourceSize ? (
        <div className="stage-empty">{page.error ? 'このページを読み込めませんでした' : '読み込み中…'}</div>
      ) : (
        <div className={`compare show-${view}`}>
          <figure className="compare-before">
            <SourceView
              url={page.sourceUrl}
              width={page.sourceSize.width}
              height={page.sourceSize.height}
              rotation={r.bypass ? 0 : r.rotation}
              split={r.split && !r.bypass}
              splitX={r.splitX}
              angles={r.bypass ? [0] : r.angles}
              onSplitX={(x) => onOverrides((p) => ({ ...p, splitX: x }))}
            />
            <figcaption>赤線：分割位置（ドラッグで移動）　緑線：傾きの目安</figcaption>
          </figure>
          <figure className="compare-after" {...swipe}>
            <div
              className={`sheets${page.previewSig !== JSON.stringify(r) ? ' stale' : ''}`}
              style={{ '--n': page.previewUrls?.length ?? 1 } as React.CSSProperties}
            >
              {page.previewUrls?.map((u, i) => <img key={u} src={u} alt={`補正後 ${i + 1}`} className="sheet" />) ?? <div className="sheet" />}
            </div>
            <figcaption>補正後（A4）</figcaption>
          </figure>
        </div>
      )}
    </div>
  )
}

interface ControlsProps {
  page: PageState
  settings: GlobalSettings
  onOverrides: SetOverrides
  /** Turns the page; undefined restores the detected orientation. */
  onRotate: (rotation?: Rotation) => void
}

/** Per-page corrections. Values start from the automatic detection; a reset button marks the ones changed by hand. */
export function PageControls({ page, settings, onOverrides, onRotate }: ControlsProps) {
  const a = page.analysis
  if (!a) return null
  const r = resolvePage(a, settings, page.overrides)
  const o = page.overrides
  const partNames = r.split ? ['左', '右'] : ['']
  const turn = (by: number) => onRotate((((a.rotation + by) % 360) + 360) % 360 as Rotation)

  const setAngle = (i: number, v: number | undefined) =>
    onOverrides((prev) => {
      const angles = [...(prev.angles ?? [])]
      angles[i] = v
      return { ...prev, angles }
    })

  return (
    <section className="section">
      <h2>このページのみ</h2>

      <fieldset className="items" disabled={r.bypass}>
        <div className="item row">
          <span className="item-label">向き</span>
          {a.rotation !== a.autoRotation && <ResetButton label="向きをリセット" onClick={() => onRotate(undefined)} />}
          <span className="row-end">
            <button type="button" className="icon-button" onClick={() => turn(-90)} aria-label="左に90°回転" title="左に90°回転">
              <Icon name="rotateLeft" />
            </button>
            <button type="button" className="icon-button" onClick={() => turn(90)} aria-label="右に90°回転" title="右に90°回転">
              <Icon name="rotateRight" />
            </button>
          </span>
        </div>

        <div className="item row">
          <Switch
            checked={r.split}
            onChange={(v) => onOverrides((p) => ({ ...p, split: v === a.isSpread ? undefined : v, angles: undefined }))}
          >
            見開きを分割
          </Switch>
          {o.splitX !== undefined && <ResetButton label="分割位置をリセット" onClick={() => onOverrides((p) => ({ ...p, splitX: undefined }))} />}
        </div>

        <div className="item">
          <span className="item-label">傾き補正</span>
          {r.angles.map((v, i) => (
            <label className="field" key={i}>
              {partNames[i] && <span>{partNames[i]}</span>}
              <input
                type="range"
                min={-MAX_SKEW_DEG}
                max={MAX_SKEW_DEG}
                step={0.05}
                value={v}
                onChange={(e) => setAngle(i, Number(e.target.value))}
                aria-label={`${partNames[i]}傾き`}
              />
              <input
                type="number"
                min={-MAX_SKEW_DEG}
                max={MAX_SKEW_DEG}
                step={0.05}
                value={v}
                aria-label={`${partNames[i]}傾き（度）`}
                onChange={(e) => e.target.value !== '' && setAngle(i, Math.max(-MAX_SKEW_DEG, Math.min(MAX_SKEW_DEG, Number(e.target.value))))}
              />
              <span className="unit">°</span>
              <span className="reset-slot">{o.angles?.[i] !== undefined && <ResetButton label="傾きをリセット" onClick={() => setAngle(i, undefined)} />}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="item">
        <Switch checked={r.bypass} onChange={(v) => onOverrides((p) => ({ ...p, bypass: v || undefined }))} title="このページは補正せず、元の画像のままA4に配置します">
          補正しない（元のまま）
        </Switch>
      </div>
    </section>
  )
}

/** Horizontal swipe → -1 (to the previous page) / +1 (to the next). Vertical movement is left to scrolling. */
function useSwipe(onSwipe: (dir: -1 | 1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      start.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current
      start.current = null
      if (!s) return
      const t = e.changedTouches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) onSwipe(dx < 0 ? 1 : -1)
    },
  }
}
