// The zoom pane: the rooms of this storey, framed and named.
//
// A plan is read by going out to the whole thing and then back in to the part
// being worked on, over and over. Wheel-zoom does the second half badly — it
// takes several gestures and lands somewhere approximate — so the rooms are
// listed and each one frames itself exactly.
//
// The same list is where a room gets its name, because it is already the list
// of rooms: the row states what the plan says about a space ("23,4 m²") and the
// pencil beside it turns that row into the field that says what it is called.
// Nothing here is stored. The list follows the wall graph, so a room that gets
// divided in two appears as two rows with no bookkeeping.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { Room, roomKey } from "../core/rooms";
import { ROOM_NAMES } from "../model/room";
import { areaModeOf } from "../model/doc";
import { icon } from "./icons";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/**
 * Which row is open for editing, and how to open another. The panel owns the
 * key so it survives the rebuild that opening a row causes, and so a click on a
 * room's label on the canvas can reach the same row.
 */
export interface RoomEdit {
  /** `roomKey()` of the room whose name field is open, or null. */
  key: string | null;
  /** Open a row's field, or close it with null, and rebuild the pane. */
  open(key: string | null): void;
  /** Close without rebuilding, when the caller is about to cause one anyway. */
  clear(): void;
}

/**
 * The preset names, as completions rather than a closed list. One id for the
 * whole page: a second editor mounted beside this one would offer the same
 * twenty words, so sharing it costs nothing.
 */
const NAMES_LIST_ID = "wg-room-names";

export function renderZoomTool(
  host: HTMLElement, store: Store, tools: Tools, rows: PaneRows, rooms: Room[],
  edit: RoomEdit,
): void {
  rows.secHead(t("panel.zoom"));
  // The shortcut rides beside the label and in the title, never in the label
  // itself: on a phone there is no F to press, and the button has to read the
  // same either way. CSS drops the badge where there is no keyboard.
  rows.btnRow(t("panel.zoomAll"), () => tools.fitAll(), t("panel.zoomAllTitle"), "F");
  rows.btnRow(t("panel.zoomSelection"), () => tools.fitSelection(), t("panel.zoomSelectionTitle"), "Shift+F");

  if (rooms.length > 0) {
    rows.secHead(t("panel.zoomZones"), { later: true });
    const net = areaModeOf(store.doc) === "net";
    const list = el("div", "zone-list");
    // Plan order, top-left first, rather than named-first-then-by-size: this is
    // now the list a plan is named from, and a row that jumps to the top the
    // moment it is given a name loses the reader's place in the walk-through.
    const sorted = [...rooms].sort((a, b) =>
      a.centroid.y - b.centroid.y || a.centroid.x - b.centroid.x);
    for (const r of sorted) {
      const area = ((net ? r.netAreaMm2 : r.areaMm2) / 1e6).toFixed(1) + " m²";
      list.append(edit.key === roomKey(r)
        ? nameRow(tools, edit, r, area)
        : zoneRow(tools, edit, r, area));
    }
    list.append(nameOptions());
    host.append(list);
  }
  rows.noteRow(t("panel.zoomNote"));
}

/** A room at rest: press it to frame it, press the pencil to name it. */
function zoneRow(tools: Tools, edit: RoomEdit, r: Room, area: string): HTMLElement {
  const row = el("div", "zone-row");
  const b = el("button", "zone") as HTMLButtonElement;
  b.type = "button";
  b.append(
    Object.assign(el("span", "zone-name" + (r.name === undefined ? " is-unnamed" : "")),
      { textContent: r.name ?? t("panel.zoomUnnamed") }),
    Object.assign(el("span", "zone-area"), { textContent: area }),
  );
  b.onclick = () => tools.fitRoom(r);

  const pen = el("button", "zone-edit") as HTMLButtonElement;
  pen.type = "button";
  pen.title = t("panel.roomRename");
  pen.setAttribute("aria-label", t("panel.roomRename"));
  pen.append(icon("rename", 15));
  pen.onclick = () => edit.open(roomKey(r));

  row.append(b, pen);
  return row;
}

/**
 * The same room with its field open. Enter and losing focus both write the
 * name; Escape leaves it as it was. An empty field clears the name, which is
 * how a name is taken back off a room now that there is nothing to select and
 * delete.
 */
function nameRow(tools: Tools, edit: RoomEdit, r: Room, area: string): HTMLElement {
  const row = el("div", "zone-row is-editing");
  const input = el("input", "zone-input") as HTMLInputElement;
  input.type = "text";
  input.value = r.name ?? "";
  input.placeholder = t("panel.zoomUnnamed");
  input.setAttribute("aria-label", t("panel.roomName"));
  input.setAttribute("list", NAMES_LIST_ID);

  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    const value = input.value;
    // The pane rebuilt under this field — a store change elsewhere, a storey
    // switch — and the blur is that removal, not the user leaving. Committing
    // here would re-enter the render that just removed it.
    if (!input.isConnected) return;
    edit.clear();
    // Exactly one rebuild either way: the mutation causes one through the
    // store, and a cancelled edit asks for one itself.
    if (save && value.trim() !== (r.name ?? "")) tools.renameRoom(r, value);
    else tools.refresh();
  };
  input.onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);

  row.append(input, Object.assign(el("span", "zone-area"), { textContent: area }));
  // A microtask, not a direct call: the row is still detached at this point and
  // only reaches the document when renderZoomTool appends the list.
  queueMicrotask(() => { input.focus(); input.select(); input.scrollIntoView({ block: "nearest" }); });
  return row;
}

/** The dozen names nearly every plan uses, offered as completions. */
function nameOptions(): HTMLElement {
  const dl = el("datalist");
  dl.id = NAMES_LIST_ID;
  for (const id of ROOM_NAMES) {
    dl.append(Object.assign(el("option") as HTMLOptionElement, { value: t("room." + id) }));
  }
  return dl;
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
