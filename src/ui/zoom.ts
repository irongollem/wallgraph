// The zoom pane: the zones a view can jump to.
//
// A plan is read by going out to the whole thing and then back in to the part
// being worked on, over and over. Wheel-zoom does the second half badly — it
// takes several gestures and lands somewhere approximate — so the zones are
// listed and each one frames itself exactly.
//
// The zones are the detected rooms, which is why room naming and zooming landed
// together: an unnamed room is "23,4 m²" in a list of five, and a named one is
// "Keuken". Nothing here is stored. The list follows the wall graph, so a room
// that gets divided in two appears as two zones with no bookkeeping.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { Room } from "../core/rooms";
import { areaModeOf } from "../model/doc";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

export function renderZoomTool(
  host: HTMLElement, store: Store, tools: Tools, rows: PaneRows, rooms: Room[],
): void {
  rows.secHead(t("panel.zoom"));
  rows.btnRow(t("panel.zoomAll"), () => tools.fitAll());
  rows.btnRow(t("panel.zoomSelection"), () => tools.fitSelection());

  if (rooms.length > 0) {
    rows.secHead(t("panel.zoomZones"), { later: true });
    const net = areaModeOf(store.doc) === "net";
    const list = el("div", "zone-list");
    // Named rooms first, then the rest by size: a name is what someone is
    // looking for, and among the unnamed the big ones are the ones meant.
    const sorted = [...rooms].sort((a, b) => {
      if ((a.name === undefined) !== (b.name === undefined)) return a.name === undefined ? 1 : -1;
      if (a.name !== undefined && b.name !== undefined) return a.name.localeCompare(b.name);
      return b.areaMm2 - a.areaMm2;
    });
    for (const r of sorted) {
      const area = ((net ? r.netAreaMm2 : r.areaMm2) / 1e6).toFixed(1) + " m²";
      const b = el("button", "zone") as HTMLButtonElement;
      b.type = "button";
      b.append(
        Object.assign(el("span", "zone-name"), { textContent: r.name ?? t("panel.zoomUnnamed") }),
        Object.assign(el("span", "zone-area"), { textContent: area }),
      );
      b.onclick = () => tools.fitRoom(r);
      list.append(b);
    }
    host.append(list);
  }
  rows.noteRow(t("panel.zoomNote"));
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
