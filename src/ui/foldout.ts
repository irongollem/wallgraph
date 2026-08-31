// The collapsible group the pickers are built from: a heading that counts what
// it holds, and a body that opens with a height transition.
//
// The stylesheet animates .pal-body's grid-template-rows (0fr -> 1fr), so a
// toggle may only flip classes and aria state on existing nodes -- never inline
// styles, never a DOM rebuild, or the transition dies. Shared by the symbol
// palette and the fit-out picker so the two read as one control.
import { icon } from "./icons";

const FOLD_FALLBACK_MS = 240;

export interface FoldOut {
  head: HTMLButtonElement;
  body: HTMLElement;
}

export function foldOut(
  opts: {
    id: string;
    label: string;
    count: number;
    open: boolean;
    content: HTMLElement;
    onToggle: (open: boolean) => void;
  },
): FoldOut {
  const head = document.createElement("button");
  head.type = "button";
  head.className = "pal-cat";
  head.setAttribute("aria-expanded", String(opts.open));
  head.setAttribute("aria-controls", opts.id);
  const chev = document.createElement("span");
  chev.className = "chev";
  chev.append(icon("chevron", 14));
  const name = document.createElement("span");
  name.textContent = opts.label;
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(opts.count);
  head.append(chev, name, count);

  const body = document.createElement("div");
  body.className = "pal-body";
  body.id = opts.id;
  if (opts.open) body.classList.add("is-open");
  body.append(opts.content);

  // A group near the bottom of the scroll area shouldn't stay hidden under the
  // fold once it opens -- but we can only scroll to it after the height
  // transition finishes (or a reduced-motion setup skips it, hence the timeout
  // fallback). Fresh closures per open give each one its own "already ran"
  // guard, so it fires at most once regardless of which path wins.
  const openWithScroll = (): void => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      body.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
      head.scrollIntoView({ block: "nearest" });
    };
    const onEnd = (ev: TransitionEvent): void => {
      if (ev.propertyName === "grid-template-rows") finish();
    };
    body.addEventListener("transitionend", onEnd);
    const timer = setTimeout(finish, FOLD_FALLBACK_MS);
  };

  head.onclick = () => {
    const nowOpen = head.getAttribute("aria-expanded") !== "true";
    head.setAttribute("aria-expanded", String(nowOpen));
    body.classList.toggle("is-open", nowOpen);
    opts.onToggle(nowOpen);
    if (nowOpen) openWithScroll();
  };

  return { head, body };
}
