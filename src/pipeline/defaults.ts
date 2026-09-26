import type { GlobalSettings } from './types.ts'

export const DEFAULT_SETTINGS: GlobalSettings = {
  whiten: { enabled: true, mode: 'levels', strength: 50 },
  trim: true,
  marginMm: 10,
  vAlign: 'top',
  maxUpscale: 1.15,
}
