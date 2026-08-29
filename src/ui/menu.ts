// Small popover menu used by the sidebar header's dots button: document
// actions plus the language picker. One menu at a time; everything it wires
// up on open (listeners, DOM) is torn down on close.

import { icon, type IconName } from "./icons";

export type MenuEntry =
  | { kind: "item"; icon: IconName; label: string; hint?: string; onPick(): void }
  | { kind: "sep" }
  | { kind: "select"; label: string; value: string; options: Array<[string, string]>; onPick(value: string): void };

/** Opens a menu anchored under `anchor`, right-aligned to it. Closes itself. */
export function openMenu(anchor: HTMLElement, entries: MenuEntry[]): void {
  document.querySelector(".menu-backdrop")?.remove();
  document.querySelector(".menu")?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";

  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");

  for (const entry of entries) {
    if (entry.kind === "sep") {
      menu.appendChild(document.createElement("hr")).className = "menu-sep";
      continue;
    }
    if (entry.kind === "item") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu-item";
      btn.setAttribute("role", "menuitem");
      btn.appendChild(icon(entry.icon, 20));
      const label = document.createElement("span");
      label.textContent = entry.label;
      btn.appendChild(label);
      if (entry.hint !== undefined) {
        const hint = document.createElement("span");
        hint.className = "menu-hint";
        hint.textContent = entry.hint;
        btn.appendChild(hint);
      }
      btn.addEventListener("click", () => {
        entry.onPick();
        close();
      });
      menu.appendChild(btn);
      continue;
    }
    // entry.kind === "select"
    const row = document.createElement("div");
    row.className = "menu-row";
    const label = document.createElement("span");
    label.textContent = entry.label;
    row.appendChild(label);
    const select = document.createElement("select");
    for (const [value, text] of entry.options) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = text;
      if (value === entry.value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      entry.onPick(select.value);
      close();
    });
    row.appendChild(select);
    menu.appendChild(row);
  }

  document.body.appendChild(backdrop);
  document.body.appendChild(menu);
  position();

  anchor.setAttribute("aria-expanded", "true");

  function position(): void {
    const rect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const margin = 8;

    let top = rect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - margin) {
      top = rect.top - 6 - menuRect.height;
    }
    top = Math.min(Math.max(top, margin), window.innerHeight - margin - menuRect.height);

    let left = rect.right - menuRect.width;
    left = Math.min(Math.max(left, margin), window.innerWidth - margin - menuRect.width);

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }

  function items(): HTMLButtonElement[] {
    return Array.from(menu.querySelectorAll(".menu-item"));
  }

  function focusIndex(index: number, list: HTMLButtonElement[]): void {
    const n = list.length;
    if (n === 0) return;
    const wrapped = ((index % n) + n) % n;
    list[wrapped]!.focus();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const list = items();
    const currentIndex = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusIndex(currentIndex + 1, list);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusIndex(currentIndex - 1, list);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusIndex(0, list);
    } else if (e.key === "End") {
      e.preventDefault();
      focusIndex(list.length - 1, list);
    }
  }

  function onBackdropClick(): void {
    close();
  }

  function onWindowChange(): void {
    close();
  }

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    backdrop.removeEventListener("click", onBackdropClick);
    menu.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onWindowChange);
    window.removeEventListener("scroll", onWindowChange, true);
    backdrop.remove();
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    anchor.focus();
  }

  backdrop.addEventListener("click", onBackdropClick);
  menu.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onWindowChange);
  window.addEventListener("scroll", onWindowChange, true);

  const first = items()[0];
  first?.focus();
}
