import type { PageOverrides } from '../pipeline/types.ts'
import type { PageState } from '../lib/useProject.ts'

interface Props {
  pages: PageState[]
  selected: number
  onSelect: (i: number) => void
}

export function PageList({ pages, selected, onSelect }: Props) {
  return (
    <ol className="page-list" aria-label="ページ一覧">
      {pages.map((p, i) => {
        const o = p.overrides
        const edited = hasOverrides(o) || (p.analysis !== undefined && p.analysis.rotation !== p.analysis.autoRotation)
        const note = p.error ? 'エラー' : o.bypass ? '補正なし' : edited ? '調整済み' : null
        return (
          <li key={p.key}>
            <button type="button" className={i === selected ? 'selected' : ''} onClick={() => onSelect(i)} aria-current={i === selected}>
              <div className="thumbs">
                {p.previewUrls ? (
                  p.previewUrls.map((u) => <img key={u} src={u} alt="" />)
                ) : p.sourceUrl ? (
                  <img src={p.sourceUrl} alt="" className="dim" />
                ) : (
                  <div className="thumb-placeholder" />
                )}
              </div>
              <span className="meta">
                {p.pageNo}
                {note && <span className={p.error ? 'note error' : 'note'}>{note}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** Overrides keep cleared fields as `undefined` (and cleared angles as holes), so count only set values. */
function hasOverrides(o: PageOverrides): boolean {
  return Object.values(o).some((v) => (Array.isArray(v) ? v.some((x) => x !== undefined) : v !== undefined))
}
