import type { GlobalSettings, WhitenMode } from '../pipeline/types.ts'

interface Props {
  settings: GlobalSettings
  onChange: (s: GlobalSettings) => void
  exportDpi: number
  onExportDpi: (dpi: number) => void
}

export function SettingsBar({ settings: s, onChange, exportDpi, onExportDpi }: Props) {
  const set = <K extends keyof GlobalSettings>(k: K, v: GlobalSettings[K]) => onChange({ ...s, [k]: v })
  return (
    <div className="settings">
      <fieldset>
        <label className="toggle">
          <input type="checkbox" checked={s.whiten.enabled} onChange={(e) => set('whiten', { ...s.whiten, enabled: e.target.checked })} />
          背景の白飛ばし
        </label>
        <select
          value={s.whiten.mode}
          disabled={!s.whiten.enabled}
          onChange={(e) => set('whiten', { ...s.whiten, mode: e.target.value as WhitenMode })}
          aria-label="白飛ばしの方式"
        >
          <option value="levels">レベル補正(階調を保持)</option>
          <option value="adaptive">適応的二値化(白黒)</option>
        </select>
        <label>
          強度
          <input
            type="range"
            min={0}
            max={100}
            value={s.whiten.strength}
            disabled={!s.whiten.enabled}
            onChange={(e) => set('whiten', { ...s.whiten, strength: Number(e.target.value) })}
          />
          <output>{s.whiten.strength}</output>
        </label>
      </fieldset>
      <fieldset>
        <label className="toggle">
          <input type="checkbox" checked={s.trim} onChange={(e) => set('trim', e.target.checked)} />
          余白トリミング
        </label>
        <label>
          余白
          <input type="number" min={0} max={40} step={1} value={s.marginMm} onChange={(e) => set('marginMm', Math.max(0, Math.min(40, Number(e.target.value))))} />
          mm
        </label>
        <select value={s.vAlign} onChange={(e) => set('vAlign', e.target.value as GlobalSettings['vAlign'])} aria-label="縦位置">
          <option value="top">上揃え</option>
          <option value="center">上下中央</option>
        </select>
      </fieldset>
      <fieldset>
        <label>
          書き出し解像度
          <select value={exportDpi} onChange={(e) => onExportDpi(Number(e.target.value))}>
            <option value={600}>600dpi(高画質)</option>
            <option value={400}>400dpi</option>
            <option value={300}>300dpi(軽量)</option>
          </select>
        </label>
      </fieldset>
    </div>
  )
}
