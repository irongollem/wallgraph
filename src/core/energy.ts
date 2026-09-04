// BENG geometry takeoff: the envelope area, orientation and an indicative
// steady-state transmission loss, read off the same wall graph and rooms
// everything else in core/ derives from.
//
// What this measures:
//   envelope   opaque wall, glazing, door and passage area, plus the roof
//              (the top storey's plate, treated as a flat roof -- there is no
//              roof object) and the ground floor plate, at the structural
//              CLAD face -- resolveFloor()'s mitered face length. The facade
//              skin's own thickness is not added to that length; it is a
//              layer outside the structure, the same distinction
//              core/surface.ts draws for the gross wall area.
//   transmission  H_T = Sum(U . A) from whatever Rc/U figures are stated,
//              times an indicative heating-degree-day figure. Steady-state
//              only: no ventilation or infiltration loss, no solar or
//              internal gains, no thermal bridging (psi-values), no
//              installation or system efficiency. A figure for one part of
//              one balance, not an energy label.
//   overhang   flagged where a storey's outer boundary does not sit inside
//              the storey below, never measured as its own area or corrected
//              for.
//
// Reported, never enforced or certified: nothing here decides whether a plan
// meets BENG, only what its geometry and stated figures currently add up to.
import type { Floor, Id, OpeningKind, PlanDoc } from "../model/doc";
import {
  areaModeOf, facadeSideOf, floorHeight, openingHeight, openingSill, wallHeight,
} from "../model/doc";
import {
  HEATING_DEGREE_DAYS, isEnvelopeWall, openingIsGlazing, openingUOf, uFromRc, wallRcOf,
} from "../model/energy";
import { resolveFloor, type Resolved } from "./resolve";
import { detectRooms, outerBoundary, outwardSide, roomArea, type Room } from "./rooms";
import {
  Vec, distToSeg, norm, perp, pointInPolygon, scale, sub,
} from "../geometry/vec";
import { arcLength, arcTangentAt } from "../geometry/arc";
import type { AreaMode } from "../model/doc";

