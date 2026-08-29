// Which grid spacing is actually drawable at the current zoom.
//
// The document grid can be finer than the screen can show: 50 mm at the default
// zoom is ~4 px, far too dense to draw. The rule here is that the lines we do
// draw are always a whole multiple of gridMm, so one square on screen is always
// a whole number of grid cells. Drawing a spacing unrelated to the setting (a
// hardcoded 1 m, say) makes the canvas silently disagree with the panel.

import { GRID_DEFAULT_MM } from "../model/doc";

/** Minimum on-screen spacing, in CSS px, before lines step up a level. */
export const MIN_GRID_PX = 6;

/** Multipliers applied to gridMm, extended by powers of ten: 2, 5, 10, 20, 50, … */
const LADDER = [2, 5, 10];

export interface GridSteps {
  /** Fine line spacing in mm — always a whole multiple of gridMm. */
  minor: number;
  /** Emphasised line spacing in mm — always a whole multiple of minor. */
  major: number;
  /** True when the zoom forced minor coarser than the document grid. */
  stepped: boolean;
}

/** Line spacings to draw for a document grid of `gridMm` at `pxPerMm` zoom. */
export function gridSteps(gridMm: number, pxPerMm: number, minPx = MIN_GRID_PX): GridSteps {
  const g = isFinite(gridMm) ? Math.max(1, Math.round(gridMm)) : GRID_DEFAULT_MM;
  let minor = g;
  if (pxPerMm > 0 && isFinite(pxPerMm)) {
    // Bounded: 24 rungs covers the whole zoom range many times over.
    for (let i = 0; i < 24 && minor * pxPerMm < minPx; i++) {
      minor = g * LADDER[i % LADDER.length]! * 10 ** Math.floor(i / LADDER.length);
    }
  }
  // Emphasise roughly every metre, rounded up to a whole number of minor cells
  // so major lines stay on the grid. At least every 2 cells.
  const cells = minor >= 1000 ? 5 : Math.ceil(1000 / minor);
  return { minor, major: minor * cells, stepped: minor !== g };
}
