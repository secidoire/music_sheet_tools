import type { GlobalSettings, PageOverrides } from '../pipeline/types.ts'
import { resolvePage } from '../pipeline/process.ts'
import { MAX_SKEW_DEG } from '../pipeline/deskew.ts'
import type { PageState } from '../lib/useProject.ts'
import { SourceView } from './SourceView.tsx'

interface Props {
  page: PageState
  settings: GlobalSettings
  onOverrides: (o: PageOverrides | ((prev: PageOverrides) => PageOverrides)) => void
}

const METHOD_LABEL = { gutter: '余白', shadow: '綴じ目の影', center: '中央' } as const

export function PageEditor({ page, settings, onOverrides }: Props) {
  const a = page.analysis
  if (!a || !page.sourceUrl || !page.sourceSize) {
    return <div className="editor empty">{page.error ? `エラー: ${page.error}` : '解析中…'}</div>
  }
  const r = resolvePage(a, settings, page.overrides)
  const o = page.overrides
  const autoAngles = r.split ? (a.angles.length === 2 ? a.angles : [a.wholeAngle, a.wholeAngle]) : [a.wholeAngle]
  const partNames = r.split ? ['左ページ', '右ページ'] : ['ページ']
  const edited = Object.keys(o).length > 0
  const stale = page.previewSig !== JSON.stringify(r)

  const setAngle = (i: number, v: number | undefined) =>
    onOverrides((prev) => {
      const angles = [...(prev.angles ?? [])]
      angles[i] = v
      return { ...prev, angles }
    })

  return (
    <div className="editor">
      <div className="editor-controls">
        <label className="toggle" title="このページだけ補正を行わず、原本をそのままA4に配置します">
          <input type="checkbox" checked={r.bypass} onChange={(e) => onOverrides((p) => ({ ...p, bypass: e.target.checked || undefined }))} />
          補正を取り消す(原本のまま)
        </label>
        <button type="button" disabled={!edited} onClick={() => onOverrides({})}>
          自動検出に戻す
        </button>
      </div>

      <fieldset className="editor-controls" disabled={r.bypass}>
        <label className="toggle">
          <input
            type="checkbox"
            checked={r.split}
            onChange={(e) => onOverrides((p) => ({ ...p, split: e.target.checked === a.isSpread ? undefined : e.target.checked, angles: undefined }))}
          />
          見開きを分割
        </label>
        {r.split && (
          <span className="hint">
            分割位置 {(r.splitX * 100).toFixed(1)}%({o.splitX !== undefined ? '手動' : `自動: ${METHOD_LABEL[a.splitMethod]}`})
            {o.splitX !== undefined && (
              <button type="button" className="link" onClick={() => onOverrides((p) => ({ ...p, splitX: undefined }))}>
                自動に戻す
              </button>
            )}
          </span>
        )}
      </fieldset>

      <fieldset className="editor-controls angles" disabled={r.bypass}>
        {r.angles.map((v, i) => (
          <div className="angle" key={i}>
            <span className="angle-name">{partNames[i]}の傾き</span>
            <input
              type="range"
              min={-MAX_SKEW_DEG}
              max={MAX_SKEW_DEG}
              step={0.05}
              value={v}
              onChange={(e) => setAngle(i, Number(e.target.value))}
              aria-label={`${partNames[i]}の傾き`}
            />
            <input
              type="number"
              min={-MAX_SKEW_DEG}
              max={MAX_SKEW_DEG}
              step={0.05}
              value={v}
              onChange={(e) => e.target.value !== '' && setAngle(i, Math.max(-MAX_SKEW_DEG, Math.min(MAX_SKEW_DEG, Number(e.target.value))))}
            />
            °
            <button type="button" className="link" disabled={o.angles?.[i] === undefined} onClick={() => setAngle(i, undefined)}>
              自動 ({autoAngles[i].toFixed(2)}°)
            </button>
          </div>
        ))}
      </fieldset>

      <div className="compare">
        <section>
          <h3>処理前</h3>
          <SourceView
            url={page.sourceUrl}
            width={page.sourceSize.width}
            height={page.sourceSize.height}
            split={r.split && !r.bypass}
            splitX={r.splitX}
            angles={r.bypass ? [0] : r.angles}
            onSplitX={(x) => onOverrides((p) => ({ ...p, splitX: x }))}
          />
          <p className="hint">緑のガイド線が五線と平行なら傾き補正は正しく効いています。</p>
        </section>
        <section>
          <h3>処理後{stale && <span className="badge">更新中…</span>}</h3>
          <div className="sheets">
            {page.previewUrls?.map((u, i) => <img key={u} src={u} alt={`処理後 ${i + 1}`} className="sheet" />) ?? <div className="sheet placeholder" />}
          </div>
        </section>
      </div>
    </div>
  )
}
