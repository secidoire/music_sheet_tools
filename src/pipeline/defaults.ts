import type { GlobalSettings } from './types.ts'

export const DEFAULT_SETTINGS: GlobalSettings = {
  whiten: { enabled: true, mode: 'levels', strength: 50 },
  trim: true,
  marginMm: 10,
  vAlign: 'top',
  // Pages are normalised to a 1.6mm staff spacing (NOMINAL_STAFF_SPACING_MM), so this caps
  // the printed spacing at 2.0mm: short pages keep the staff size of full ones.
  maxUpscale: 1.25,
}