export type Orientation = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export const ORIENTATIONS: readonly Orientation[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/**
 * Compass sector of an outward normal. `screenDeg` is degrees clockwise from
 * screen-up (0 = up, 90 = right), which is also how `northDeg` is authored,
 * so the bearing is just the difference between the two.
 */
export function orientationOf(normal: Vec, northDeg: number): Orientation {
  const screenDeg = (Math.atan2(normal.x, -normal.y) * 180) / Math.PI;
  const bearing = (((screenDeg - northDeg) % 360) + 360) % 360;
  const idx = Math.round(bearing / 45) % 8;
  return ORIENTATIONS[idx]!;
}

export interface EnvelopeOpening {
  openingId: Id;
  kind: OpeningKind;
  glazing: boolean;
  areaMm2: number;
  orientation: Orientation | null;
  u: number | null;
}

export interface EnvelopeWall {
  wallId: Id;
  floorIndex: number;
  /** Mitered length of the clad face -- resolveFloor()'s ResolvedWall.faces[side]. */
  lengthMm: number;
  /** wallHeight(f, w): floor to floor. A ceiling is a finish and does not apply. */
  heightMm: number;
  grossMm2: number;
  openingsMm2: number;
  /** Opaque net: gross less openings. */
  netMm2: number;
  /** Outward normal at mid-wall (chord for an arc). Null without northDeg. */
  orientation: Orientation | null;
  rc: number | null;
  openings: EnvelopeOpening[];
}

export interface StoreyEnvelope {
  floorIndex: number;
  name: string;
  heightMm: number;
  /** Sum of room bvoAreaMm2: the gross plate, at the facade's outer face
   *  where one is stated. */
  plateMm2: number;
  /** Sum of roomArea(r, areaModeOf(doc)). */
  usableMm2: number;
  /** plateMm2 x heightMm: bruto inhoud. */
  volumeMm3: number;
  /** max(0, plate - plate of the storey above); the top storey's whole plate. */
  roofMm2: number;
  /** floors[0]: plateMm2; every other storey 0. */
  groundMm2: number;
  walls: EnvelopeWall[];
  /** Walls with a face no room bounds and no facade: probably exterior,
   *  simply not stated as such. */
  unstatedExterior: number;
  /** Envelope walls clad on the side a room bounds while the other side
   *  bounds no room -- facadeSide chosen, or left since edited, backwards. */
  inwardFacades: number;
  /** The storey above has an outer-boundary vertex outside this storey's. */
  overhang: boolean;
}

export interface EnvelopeTakeoff {
  storeys: StoreyEnvelope[];
  /** Sum of opaque net wall area. */
  wallsMm2: number;
  glazingMm2: number;
  doorsMm2: number;
  roofMm2: number;
  groundMm2: number;
  /** Als: wallsMm2 + glazingMm2 + doorsMm2 + roofMm2 + groundMm2. */
  envelopeMm2: number;
  /** Ag: total usable floor area over every storey. */
  usableMm2: number;
  areaMode: AreaMode;
  /** Als / Ag. Null when Ag is 0. */
  compactness: number | null;
  volumeMm3: number;
  /** Glazing area by compass sector. Null when northDeg is absent. */
  glazingByOrientation: Record<Orientation, number> | null;
  unstatedExterior: number;
  /** Sum of StoreyEnvelope.inwardFacades. */
  inwardFacades: number;
  overhang: boolean;
}

export interface TransmissionEstimate {
  wallsWK: number;
  roofWK: number;
  floorWK: number;
  glazingWK: number;
  doorsWK: number;
  /** H_T = Sum(U . A), W/K. */
  totalWK: number;
  /** totalWK over the stated envelope area, in m². */
  meanU: number;
  /** Envelope area, mm², that carried a value and so entered totalWK. */
  statedMm2: number;
  /** Elements skipped for lack of a value -- a wall, an opening, the roof or
   *  the ground floor each count once. */
  unstated: number;
  heatKWhYear: number;
  /** heatKWhYear per m² Ag. Null when Ag is 0. */
  heatKWhM2Year: number | null;
}

/**
 * What one opening cuts from the envelope face it sits in, mm²: width times
 * clear height, clamped to the face -- the same rule core/surface.ts's
 * openingOn() applies, but deducted once, since the envelope is one face.
 */
function openingCut(faceHeightMm: number, o: { t: number; width: number }, sill: number, height: number): number {
  const head = sill + height;
  const top = Math.min(head, faceHeightMm);
  const bottom = Math.min(sill, top);
  const clear = Math.max(0, top - bottom);
  const width = Math.max(0, o.width);
  return width * clear;
}

function envelopeWallsOf(
  f: Floor, floorIndex: number, resolved: Resolved, doc: PlanDoc, northDeg: number | undefined,
): EnvelopeWall[] {
  const out: EnvelopeWall[] = [];
  for (const w of f.walls) {
    if (!isEnvelopeWall(w)) continue;
    const rw = resolved.walls.get(w.id);
    if (!rw) continue;

    const side = facadeSideOf(w);
    const lengthMm = rw.faces[side];
    const heightMm = wallHeight(f, w);
    const grossMm2 = lengthMm * heightMm;

    const chordDir = norm(sub(rw.b, rw.a));
    const wallNormal = side === "left" ? perp(chordDir) : scale(perp(chordDir), -1);
    const orientation = northDeg === undefined ? null : orientationOf(wallNormal, northDeg);

    const totalLen = arcLength(rw.a, rw.b, w.bulge);
    const openings: EnvelopeOpening[] = [];
    let rawCut = 0;
    for (const o of w.openings) {
      const areaMm2 = openingCut(heightMm, o, openingSill(o), openingHeight(o));
      rawCut += areaMm2;

      const frac = totalLen > 0 ? o.t / totalLen : 0.5;
      const tangentAtT = arcTangentAt(rw.a, rw.b, w.bulge, frac);
      const openingNormal = side === "left" ? perp(tangentAtT) : scale(perp(tangentAtT), -1);
      const openingOrientation = northDeg === undefined ? null : orientationOf(openingNormal, northDeg);

      openings.push({
        openingId: o.id, kind: o.kind, glazing: openingIsGlazing(o),
        areaMm2, orientation: openingOrientation, u: openingUOf(doc, w, o),
      });
    }
    const openingsMm2 = Math.min(rawCut, grossMm2);
    out.push({
      wallId: w.id, floorIndex, lengthMm, heightMm,
      grossMm2, openingsMm2, netMm2: grossMm2 - openingsMm2,
      orientation, rc: wallRcOf(doc, w), openings,
    });
  }
  return out;
}

/**
 * Walls that probably close the building but do not say so: not an envelope
 * wall (no facade), yet at least one face bounds no room. No rooms at all on
 * the floor means nothing can be said, so that floor contributes 0.
 */
function unstatedExteriorOf(f: Floor, rooms: readonly Room[]): number {
  if (rooms.length === 0) return 0;
  const bounded = new Set<string>();
  for (const r of rooms) for (const bf of r.boundingFaces) bounded.add(bf.wallId + ":" + bf.side);
  let n = 0;
  for (const w of f.walls) {
    if (isEnvelopeWall(w)) continue;
    if (!bounded.has(w.id + ":left") || !bounded.has(w.id + ":right")) n++;
  }
  return n;
}

/**
 * Envelope walls clad on the side a room bounds, with the other side bounding
 * no room -- outwardSide(rooms, w.id) disagreeing with the stored
 * facadeSide, which is the only way that pairing arises. Zero when the floor
 * has no rooms, since outwardSide() then returns null for every wall.
 */
function inwardFacadesOf(f: Floor, rooms: readonly Room[]): number {
  let n = 0;
  for (const w of f.walls) {
    if (!isEnvelopeWall(w)) continue;
    const clad = facadeSideOf(w);
    const away = clad === "left" ? "right" : "left";
    if (outwardSide(rooms, w.id) === away) n++;
  }
  return n;
}

/**
 * True when any vertex of `upper` lies outside `lower` by more than 1 mm. A
 * vertex within 1 mm of a `lower` edge counts as on it, not outside --
 * pointInPolygon() alone is unreliable exactly on the boundary.
 */
function overhangBetween(lower: Vec[] | null, upper: Vec[] | null): boolean {
  if (!lower || !upper || lower.length < 3 || upper.length < 3) return false;
  for (const p of upper) {
    if (pointInPolygon(p, lower)) continue;
    let minD = Infinity;
    const n = lower.length;
    for (let i = 0; i < n; i++) {
      const a = lower[i]!, b = lower[(i + 1) % n]!;
      minD = Math.min(minD, distToSeg(p, a, b).d);
    }
    if (minD > 1) return true;
  }
  return false;
}

export function envelopeTakeoff(doc: PlanDoc): EnvelopeTakeoff {
  const northDeg = doc.northDeg;
  const mode = areaModeOf(doc);

  const per = doc.floors.map((f, i) => {
    const resolved = resolveFloor(f);
    const rooms = detectRooms(f);
    const plateMm2 = rooms.reduce((n, r) => n + r.bvoAreaMm2, 0);
    const usableMm2 = rooms.reduce((n, r) => n + roomArea(r, mode), 0);
    return {
      floor: f, plateMm2, usableMm2,
      outer: outerBoundary(f),
      walls: envelopeWallsOf(f, i, resolved, doc, northDeg),
      unstatedExterior: unstatedExteriorOf(f, rooms),
      inwardFacades: inwardFacadesOf(f, rooms),
    };
  });

  const storeys: StoreyEnvelope[] = per.map((it, i) => {
    const above = per[i + 1];
    const heightMm = floorHeight(it.floor);
    return {
      floorIndex: i, name: it.floor.name, heightMm,
      plateMm2: it.plateMm2, usableMm2: it.usableMm2,
      volumeMm3: it.plateMm2 * heightMm,
      roofMm2: above ? Math.max(0, it.plateMm2 - above.plateMm2) : it.plateMm2,
      groundMm2: i === 0 ? it.plateMm2 : 0,
      walls: it.walls,
      unstatedExterior: it.unstatedExterior,
      inwardFacades: it.inwardFacades,
      overhang: above ? overhangBetween(it.outer, above.outer) : false,
    };
  });

  const glazingByOrientation: Record<Orientation, number> | null = northDeg === undefined
    ? null
    : ORIENTATIONS.reduce((acc, o) => { acc[o] = 0; return acc; }, {} as Record<Orientation, number>);

  let wallsMm2 = 0, glazingMm2 = 0, doorsMm2 = 0, roofMm2 = 0, groundMm2 = 0;
  let usableMm2 = 0, volumeMm3 = 0, unstatedExterior = 0, inwardFacades = 0;
  for (const s of storeys) {
    roofMm2 += s.roofMm2;
    groundMm2 += s.groundMm2;
    usableMm2 += s.usableMm2;
    volumeMm3 += s.volumeMm3;
    unstatedExterior += s.unstatedExterior;
    inwardFacades += s.inwardFacades;
    for (const w of s.walls) {
      wallsMm2 += w.netMm2;
      for (const o of w.openings) {
        if (o.glazing) {
          glazingMm2 += o.areaMm2;
          if (glazingByOrientation && o.orientation) glazingByOrientation[o.orientation] += o.areaMm2;
        } else {
          doorsMm2 += o.areaMm2;
        }
      }
    }
  }

  const envelopeMm2 = wallsMm2 + glazingMm2 + doorsMm2 + roofMm2 + groundMm2;
  return {
    storeys, wallsMm2, glazingMm2, doorsMm2, roofMm2, groundMm2, envelopeMm2,
    usableMm2, areaMode: mode,
    compactness: usableMm2 === 0 ? null : envelopeMm2 / usableMm2,
    volumeMm3, glazingByOrientation, unstatedExterior, inwardFacades,
    overhang: storeys.some(s => s.overhang),
  };
}

/**
 * Steady-state transmission loss from the takeoff and the stated Rc/U
 * figures. Null when nothing in the document carries a value at all.
 */
export function transmissionEstimate(t: EnvelopeTakeoff, doc: PlanDoc): TransmissionEstimate | null {
  let wallsWK = 0, glazingWK = 0, doorsWK = 0, statedMm2 = 0, unstated = 0;

  for (const s of t.storeys) {
    for (const w of s.walls) {
      if (w.rc !== null) {
        wallsWK += (w.netMm2 / 1e6) * uFromRc(w.rc, "wall");
        statedMm2 += w.netMm2;
      } else if (w.netMm2 > 0) {
        unstated++;
      }
      for (const o of w.openings) {
        if (o.u === null) { unstated++; continue; }
        const wk = (o.areaMm2 / 1e6) * o.u;
        if (o.glazing) glazingWK += wk; else doorsWK += wk;
        statedMm2 += o.areaMm2;
      }
    }
  }

  const roofRc = doc.energy?.roofRc;
  let roofWK = 0;
  if (roofRc !== undefined) {
    roofWK = (t.roofMm2 / 1e6) * uFromRc(roofRc, "roof");
    statedMm2 += t.roofMm2;
  } else if (t.roofMm2 > 0) {
    unstated++;
  }

  const floorRc = doc.energy?.floorRc;
  let floorWK = 0;
  if (floorRc !== undefined) {
    floorWK = (t.groundMm2 / 1e6) * uFromRc(floorRc, "floor");
    statedMm2 += t.groundMm2;
  } else if (t.groundMm2 > 0) {
    unstated++;
  }

  if (statedMm2 === 0) return null;

  const totalWK = wallsWK + roofWK + floorWK + glazingWK + doorsWK;
  const heatKWhYear = (totalWK * 24 * HEATING_DEGREE_DAYS) / 1000;
  return {
    wallsWK, roofWK, floorWK, glazingWK, doorsWK, totalWK,
    meanU: totalWK / (statedMm2 / 1e6),
    statedMm2, unstated, heatKWhYear,
    heatKWhM2Year: t.usableMm2 === 0 ? null : heatKWhYear / (t.usableMm2 / 1e6),
  };
}
