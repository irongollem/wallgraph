// Drag-scrub for number inputs, the way Blender's fields work: press and drag
// sideways to change the value, with every step committed live so the drawing
// moves under your cursor. A press that never travels falls through untouched,
// so the field still focuses and accepts typing -- which stays the precise way
// in, since this is a mm-exact editor and a drag is for feeling out a value.

/** Pixels of travel before a press becomes a drag rather than a click. */
const DRAG_SLOP = 3;

export interface ScrubOptions {
  /** Document step for this field; one slow pixel moves half of it. */
  step: number;
  /** Live, on every move. Commit here -- that is the point of the gesture. */
  onInput(value: number): void;
  onStart?(): void;
  onEnd?(): void;
}

export function scrubbable(input: HTMLInputElement, opts: ScrubOptions): void {
  let startX = 0;
  let startValue = 0;
  let lastX = 0;
  let acc = 0;
  let dragging = false;
  let armed = false;

  const apply = (): void => {
    const next = startValue + Math.round(acc) * opts.step;
    input.value = String(next);
    opts.onInput(next);
  };

  const stop = (commit: boolean): void => {
    if (!commit) {
      acc = 0;
      apply();
    }
    if (dragging) opts.onEnd?.();
    dragging = false;
    armed = false;
    input.classList.remove("is-scrubbing");
    try { input.releasePointerCapture(lastPointerId); } catch { /* never captured */ }
  };

  let lastPointerId = -1;

  input.addEventListener("pointerdown", e => {
    if (e.button !== 0 || document.activeElement === input) return;
    const v = parseFloat(input.value);
    if (!isFinite(v)) return;
    armed = true;
    startX = lastX = e.clientX;
    startValue = v;
    acc = 0;
    lastPointerId = e.pointerId;
  });

  input.addEventListener("pointermove", e => {
    if (!armed) return;
    if (!dragging) {
      if (Math.abs(e.clientX - startX) < DRAG_SLOP) return;
      dragging = true;
      input.classList.add("is-scrubbing");
      // Blur first: a focused field would show a caret and swallow the drag.
      input.blur();
      try { input.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      opts.onStart?.();
    }
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    // Speed-sensitive, so a flick covers ground while a slow drag stays fine.
    // Shift is the explicit fine gear on top of that.
    const boost = Math.min(5, 1 + Math.abs(dx) / 10);
    acc += dx * boost * (e.shiftKey ? 0.2 : 1) * 0.5;
    apply();
    e.preventDefault();
  });

  input.addEventListener("pointerup", e => {
    if (dragging) e.preventDefault(); // do not focus the field the drag just used
    stop(true);
  });

  input.addEventListener("pointercancel", () => stop(true));

  input.addEventListener("keydown", e => {
    if (dragging && e.key === "Escape") stop(false);
  });
}
