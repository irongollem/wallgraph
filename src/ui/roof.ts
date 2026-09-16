// The Dak/Roof fold-out: roof planes authored per storey -- suggested from
// the walls already drawn, edited per plane, checked against the walls they
// cover, and read against the headroom they leave.
//
// Mirrors ui/energy.ts: the plane list is pure geometry (roofPlaneArea()) and
// renders on every rebuild, while the mismatch and headroom rows read
// derived rooms (core/rooms.ts's detectRooms) and so are computed by the
// caller only while the section is open -- see panel.ts's syncRoofTakeoff.
import { Store } from "../model/store";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";
import { sqm } from "./walls";
import { wallLength } from "../model/ops";
import type { Floor } from "../model/doc";
import {
  roofPlanesOf, clampRoofPlane, roofThicknessOf, ROOF_THICKNESS_DEFAULT_MM, type RoofPlane,
} from "../model/roof";
import { roofPlaneArea, profileFromRoof, type RoofWallMismatch, type RoofStoreyClash } from "../core/roof";
import { suggestRoof, flatRoof, gableRoof, type RoofSuggestion } from "../core/roofsuggest";
import { roomLowHeadroom } from "../core/headroom";
import { clampProfile } from "../model/profile";
import type { Room } from "../core/rooms";

/** The pitch the "Zadeldak 45°" preset writes. */
const GABLE_PRESET_PITCH_DEG = 45;

/**
 * The pending "Voorstel uit muren" suggestion, held by the panel until Accept
 * writes it -- the same get/set-object shape ui/zoom.ts's RoomEdit uses for
 * pane state that has to survive the rebuild opening (or here, computing)
 * it causes.
 */
export interface RoofProposal {
  value: RoofSuggestion | null;
  set(s: RoofSuggestion | null): void;
}

/** "2 dakvlakken, 45°, dakrand 2600 mm" when every proposed plane agrees on
 *  pitch and eave -- the ordinary gable/lean-to/flat case -- or a generic
 *  count when a hip or an asymmetric building proposes planes that differ. */
function summarize(s: RoofSuggestion): string {
  const n = s.planes.length;
  const pitches = new Set(s.planes.map(p => Math.round(p.pitchDeg)));
  const eaves = new Set(s.planes.map(p => Math.round(p.eaveMm)));
  if (n > 0 && pitches.size === 1 && eaves.size === 1) {
    const key = n === 1 ? "roof.suggestSummaryOne" : "roof.suggestSummary";
    return t(key, { n, pitch: [...pitches][0]!, eave: [...eaves][0]! });
  }
  return t("roof.suggestSummaryMixed", { n });
}

type RoofRows = Pick<PaneRows, "secHead" | "numRow" | "checkRow" | "infoRow" | "noteRow" | "warnRow" | "btnRow">;

/**
 * No planes yet: the suggestion (once asked for) plus the three ways to
 * start a roof. With planes: eave, pitch, thickness and the sloped area per
 * plane, a delete button each, and "Remove all". All of it pure geometry
 * (roofPlaneArea() is a plan-area division, not a resolve), so it is cheap
 * enough to render on every rebuild -- see ui/energy.ts's
 * renderEnergyAssumptions for the same split.
 */
export function renderRoof(rows: RoofRows, store: Store, floor: Floor, proposal: RoofProposal): void {
  const planes = roofPlanesOf(floor);

  if (planes.length === 0) {
    if (proposal.value) {
      rows.noteRow(summarize(proposal.value));
      if (proposal.value.note) rows.warnRow(t("roof.note" + proposal.value.note[0]!.toUpperCase() + proposal.value.note.slice(1)));
      rows.btnRow(t("roof.accept"), () => {
        const s = proposal.value;
        if (!s) return;
        store.mutate(d => { store.floorOf(d).roofPlanes = s.planes; });
        proposal.set(null);
      });
    }
    rows.btnRow(t("roof.suggest"), () => proposal.set(suggestRoof(floor)));
    rows.btnRow(t("roof.presetFlat"), () => store.mutate(d => {
      const f = store.floorOf(d);
      f.roofPlanes = flatRoof(f);
    }));
    rows.btnRow(t("roof.presetGable"), () => store.mutate(d => {
      const f = store.floorOf(d);
      f.roofPlanes = gableRoof(f, GABLE_PRESET_PITCH_DEG);
    }));
    return;
  }

  for (let i = 0; i < planes.length; i++) {
    const plane = planes[i]!;
    rows.secHead(t("roof.plane", { n: i + 1 }), { later: true });
    const mut = (fn: (p: RoofPlane) => void): void => store.mutate(d => {
      const f = store.floorOf(d);
      const p = roofPlanesOf(f).find(x => x.id === plane.id);
      if (!p) return;
      fn(p);
      clampRoofPlane(p);
    });
    rows.numRow(t("roof.eave"), plane.eaveMm, n => mut(p => { p.eaveMm = n; }), 50);
    rows.numRow(t("roof.pitch"), plane.pitchDeg, n => mut(p => { p.pitchDeg = n; }), 1);
    rows.checkRow(t("roof.ownThickness"), plane.thicknessMm !== undefined, on => mut(p => {
      if (on) p.thicknessMm = roofThicknessOf(p); else delete p.thicknessMm;
    }));
    if (plane.thicknessMm !== undefined) {
      rows.numRow(t("roof.thickness"), plane.thicknessMm, n => mut(p => { p.thicknessMm = n; }), 10);
    } else {
      rows.noteRow(t("roof.thicknessNote", { mm: ROOF_THICKNESS_DEFAULT_MM }));
    }
    rows.infoRow(t("roof.area"), sqm(roofPlaneArea(plane)));
    rows.btnRow(t("roof.deletePlane"), () => store.mutate(d => {
      const f = store.floorOf(d);
      f.roofPlanes = roofPlanesOf(f).filter(x => x.id !== plane.id);
    }));
  }

  rows.btnRow(t("roof.removeAll"), () => store.mutate(d => { delete store.floorOf(d).roofPlanes; }));
}

