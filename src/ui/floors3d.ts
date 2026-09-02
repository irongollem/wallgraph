// The 3D view's storey column: one button per floor, stacked in building
// order — ground floor at the bottom, like the building itself — toggling
// that storey in and out of the scene. Chrome of the 3D mode only: it shows
// while the view does, and the toggles are editor state on Tools, never the
// document.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { t } from "../i18n";

export class Floors3D {
  readonly el: HTMLElement;

  constructor(private store: Store, private tools: Tools) {
    this.el = el("div", "floors3d");
    this.el.hidden = true;
    this.refresh();
  }

  /** Rebuild the column against the current floors and toggle state. Hidden
   *  outside the 3D view, and for a single-storey plan, which has nothing to
   *  toggle. */
  refresh(): void {
    const floors = this.store.doc.floors;
    this.el.hidden = !this.tools.view3d || floors.length < 2;
    if (this.el.hidden) return;
    this.el.replaceChildren(...floors.slice().reverse().map(f => {
      const b = el("button", "floors3d-btn") as HTMLButtonElement;
      b.type = "button";
      const on = !this.tools.view3dHidden.has(f.id);
      b.setAttribute("aria-pressed", String(on));
      if (!on) b.classList.add("is-off");
      b.textContent = f.name;
      b.title = t("panel.floor3d", { name: f.name });
      b.onclick = () => { this.tools.toggleFloor3d(f.id); this.refresh(); };
      return b;
    }));
  }
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
