// The room-name pane: the name the tool will write next, and the properties of
// a placed one.
//
// A name is armed and then clicked into place, the way a symbol type is. That
// is what makes naming a whole plan quick: pick "Slaapkamer", click three
// bedrooms. The free-text field beside the list covers everything the list does
// not name.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { roomNamesOf } from "../model/doc";
import { RoomName, ROOM_NAMES } from "../model/room";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/** The name the next click writes. */
export function renderRoomNameTool(store: Store, tools: Tools, rows: PaneRows): void {
  rows.secHead(t("panel.newRoomName"));
  // The list writes the field rather than replacing it, so a preset can be
  // picked and then edited — "Slaapkamer 2" starts as "Slaapkamer".
  rows.selRow(t("panel.roomNamePreset"),
    ROOM_NAMES.find(id => t("room." + id) === tools.roomNameText) ?? "",
    [["", t("panel.roomNameCustom")],
      ...ROOM_NAMES.map(id => [id, t("room." + id)] as [string, string])],
    value => { if (value) tools.setRoomNameText(t("room." + value)); });
  rows.textRow(t("panel.roomName"), tools.roomNameText, s => tools.setRoomNameText(s));
  rows.colorRow(t("panel.color"), tools.symbolColor, hex => tools.setSymbolColor(hex));
  rows.noteRow(t("panel.roomNameNote"));
  void store;
}

/** Properties of the selected room name. */
export function renderRoomNameProps(store: Store, tools: Tools, rows: PaneRows, id: string): void {
  const rn = roomNamesOf(store.floor).find(x => x.id === id);
  if (!rn) return;

  const mut = (fn: (r: RoomName) => void, coalesceKey?: string): void => {
    store.mutate(d => {
      const r2 = roomNamesOf(store.floorOf(d)).find(x => x.id === id);
      if (r2) fn(r2);
    }, coalesceKey);
  };

  rows.secHead(t("panel.roomNameSel"), { sel: true });
  rows.textRow(t("panel.roomName"), rn.name,
    s => mut(r => { const v = s.trim(); if (v) r.name = v; }));
  rows.numRow(t("panel.x"), rn.x, n => mut(r => { r.x = Math.round(n); }), 100);
  rows.numRow(t("panel.y"), rn.y, n => mut(r => { r.y = Math.round(n); }), 100);
  rows.colorRow(t("panel.color"), rn.color ?? null, hex => {
    tools.symbolColor = hex;
    mut(r => { if (hex) r.color = hex; else delete r.color; }, "color:" + id);
  });
  rows.noteRow(t("panel.roomNameNote"));
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}
