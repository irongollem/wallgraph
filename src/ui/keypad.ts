// The millimetre keypad.
//
// Typing a length is how this editor is precise: on a keyboard you type digits
// while drawing and the wall lands on the millimetre. A phone has no keyboard
// over a canvas, so the digits get a pad of their own, wired to the same
// Tools methods the keydown handler calls.
//
// There is no decimal key. The document stores integer millimetres (see
// invariant 1), so a decimal point could only ever be rounded away.

import { Tools } from "../input/tools";
import { t } from "../i18n";
import { icon } from "./icons";

/** Grid position for the two keys that are not a plain 1x1 cell. */
const PLACE_AREA = "2 / 4 / 5 / 5";
const ZERO_AREA = "4 / 1 / 5 / 3";

export function buildKeypad(tools: Tools, onChange: () => void): HTMLElement {
  const pad = el("div", "keypad");

  const key = (label: string, cls: string, onPick: () => void, aria?: string): HTMLButtonElement => {
    const b = el("button", "key" + (cls ? " " + cls : "")) as HTMLButtonElement;
    b.type = "button";
    b.textContent = label;
    if (aria) b.setAttribute("aria-label", aria);
    b.onclick = () => { onPick(); onChange(); };
    return b;
  };

  const digit = (d: string): HTMLButtonElement => key(d, "", () => tools.typeLength(d));

  const back = key("", "key-alt", () => tools.backspaceLength(), t("panel.keypadBackspace"));
  back.append(icon("backspace", 22));

  const place = key("", "key-go", () => tools.commitLength());
  place.style.gridArea = PLACE_AREA;
  place.append(icon("confirm", 22), Object.assign(el("span"), { textContent: t("panel.keypadPlace") }));

  const zero = digit("0");
  zero.style.gridArea = ZERO_AREA;

  pad.append(
    digit("1"), digit("2"), digit("3"), back, place,
    digit("4"), digit("5"), digit("6"),
    digit("7"), digit("8"), digit("9"),
    zero, key("C", "key-alt", () => tools.clearLength(), t("panel.keypadClear")),
  );
  return pad;
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
