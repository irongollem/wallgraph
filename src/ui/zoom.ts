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
import { Room, roomKey, unattachedRoomNames, roomArea } from "../core/rooms";
import { ROOM_NAMES, ROOM_USES, type RoomName, type RoomUse } from "../model/room";
import { areaModeOf, roomNamesOf, floorHeight, storeyCeiling } from "../model/doc";
import { floorSurface, type RoomSurface } from "../core/surface";
import { sqm } from "./walls";
import { roomFigures, roomVentRouted, type RoomFigures, type RoomVentRouted } from "../core/fitout";
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

  const loose = unattachedRoomNames(store.floor, rooms);
  if (rooms.length > 0 || loose.length > 0) {
    rows.secHead(t("panel.zoomZones"), { later: true });
    const mode = areaModeOf(store.doc);
    // The wall face area behind each room's row, from the same takeoff the wall
    // pane states its storey total in -- one derivation, so a room's figure and
    // the storey's cannot disagree.
    const surface = new Map(
      floorSurface(store.floor, tools.resolvedFloor(), rooms).rooms.map(x => [x.key, x] as const));
    const list = el("div", "zone-list");
    // Plan order, top-left first, rather than named-first-then-by-size: this is
    // now the list a plan is named from, and a row that jumps to the top the
    // moment it is given a name loses the reader's place in the walk-through.
    const sorted = [...rooms].sort((a, b) =>
      a.centroid.y - b.centroid.y || a.centroid.x - b.centroid.x);
    for (const r of sorted) {
      const area = (roomArea(r, mode) / 1e6).toFixed(1) + " m²";
      list.append(edit.key === roomKey(r)
        ? nameRow(tools, edit, r, area, store)
        : roomItem(tools, edit, store, r, area, surface.get(roomKey(r))));
    }
    for (const rn of loose) {
      const key = "name:" + rn.id;
      list.append(edit.key === key
        ? looseNameRow(tools, edit, rn)
        : looseRow(tools, edit, rn, key));
    }
    list.append(nameOptions());
    host.append(list);
  }
  rows.noteRow(t("panel.zoomNote"));
}

/** A stored label outside every closed room; it still needs a route to edit it. */
function looseRow(tools: Tools, edit: RoomEdit, rn: RoomName, key: string): HTMLElement {
  const row = el("div", "zone-row");
  const label = el("button", "zone") as HTMLButtonElement;
  label.type = "button";
  label.append(
    Object.assign(el("span", "zone-name"), { textContent: rn.name }),
    Object.assign(el("span", "zone-area"), { textContent: t("panel.zoomUnattached") }),
  );
  label.onclick = () => tools.fitWorldBox(rn, rn);
  const pen = el("button", "zone-edit") as HTMLButtonElement;
  pen.type = "button";
  pen.title = t("panel.roomRename");
  pen.setAttribute("aria-label", t("panel.roomRename"));
  pen.append(icon("rename", 15));
  pen.onclick = () => edit.open(key);
  row.append(label, pen);
  return row;
}

/** Rename an unattached label, or delete it by leaving the field empty. */
function looseNameRow(tools: Tools, edit: RoomEdit, rn: RoomName): HTMLElement {
  const row = el("div", "zone-row is-editing");
  const input = el("input", "zone-input") as HTMLInputElement;
  input.type = "text";
  input.value = rn.name;
  input.setAttribute("aria-label", t("panel.roomName"));
  input.setAttribute("list", NAMES_LIST_ID);
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    if (!input.isConnected) return;
    edit.clear();
    if (save && input.value.trim() !== rn.name) tools.renameRoomName(rn.id, input.value);
    else tools.refresh();
  };
  input.onkeydown = e => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
  row.append(input, Object.assign(el("span", "zone-area"), { textContent: t("panel.zoomUnattached") }));
  queueMicrotask(() => { input.focus(); input.select(); input.scrollIntoView({ block: "nearest" }); });
  return row;
}

/**
 * A room at rest, with its figures underneath: the wall face area it takes to
 * finish, and -- for a verblijfsruimte -- its fit-out figures.
 *
 * The wall area is on every room because every room is painted; the fit-out
 * figures are only on the rooms the Bouwbesluit gives them to.
 */
function roomItem(
  tools: Tools, edit: RoomEdit, store: Store, r: Room, area: string, surface?: RoomSurface,
): HTMLElement {
  const item = el("div", "zone-item");
  item.append(zoneRow(tools, edit, r, area));
  const box = el("div", "zone-figures");
  if (surface && surface.finishMm2 > 0) {
    line(box, t("panel.roomWallSurface", { area: sqm(surface.netMm2) }));
    if (surface.revealsMm2 > 0) {
      line(box, t("panel.roomWallReveals", {
        area: sqm(surface.revealsMm2), total: sqm(surface.finishMm2),
      }));
    }
    if (surface.ceilingMm !== undefined) {
      line(box, t("panel.roomWallSurfaceCeiling", { mm: surface.ceilingMm }));
    }
  }
  const figures = roomFigures(store.floor, r, store.doc);
  if (figures) figuresBlock(box, figures, roomVentRouted(store.floor, r, store.doc));
  if (box.childElementCount > 0) item.append(box);
  return item;
}

