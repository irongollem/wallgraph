// The bottom sheet: where the property pane and the palette live on a phone.
//
// Three detents rather than free height, so the sheet always comes to rest
// somewhere the layout was designed for, and so a flick lands predictably. The
// handle drags, and a tap on it cycles — a sheet that could only be dragged
// would be invisible to anyone who never tried.

export type Detent = "peek" | "half" | "full";

/**
 * Fraction of the available height each detent occupies, tool bar included.
 * `peek` is sized to a section heading plus one property row; `full` stops
 * short of the top so the plan never disappears entirely.
 */
export const DETENTS: Record<Detent, number> = { peek: 0.3, half: 0.58, full: 0.88 };

const ORDER: Detent[] = ["peek", "half", "full"];

/** The detent a drag comes to rest on: whichever one it ended nearest. */
export function nearestDetent(fraction: number): Detent {
  let best: Detent = "peek";
  let bestGap = Infinity;
  for (const d of ORDER) {
    const gap = Math.abs(DETENTS[d] - fraction);
    if (gap < bestGap) { bestGap = gap; best = d; }
  }
  return best;
}

/** The next detent a tap on the handle moves to; wraps back to `peek`. */
export function nextDetent(current: Detent): Detent {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]!;
}

/** Pointer travel before a press on the handle counts as a drag, not a tap. */
const DRAG_SLOP_PX = 4;

export class Sheet {
  readonly el: HTMLElement;
  /** Scrolls; everything the sheet shows goes in here. */
  readonly body: HTMLElement;
  /** Pinned under the body, out of the scroll: the tool bar. */
  readonly foot: HTMLElement;

  private handle: HTMLElement;
  private detent: Detent = "peek";
  /** Set while the handle is being dragged, so height is not re-snapped. */
  private dragging = false;

  constructor(handleLabel: string) {
    this.el = el("div", "wg-sheet");
    this.handle = el("div", "wg-grab");
    this.handle.setAttribute("role", "separator");
    this.handle.setAttribute("aria-label", handleLabel);
    this.handle.tabIndex = 0;
    this.handle.append(el("i"));
    this.body = el("div", "wg-sheet-body");
    this.foot = el("div", "wg-sheet-foot");
    this.el.append(this.handle, this.body, this.foot);
    this.wireHandle();
    this.apply();
  }

  get current(): Detent { return this.detent; }

  /** Move to `d`. Ignored mid-drag, which would fight the finger. */
  setDetent(d: Detent): void {
    if (this.dragging || d === this.detent) return;
    this.detent = d;
    this.apply();
  }

  /** Raise the sheet to at least `d` — the keypad needs room it may not have. */
  atLeast(d: Detent): void {
    if (DETENTS[this.detent] < DETENTS[d]) this.setDetent(d);
  }

  private apply(): void {
    this.el.style.height = `${(DETENTS[this.detent] * 100).toFixed(2)}%`;
    this.el.dataset.detent = this.detent;
  }

  private wireHandle(): void {
    let startY = 0;
    let startFraction = 0;
    let moved = false;

    const available = (): number => this.el.parentElement?.getBoundingClientRect().height ?? window.innerHeight;

    this.handle.addEventListener("pointerdown", e => {
      startY = e.clientY;
      startFraction = DETENTS[this.detent];
      moved = false;
      this.dragging = true;
      this.el.classList.add("is-dragging");
      this.handle.setPointerCapture(e.pointerId);
    });

    this.handle.addEventListener("pointermove", e => {
      if (!this.dragging) return;
      if (!moved && Math.abs(e.clientY - startY) < DRAG_SLOP_PX) return;
      moved = true;
      // Up is a taller sheet, so the sign is inverted against screen y.
      const f = startFraction + (startY - e.clientY) / available();
      const clamped = Math.max(DETENTS.peek * 0.6, Math.min(DETENTS.full, f));
      this.el.style.height = `${(clamped * 100).toFixed(2)}%`;
      e.preventDefault();
    });

    const end = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      this.el.classList.remove("is-dragging");
      const f = moved ? this.el.getBoundingClientRect().height / available() : DETENTS[this.detent];
      this.detent = moved ? nearestDetent(f) : nextDetent(this.detent);
      this.apply();
      try { this.handle.releasePointerCapture(e.pointerId); } catch { /* never captured */ }
    };
    this.handle.addEventListener("pointerup", end);
    this.handle.addEventListener("pointercancel", end);

    // Keyboard equivalent: the handle is focusable, so it has to be operable.
    this.handle.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.setDetent(nextDetent(this.detent)); }
      if (e.key === "ArrowUp") { e.preventDefault(); this.setDetent(this.detent === "peek" ? "half" : "full"); }
      if (e.key === "ArrowDown") { e.preventDefault(); this.setDetent(this.detent === "full" ? "half" : "peek"); }
    });
  }
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
