import { useState } from 'react'
import type { GlobalSettings, PageOverrides, Rotation } from '../pipeline/types.ts'
import { resolvePage } from '../pipeline/process.ts'
import { MAX_SKEW_DEG } from '../pipeline/deskew.ts'
import type { PageState } from '../lib/useProject.ts'
import { SourceView } from './SourceView.tsx'
import { Icon, Segmented, Switch } from './ui.tsx'

type SetOverrides = (o: PageOverrides | ((prev: PageOverrides) => PageOverrides)) => void

const METHOD_LABEL = { gutter: '余白', shadow: '綴じ目の影', center: '中央' } as const

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
  const a = page.analysis
  const nav = (
    <div className="pager">
      <button type="button" className="icon-button" disabled={index === 0} onClick={() => onSelect(index - 1)} aria-label="前のページ">
        <Icon name="prev" />
      </button>
      <span className="pager-pos">
        <b>{page.pageNo}</b> / {count}
      </span>
      <button type="button" className="icon-button" disabled={index === count - 1} onClick={() => onSelect(index + 1)} aria-label="次のページ">
        <Icon name="next" />
      </button>
    </div>
  )
  if (!a || !page.sourceUrl || !page.sourceSize) {
    return (
      <div className="stage">
        <div className="stage-bar">{nav}</div>
        <div className="stage-empty">{page.error ? `エラー: ${page.error}` : <span className="shimmer">解析中…</span>}</div>
      </div>
    )
  }
  const r = resolvePage(a, settings, page.overrides)
  const stale = page.previewSig !== JSON.stringify(r)

  return (
    <div className="stage">
      <div className="stage-bar">
        {nav}
        <div className="view-switch">
          <Segmented
            label="表示"
            value={view}
            onChange={setView}
            options={[
              { value: 'before', label: '処理前' },
              { value: 'after', label: '処理後' },
            ]}
          />
        </div>
      </div>
      <div className={`compare show-${view}`}>
        <section className="compare-before">
          <h3>処理前 <span className="hint">赤線をドラッグで分割位置、緑線が五線と平行なら傾きOK</span></h3>
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
        </section>
        <section className="compare-after">
          <h3>
            処理後(A4){stale && <span className="badge">更新中…</span>}
          </h3>
          <div className={`sheets${stale ? ' stale' : ''}`}>
            {page.previewUrls?.map((u, i) => <img key={u} src={u} alt={`処理後 ${i + 1}`} className="sheet" />) ?? <div className="sheet placeholder" />}
          </div>
        </section>
      </div>
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

/** Per-page corrections. Everything starts from the automatic detection; edits are marked 手動. */
export function PageControls({ page, settings, onOverrides, onRotate }: ControlsProps) {
  const a = page.analysis
  if (!a) return null
  const r = resolvePage(a, settings, page.overrides)
  const o = page.overrides
  const autoAngles = r.split ? (a.angles.length === 2 ? a.angles : [a.wholeAngle, a.wholeAngle]) : [a.wholeAngle]
  const partNames = r.split ? ['左ページ', '右ページ'] : ['ページ']
  const rotated = a.rotation !== a.autoRotation
  const edited = Object.keys(o).length > 0 || rotated
  const turn = (by: number) => onRotate((((a.rotation + by) % 360) + 360) % 360 as Rotation)

  const setAngle = (i: number, v: number | undefined) =>
    onOverrides((prev) => {
      const angles = [...(prev.angles ?? [])]
      angles[i] = v
      return { ...prev, angles }
    })

  return (
    <section className="panel">
      <h2 className="panel-title">
        このページ <span className="panel-scope">p.{page.pageNo} だけに適用</span>
        {edited && (
          <button type="button" className="text-button" onClick={() => (rotated ? onRotate(undefined) : onOverrides({}))} title="手動の変更をすべて取り消します">
            <Icon name="undo" /> 自動に戻す
          </button>
        )}
      </h2>

      <fieldset className="group-set" disabled={r.bypass}>
        <div className="group">
          <div className="row">
            <span className="group-label">向き</span>
            <span className="status">{a.rotation === 0 ? 'そのまま' : `${a.rotation}°`}<Origin manual={rotated} /></span>
            <div className="row-end">
              <button type="button" className="icon-button" onClick={() => turn(-90)} aria-label="左に90°回転" title="左に90°回転">
                <Icon name="rotateLeft" />
              </button>
              <button type="button" className="icon-button" onClick={() => turn(90)} aria-label="右に90°回転" title="右に90°回転">
                <Icon name="rotateRight" />
              </button>
            </div>
          </div>
        </div>

        <div className="group">
          <Switch
            checked={r.split}
            onChange={(v) => onOverrides((p) => ({ ...p, split: v === a.isSpread ? undefined : v, angles: undefined }))}
          >
            見開きを分割
          </Switch>
          {r.split && (
            <p className="status">
              分割位置 {(r.splitX * 100).toFixed(1)}%
              {o.splitX !== undefined ? (
                <>
                  <Origin manual />
                  <button type="button" className="text-button" onClick={() => onOverrides((p) => ({ ...p, splitX: undefined }))}>
                    自動に戻す
                  </button>
                </>
              ) : (
                <span className="origin">自動: {METHOD_LABEL[a.splitMethod]}</span>
              )}
            </p>
          )}
        </div>

        <div className="group">
          <span className="group-label">傾き</span>
          {r.angles.map((v, i) => {
            const manual = o.angles?.[i] !== undefined
            return (
              <div className="angle" key={i}>
                <div className="row">
                  {r.split && <span>{partNames[i]}</span>}
                  <input
                    type="number"
                    min={-MAX_SKEW_DEG}
                    max={MAX_SKEW_DEG}
                    step={0.05}
                    value={v}
                    aria-label={`${partNames[i]}の傾き(度)`}
                    onChange={(e) => e.target.value !== '' && setAngle(i, Math.max(-MAX_SKEW_DEG, Math.min(MAX_SKEW_DEG, Number(e.target.value))))}
                  />
                  <span className="unit">°</span>
                  <Origin manual={manual} />
                  {manual && (
                    <button type="button" className="text-button row-end" onClick={() => setAngle(i, undefined)}>
                      自動 ({autoAngles[i].toFixed(2)}°)
                    </button>
                  )}
                </div>
                <input
                  type="range"
                  min={-MAX_SKEW_DEG}
                  max={MAX_SKEW_DEG}
                  step={0.05}
                  value={v}
                  onChange={(e) => setAngle(i, Number(e.target.value))}
                  aria-label={`${partNames[i]}の傾き`}
                />
              </div>
            )
          })}
        </div>
      </fieldset>

      <div className="group">
        <Switch
          checked={r.bypass}
          onChange={(v) => onOverrides((p) => ({ ...p, bypass: v || undefined }))}
          title="このページだけ補正を行わず、原本をそのままA4に配置します"
        >
          補正しない(原本のまま)
        </Switch>
      </div>
    </section>
  )
}

function Origin({ manual }: { manual: boolean }) {
  return <span className={`origin${manual ? ' manual' : ''}`}>{manual ? '手動' : '自動'}</span>
}
