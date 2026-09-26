import type { PageState } from '../lib/useProject.ts'

interface Props {
  pages: PageState[]
  selected: number
  onSelect: (i: number) => void
}

export function PageList({ pages, selected, onSelect }: Props) {
  return (
    <ol className="page-list">
      {pages.map((p, i) => {
        const o = p.overrides
        const edited = Object.keys(o).length > 0 || (p.analysis !== undefined && p.analysis.rotation !== p.analysis.autoRotation)
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
              <div className="meta">
                <span>p.{p.pageNo}</span>
                {p.analysis?.isSpread && <span className="tag">見開き</span>}
                {o.bypass && <span className="tag warn">補正なし</span>}
                {edited && !o.bypass && <span className="tag">手動</span>}
                {p.error && <span className="tag warn">エラー</span>}
              </div>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