/** One figure line in a room's figures box. */
function line(box: HTMLElement, text: string, warn = false): void {
  box.append(Object.assign(el("div", "zone-figure" + (warn ? " is-warn" : "")), { textContent: text }));
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
function nameRow(tools: Tools, edit: RoomEdit, r: Room, area: string, store: Store): HTMLElement {
  const wrap = el("div", "zone-item is-editing");
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
  input.onblur = e => {
    // The use and ceiling controls belong to this same editor. Let focus move
    // to them; rebuilding here would remove the control before its click or
    // keyboard interaction can complete.
    if (e.relatedTarget instanceof Node && wrap.contains(e.relatedTarget)) return;
    finish(true);
  };

  row.append(input, Object.assign(el("span", "zone-area"), { textContent: area }));
  wrap.append(row);
  // The use only has somewhere to live once the name has an id of its own —
  // a room about to be named for the first time has nothing to attach it to.
  if (r.nameId !== undefined) {
    const rn = roomNamesOf(store.floor).find(x => x.id === r.nameId);
    if (rn) wrap.append(useRow(tools, rn), ceilingRow(tools, store, rn));
  }
  // A microtask, not a direct call: the row is still detached at this point and
  // only reaches the document when renderZoomTool appends the list.
  queueMicrotask(() => { input.focus(); input.select(); input.scrollIntoView({ block: "nearest" }); });
  return wrap;
}

/** What the room is used for, offered beside the name while it is being edited. */
function useRow(tools: Tools, rn: RoomName): HTMLElement {
  const row = el("label", "prop-row zone-use");
  row.append(Object.assign(el("span"), { textContent: t("panel.roomUse") }));
  const sl = el("select") as HTMLSelectElement;
  const options: Array<[string, string]> = [
    ["", t("roomUse.none")],
    ...ROOM_USES.map(u => [u, t("roomUse." + u)] as [string, string]),
  ];
  for (const [val, lab] of options) {
    const o = el("option") as HTMLOptionElement;
    o.value = val; o.textContent = lab;
    if (val === (rn.use ?? "")) o.selected = true;
    sl.append(o);
  }
  sl.onchange = () => tools.setRoomUse(rn.id, sl.value === "" ? undefined : sl.value as RoomUse);
  row.append(sl);
  return row;
}

/**
 * Compact fit-out figures for a verblijfsruimte: one line each, the
 * workplaceNone flag in the warning colour the way a stair issue is. When any
 * vent route (issue #28) ends in the room, the routed supply/extract is
 * stated beside the indicative demand -- two figures side by side, both
 * explicitly indicative, with no compliance claim (the same stance as every
 * other figure here). A routed supply below the indicative demand gets a
 * neutral note, not a warning: this pairs the two figures, it does not check
 * one against the other.
 */
function figuresBlock(box: HTMLElement, figures: RoomFigures, routed: RoomVentRouted): void {
  const line = (text: string, warn = false): void => {
    box.append(Object.assign(el("div", "zone-figure" + (warn ? " is-warn" : "")), { textContent: text }));
  };
  line(t("fitout.workstations", { n: figures.workstations }));
  line(t("fitout.daylight", { pct: (figures.daylightRatio * 100).toFixed(1) }));
  line(t("fitout.ventilation", { m3h: Math.round(figures.ventilationM3h) }));
  const anyRouted = routed.toevoer > 0 || routed.afvoer > 0
    || routed.toevoerUnstated > 0 || routed.afvoerUnstated > 0;
  if (anyRouted) {
    line(t("fitout.ventRouted", { toevoer: Math.round(routed.toevoer), afvoer: Math.round(routed.afvoer) }));
    if (routed.toevoer < figures.ventilationM3h) line(t("fitout.ventRoutedBelow"));
    const unstated = routed.toevoerUnstated + routed.afvoerUnstated;
    if (unstated > 0) line(t("fitout.ventRoutedUnstated", { n: unstated }));
  }
  for (const issue of figures.issues) {
    line(t("fitoutIssue." + issue.code, { value: issue.value.toFixed(1), limit: issue.limit }), true);
  }
}

/**
 * This room's own finished ceiling height, beside the use. Empty means the
 * room follows the storey, which is what most rooms do; a figure here is for
 * the one room finished lower than the rest -- a badkamer under a verlaagd
 * plafond. It changes only the wall face area the row above reports.
 *
 * A single field rather than a set/unset pair: the row is already inside an
 * open name field, and an empty field showing what the storey answers says the
 * same thing a checkbox would in half the space.
 *
 * Typed, not scrubbed. Every other number field in the panel drags sideways to
 * feel out a value, which needs a value to start from; this one is ordinarily
 * empty, and a drag from nothing would commit a ceiling of one step. So it is a
 * text field with a numeric keypad, and the cursor does not promise a gesture
 * that is not there.
 */
function ceilingRow(tools: Tools, store: Store, rn: RoomName): HTMLElement {
  const row = el("label", "prop-row zone-use");
  row.append(Object.assign(el("span"), { textContent: t("panel.roomCeiling") }));
  const input = el("input") as HTMLInputElement;
  input.type = "text";
  input.inputMode = "numeric";
  input.placeholder = String(storeyPlaceholder(store));
  input.value = rn.ceilingMm === undefined ? "" : String(rn.ceilingMm);
  const commit = (): void => {
    const raw = input.value.trim();
    const n = raw === "" ? undefined : Number(raw);
    const next = n === undefined || !isFinite(n) || n <= 0 ? undefined : n;
    if (next === rn.ceilingMm) return;
    tools.setRoomCeiling(rn.id, next);
  };
  input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } };
  input.onchange = commit;
  row.append(input);
  return row;
}

/** What an empty ceiling field falls back to: the storey's own ceiling where it
 *  states one that counts, and the storey height where it does not. */
function storeyPlaceholder(store: Store): number {
  return storeyCeiling(store.floor) ?? floorHeight(store.floor);
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
