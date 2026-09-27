import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ResolvedPage, Rotation } from '../pipeline/types.ts'
import { MAX_SKEW_DEG } from '../pipeline/deskew.ts'
import type { PageState } from '../lib/useProject.ts'
import { DeskewView } from './DeskewView.tsx'
import { Icon, Segmented } from './ui.tsx'

export type StageView = 'adjust' | 'result'

interface StageProps {
  page: PageState
  /** Resolved parameters (undefined until the page is analysed), with any in-progress slider value applied. */
  resolved?: ResolvedPage
  index: number
  count: number
  onSelect: (i: number) => void
  onRotate: (rotation: Rotation) => void
  onToggleSplit: () => void
  onSplitX: (x: number) => void
  activePart: number
  onActivePart: (i: number) => void
  settle: boolean
  view: StageView
  onView: (v: StageView) => void
  /** The "…" menu, rendered at the end of the toolbar. */
  more: ReactNode
}

/** The page itself, with a toolbar along its top edge for everything that isn't needed all the time. */
export function Stage({ page, resolved: r, index, count, onSelect, onRotate, onToggleSplit, onSplitX, activePart, onActivePart, settle, view, onView, more }: StageProps) {
  const a = page.analysis
  const swipe = useSwipe((dir) => {
    const i = index + dir
    if (i >= 0 && i < count) onSelect(i)
  })
  // Only say something when it takes a while: quick pages just appear.
  const slow = useDelayed(!page.error && !a, 1000)
  const turn = (by: number) => a && onRotate((((a.rotation + by) % 360) + 360) % 360 as Rotation)

  return (
    <section className="stage">
      <div className="toolbar">
        {count > 1 && (
          <span className="tool-group pager">
            <button type="button" className="tool" disabled={index === 0} onClick={() => onSelect(index - 1)} aria-label="前のページ" title="前のページ（PageUp）">
              <Icon name="prev" />
            </button>
            <span className="pager-pos">
              {page.pageNo} / {count}
            </span>
            <button type="button" className="tool" disabled={index === count - 1} onClick={() => onSelect(index + 1)} aria-label="次のページ" title="次のページ（PageDown）">
              <Icon name="next" />
            </button>
          </span>
        )}
        <span className="tool-group">
          <button type="button" className="tool" disabled={!a || r?.bypass} onClick={() => turn(-90)} aria-label="左に90°回転" title="左に90°回転">
            <Icon name="rotateLeft" />
          </button>
          <button type="button" className="tool" disabled={!a || r?.bypass} onClick={() => turn(90)} aria-label="右に90°回転" title="右に90°回転">
            <Icon name="rotateRight" />
          </button>
          <button type="button" className="tool text" disabled={!a || r?.bypass} aria-pressed={!!r?.split} onClick={onToggleSplit} aria-label="見開き分割">
            <span className="label-long">見開き分割</span>
            <span className="label-short">分割</span>
          </button>
        </span>
        {slow && <span className="status">{page.sourceUrl ? '解析中' : '読み込み中'}</span>}
        <span className="toolbar-end">
          <Segmented<StageView>
            label="表示"
            value={view}
            onChange={onView}
            options={[
              { value: 'adjust', label: '調整' },
              { value: 'result', label: '仕上がり' },
            ]}
          />
          {more}
        </span>
      </div>

      <div className="view" {...swipe}>
        {page.error ? (
          <p className="status">このページを読み込めませんでした</p>
        ) : view === 'result' && page.previewUrls ? (
          <div className={`sheets${r && page.previewSig !== JSON.stringify(r) ? ' stale' : ''}`} style={{ '--n': page.previewUrls.length } as React.CSSProperties}>
            {page.previewUrls.map((u, i) => (
              <img key={u} src={u} alt={`仕上がり ${i + 1}`} className="sheet" />
            ))}
          </div>
        ) : page.sourceUrl && page.sourceSize ? (
          <DeskewView
            url={page.sourceUrl}
            width={page.sourceSize.width}
            height={page.sourceSize.height}
            rotation={r && !r.bypass ? r.rotation : 0}
            split={!!r?.split && !r.bypass}
            splitX={r?.splitX ?? 0.5}
            angles={r && !r.bypass ? r.angles : [0]}
            activePart={activePart}
            onActivePart={onActivePart}
            settle={settle}
            onSplitX={onSplitX}
          />
        ) : null}
      </div>
    </section>
  )
}

interface AngleProps {
  resolved?: ResolvedPage
  /** Angle the detector found for the active part. */
  auto?: number
  manual: boolean
  activePart: number
  onActivePart: (i: number) => void
  onChange: (v: number) => void
  onReset: () => void
}

/** The one control that is always there: skew of the active part, as a slider and a number. */
export function AngleControl({ resolved: r, auto, manual, activePart, onActivePart, onChange, onReset }: AngleProps) {
  const disabled = !r || r.bypass
  const v = r?.angles[activePart] ?? 0
  const clamp = (x: number) => Math.max(-MAX_SKEW_DEG, Math.min(MAX_SKEW_DEG, x))
  return (
    <div className="angle">
      <span className="angle-label">傾き</span>
      {r?.split && !r.bypass && (
        <Segmented<number>
          label="調整するページ"
          value={activePart}
          onChange={onActivePart}
          options={[
            { value: 0, label: '左' },
            { value: 1, label: '右' },
          ]}
        />
      )}
      <input
        type="range"
        min={-MAX_SKEW_DEG}
        max={MAX_SKEW_DEG}
        step={0.05}
        value={v}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="傾き"
      />
      <label className="angle-value">
        <input
          type="number"
          min={-MAX_SKEW_DEG}
          max={MAX_SKEW_DEG}
          step={0.05}
          value={Number(v.toFixed(2))}
          disabled={disabled}
          onChange={(e) => e.target.value !== '' && onChange(clamp(Number(e.target.value)))}
          aria-label="傾き（度）"
        />
        °
      </label>
      <button
        type="button"
        className="reset"
        disabled={disabled || !manual}
        onClick={onReset}
        title={auto !== undefined ? `自動検出の値（${auto.toFixed(2)}°）に戻す` : undefined}
      >
        リセット
      </button>
    </div>
  )
}

/** True once `on` has stayed true for `ms`. */
function useDelayed(on: boolean, ms: number) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    if (!on) return
    const id = setTimeout(() => setLate(true), ms)
    return () => {
      clearTimeout(id)
      setLate(false)
    }
  }, [on, ms])
  return on && late
}

/** Horizontal swipe → -1 (to the previous page) / +1 (to the next). Vertical movement is left to scrolling. */
function useSwipe(onSwipe: (dir: -1 | 1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      // Leave the split handle alone.
      start.current = e.touches.length === 1 && !(e.target as Element).closest('.split-handle') ? { x: t.clientX, y: t.clientY } : null
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
