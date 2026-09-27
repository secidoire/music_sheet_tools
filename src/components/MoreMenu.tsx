import type { GlobalSettings } from '../pipeline/types.ts'
import { SettingsPanel } from './SettingsPanel.tsx'
import { Popover, Switch } from './ui.tsx'

interface Props {
  /** Undefined while no page is analysed. */
  bypass?: boolean
  onBypass: (v: boolean) => void
  /** Shown only when the page has manual changes. */
  onResetPage?: () => void
  settings: GlobalSettings
  onSettings: (s: GlobalSettings) => void
}

/** Everything that isn't needed on every page: skipping a page, and the settings shared by all pages. */
export function MoreMenu({ bypass, onBypass, onResetPage, settings, onSettings }: Props) {
  return (
    <Popover
      className="more-menu"
      button={({ open, toggle }) => (
        <button type="button" className="tool" aria-haspopup="dialog" aria-expanded={open} aria-label="その他の設定" title="その他の設定" onClick={toggle}>
          …
        </button>
      )}
    >
      {() => (
        <div role="dialog" aria-label="その他の設定">
          <section className="section">
            <h2>このページのみ</h2>
            <div className="item">
              <Switch checked={!!bypass} onChange={onBypass} title="このページは補正せず、元の画像のままA4に配置します">
                補正しない（元のまま）
              </Switch>
            </div>
            {onResetPage && (
              <div className="item">
                <button type="button" onClick={onResetPage}>
                  このページの調整をすべてリセット
                </button>
              </div>
            )}
          </section>
          <SettingsPanel settings={settings} onChange={onSettings} />
        </div>
      )}
    </Popover>
  )
}