export interface RoofTakeoffData {
  mismatches: readonly RoofWallMismatch[];
  /** Named rooms that actually have low headroom -- an unnamed room, and one
   *  with none, are left out (see ui/roof.ts's caller). */
  headroomRooms: ReadonlyArray<{ room: Room; lowMm2: number }>;
  /** roofStoreyClashes() against the storey above, empty on the top storey
   *  or where that storey has no closed boundary of its own -- see
   *  core/roof.ts. */
  clashes: readonly RoofStoreyClash[];
  /** The storey above's own name, for the clash row -- core reports the
   *  clash by planeId and mm, the caller names the floor the same way
   *  syncRoofTakeoff already supplies room names for the headroom rows.
   *  Absent exactly when `clashes` is empty. */
  aboveName?: string;
}

/**
 * Mismatch rows (each with a "Follow roof" button that writes
 * profileFromRoof() into that wall) and headroom rows (a named room's low
 * area and the usable area left once it is excluded). `data` is supplied by
 * the caller -- see panel.ts's syncRoofTakeoff, which recomputes it only
 * while the section is open and only when the document has actually changed.
 */
export function renderRoofTakeoff(
  rows: Pick<PaneRows, "secHead" | "infoRow" | "noteRow" | "warnRow" | "btnRow">,
  store: Store, floor: Floor, data: RoofTakeoffData,
): void {
  if (data.mismatches.length > 0) {
    rows.secHead(t("roof.mismatchHead"), { later: true });
    for (const m of data.mismatches) {
      const wallId = m.wallId;
      const wall = floor.walls.find(w => w.id === wallId);
      if (!wall) continue;
      rows.warnRow(t("roof.mismatch", { length: Math.round(wallLength(floor, wall)), gap: Math.abs(m.gapMm) }));
      rows.btnRow(t("roof.followRoof"), () => store.mutate(d => {
        const f = store.floorOf(d);
        const w = f.walls.find(x => x.id === wallId);
        if (!w) return;
        const profile = profileFromRoof(f, w);
        if (!profile) return;
        w.profile = profile;
        clampProfile(f, w);
      }));
    }
  }

  if (data.clashes.length > 0 && data.aboveName !== undefined) {
    rows.secHead(t("roof.clashHead"), { later: true });
    const planes = roofPlanesOf(floor);
    for (const c of data.clashes) {
      const n = planes.findIndex(p => p.id === c.planeId) + 1;
      if (n <= 0) continue;
      rows.warnRow(t("roof.clash", { n, over: c.overMm, floor: data.aboveName }));
    }
  }

  if (data.headroomRooms.length > 0) {
    rows.secHead(t("roof.headroomHead"), { later: true });
    for (const { room, lowMm2 } of data.headroomRooms) {
      const name = room.name ?? "";
      rows.infoRow(t("roof.headroomLow", { room: name }), sqm(lowMm2));
      rows.infoRow(t("roof.headroomUsable", { room: name }), sqm(Math.max(0, room.netAreaMm2 - lowMm2)));
    }
    rows.noteRow(t("roof.headroomNote"));
  }
}

/** Every named room with low headroom under the storey's roof planes --
 *  roomLowHeadroom() itself returns 0 for an unroofed storey, so this is
 *  naturally empty there. */
export function roofHeadroomRooms(floor: Floor, rooms: readonly Room[]): RoofTakeoffData["headroomRooms"] {
  const out: Array<{ room: Room; lowMm2: number }> = [];
  for (const room of rooms) {
    if (room.name === undefined) continue;
    const lowMm2 = roomLowHeadroom(floor, room);
    if (lowMm2 > 0) out.push({ room, lowMm2 });
  }
  return out;
}
