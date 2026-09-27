import type { GlobalSettings, WhitenMode } from '../pipeline/types.ts'
import { Segmented, Switch } from './ui.tsx'

interface Props {
  settings: GlobalSettings
  onChange: (s: GlobalSettings) => void
}

/** Settings shared by every page. */
export function SettingsPanel({ settings: s, onChange }: Props) {
  const set = <K extends keyof GlobalSettings>(k: K, v: GlobalSettings[K]) => onChange({ ...s, [k]: v })
  return (
    <section className="section">
      <h2>すべてのページ</h2>

      <div className="item">
        <Switch checked={s.whiten.enabled} onChange={(v) => set('whiten', { ...s.whiten, enabled: v })}>
          背景を白くする
        </Switch>
        {s.whiten.enabled && (
          <>
            <Segmented<WhitenMode>
              label="背景の処理方法"
              value={s.whiten.mode}
              onChange={(v) => set('whiten', { ...s.whiten, mode: v })}
              options={[
                { value: 'levels', label: 'グレー' },
                { value: 'adaptive', label: '白黒' },
              ]}
            />
            <label className="field">
              <span>強さ</span>
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
                輪郭強調
              </Switch>
            )}
          </>
        )}
      </div>

      <div className="item">
        <Switch checked={s.trim} onChange={(v) => set('trim', v)}>
          余白の自動トリミング
        </Switch>
        <label className="field">
          <span>余白</span>
          <input type="number" min={0} max={40} step={1} value={s.marginMm} onChange={(e) => set('marginMm', Math.max(0, Math.min(40, Number(e.target.value))))} />
          <span className="unit">mm</span>
        </label>
        <Segmented<GlobalSettings['vAlign']>
          label="縦の配置"
          value={s.vAlign}
          onChange={(v) => set('vAlign', v)}
          options={[
            { value: 'top', label: '上寄せ' },
            { value: 'center', label: '中央' },
          ]}
        />
      </div>

    </section>
  )
}
