import type { GlobalSettings, WhitenMode } from '../pipeline/types.ts'
import { Segmented, Switch } from './ui.tsx'

interface Props {
  settings: GlobalSettings
  onChange: (s: GlobalSettings) => void
  exportDpi: number
  onExportDpi: (dpi: number) => void
}

/** Settings shared by every page, plus the export resolution. */
export function SettingsPanel({ settings: s, onChange, exportDpi, onExportDpi }: Props) {
  const set = <K extends keyof GlobalSettings>(k: K, v: GlobalSettings[K]) => onChange({ ...s, [k]: v })
  return (
    <section className="panel">
      <h2 className="panel-title">
        全ページ共通 <span className="panel-scope">すべてのページに適用</span>
      </h2>

      <div className="group">
        <Switch checked={s.whiten.enabled} onChange={(v) => set('whiten', { ...s.whiten, enabled: v })}>
          背景の白飛ばし
        </Switch>
        {s.whiten.enabled && (
          <div className="group-body">
            <Segmented<WhitenMode>
              label="白飛ばしの方式"
              value={s.whiten.mode}
              onChange={(v) => set('whiten', { ...s.whiten, mode: v })}
              options={[
                { value: 'levels', label: '階調を保持' },
                { value: 'adaptive', label: '白黒' },
              ]}
            />
            <label className="field">
              <span>強度</span>
              <input
                type="range"
                min={0}
                max={100}
                value={s.whiten.strength}
                onChange={(e) => set('whiten', { ...s.whiten, strength: Number(e.target.value) })}
              />
              <output>{s.whiten.strength}</output>
            </label>
            {s.whiten.mode === 'levels' && (
              <Switch checked={s.whiten.sharpen} onChange={(v) => set('whiten', { ...s.whiten, sharpen: v })} title="解像度の低いスキャンを拡大したときのぼやけを抑えます">
                輪郭をくっきり
              </Switch>
            )}
          </div>
        )}
      </div>

      <div className="group">
        <Switch checked={s.trim} onChange={(v) => set('trim', v)}>
          余白トリミング
        </Switch>
        <div className="group-body">
          <label className="field">
            <span>余白</span>
            <input type="number" min={0} max={40} step={1} value={s.marginMm} onChange={(e) => set('marginMm', Math.max(0, Math.min(40, Number(e.target.value))))} />
            <span className="unit">mm</span>
          </label>
          <Segmented<GlobalSettings['vAlign']>
            label="縦位置"
            value={s.vAlign}
            onChange={(v) => set('vAlign', v)}
            options={[
              { value: 'top', label: '上揃え' },
              { value: 'center', label: '上下中央' },
            ]}
          />
        </div>
      </div>

      <div className="group">
        <span className="group-label">書き出し画質</span>
        <Segmented<number>
          label="書き出し解像度"
          value={exportDpi}
          onChange={onExportDpi}
          options={[
            { value: 600, label: '高画質' },
            { value: 400, label: '標準' },
            { value: 300, label: '軽量' },
          ]}
        />
        <p className="hint">{exportDpi}dpi で書き出します</p>
      </div>
    </section>
  )
}
