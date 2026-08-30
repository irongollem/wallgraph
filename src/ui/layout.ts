// Which shell the editor wears.
//
// The sidebar layout needs its 292 px beside a canvas still worth drawing on.
// Below that the chrome has to come off the side and sit over the plan: a top
// bar, a bottom sheet and a tool bar, with the canvas full-bleed underneath.
// One breakpoint, read in one place, so the panel and the host cannot disagree
// about which one is up.

export type LayoutMode = "wide" | "compact";

/** At or below this width the sidebar leaves too little canvas to draw in. */
export const COMPACT_MAX_PX = 767;
/**
 * At or below this height the sidebar cannot stack what it holds: eight tools,
 * three modes and undo/redo alone need more than 500 px of rail, and a phone in
 * landscape — which is the posture a wide plan is actually drawn in — has 390.
 */
export const SHORT_MAX_PX = 500;

/** The media query the stylesheet must agree with, in one place. */
export const COMPACT_QUERY = `(max-width: ${COMPACT_MAX_PX}px), (max-height: ${SHORT_MAX_PX}px)`;

export function layoutFor(widthPx: number, heightPx: number): LayoutMode {
  return widthPx <= COMPACT_MAX_PX || heightPx <= SHORT_MAX_PX ? "compact" : "wide";
}

/**
 * Calls `onChange` whenever the mode flips, and returns the mode now.
 *
 * `matchMedia` rather than a resize listener: the query fires once on the
 * crossing rather than on every intermediate pixel, so nothing rebuilds the
 * panel sixty times during a window drag.
 */
export function watchLayout(onChange: (mode: LayoutMode) => void): LayoutMode {
  if (typeof matchMedia !== "function") return "wide";
  const mq = matchMedia(COMPACT_QUERY);
  const read = (): LayoutMode => (mq.matches ? "compact" : "wide");
  mq.addEventListener("change", () => onChange(read()));
  return read();
}

/**
 * True when the primary input has no fine pointer — a phone or a tablet.
 *
 * Separate from the layout mode on purpose: a narrow desktop window is compact
 * but still has a mouse, and a large tablet is wide but still has fingers. The
 * layout decides where the chrome goes; this decides how big it has to be and
 * whether the hints talk about clicks or taps.
 */
export function isTouchPrimary(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(pointer: coarse)").matches;
}
