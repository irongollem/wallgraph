// Thermal assumptions for the BENG geometry takeoff: what a wall's or an
// opening's own figure falls back to, and the named presets a plan is often
// set out from rather than a value typed per element.
//
// Whole-element figures throughout: an Rc or a U here already includes the
// frame of a kozijn and the finishes of a wall, the way a product datasheet
// states them, not a material-only figure that still needs a bridging
// correction. Indicative and reported only -- core/energy.ts states what it
// does and does not compute.
import type { PlanDoc, Wall, Opening } from "./doc";

/**
 * Document-level thermal defaults. Rc in m²K/W (thermal resistance of the
 * construction), U in W/m²K (transmittance of a kozijn or leaf). Absent field
 * means "not stated" -- there is no implied value, see wallRcOf/openingUOf.
 */
export interface EnergyAssumptions {
  /** Default Rc for an envelope wall stating none of its own. */
  wallRc?: number;
  /** Default Rc for the roof -- no roof object exists; this is the top plate. */
  roofRc?: number;
  /** Default Rc for the ground floor plate. */
  floorRc?: number;
  /** Default U for windows and glazed doors in an envelope wall. */
  windowU?: number;
  /** Default U for other doors and passages in an envelope wall. */
  doorU?: number;
}

/**
 * Named insulation levels, tabulated indicatively from the Dutch regulatory
 * history rather than measured -- a real wall of any of these eras varies. A
 * document either states its own figures or picks one of these as a starting
 * point (applyInsulationClass).
 */
export type InsulationClassId = "none" | "light" | "bb1992" | "bb2013" | "bb2015" | "beng";

export interface InsulationClass { id: InsulationClassId; wallRc: number; roofRc: number; floorRc: number }

export const INSULATION_CLASSES: readonly InsulationClass[] = [
  { id: "none",   wallRc: 0.36, roofRc: 0.22, floorRc: 0.15 }, // uninsulated, before 1975; indicative tabulated values
  { id: "light",  wallRc: 1.3,  roofRc: 1.3,  floorRc: 0.5  }, // 1975-1991, first insulation requirements; indicative
  { id: "bb1992", wallRc: 2.5,  roofRc: 2.5,  floorRc: 2.5  }, // Bouwbesluit 1992 minimum
  { id: "bb2013", wallRc: 3.5,  roofRc: 3.5,  floorRc: 3.5  }, // Bouwbesluit 2012 minimum from 2013
  { id: "bb2015", wallRc: 4.5,  roofRc: 6.0,  floorRc: 3.5  }, // minimum from 2015
  { id: "beng",   wallRc: 4.7,  roofRc: 6.3,  floorRc: 3.7  }, // BENG minimum from 2021
];

/** Named glazing levels, whole-element (frame included), indicative. */
export type GlazingTypeId = "single" | "double" | "hrpp" | "triple";

export interface GlazingType { id: GlazingTypeId; windowU: number; doorU: number }

export const GLAZING_TYPES: readonly GlazingType[] = [
  { id: "single", windowU: 5.1,  doorU: 3.4 },
  { id: "double", windowU: 2.9,  doorU: 3.4 },
  { id: "hrpp",   windowU: 1.65, doorU: 2.0 },
  { id: "triple", windowU: 1.0,  doorU: 1.4 },
];

/** Two figures count as the same class within this tolerance, m²K/W or W/m²K. */
const CLASS_TOL = 0.005;

/**
 * The insulation class whose wallRc/roofRc/floorRc all match the document's
 * assumptions, or null when any figure is unstated or matches no listed
 * class -- a document may state Rc values that are a genuine custom mix.
 */
export function insulationClassOf(e: EnergyAssumptions | undefined): InsulationClassId | null {
  if (!e) return null;
  const { wallRc, roofRc, floorRc } = e;
  if (wallRc === undefined || roofRc === undefined || floorRc === undefined) return null;
  const hit = INSULATION_CLASSES.find(c =>
    Math.abs(c.wallRc - wallRc) <= CLASS_TOL
    && Math.abs(c.roofRc - roofRc) <= CLASS_TOL
    && Math.abs(c.floorRc - floorRc) <= CLASS_TOL);
  return hit?.id ?? null;
}

/** The glazing type whose windowU/doorU both match, or null. */
export function glazingTypeOf(e: EnergyAssumptions | undefined): GlazingTypeId | null {
  if (!e) return null;
  const { windowU, doorU } = e;
  if (windowU === undefined || doorU === undefined) return null;
  const hit = GLAZING_TYPES.find(g =>
    Math.abs(g.windowU - windowU) <= CLASS_TOL && Math.abs(g.doorU - doorU) <= CLASS_TOL);
  return hit?.id ?? null;
}

/** Writes the three Rc figures of a named insulation class onto `e`. */
export function applyInsulationClass(e: EnergyAssumptions, id: InsulationClassId): void {
  const c = INSULATION_CLASSES.find(x => x.id === id);
  if (!c) return;
  e.wallRc = c.wallRc;
  e.roofRc = c.roofRc;
  e.floorRc = c.floorRc;
}

/** Writes the windowU/doorU of a named glazing type onto `e`. */
export function applyGlazingType(e: EnergyAssumptions, id: GlazingTypeId): void {
  const g = GLAZING_TYPES.find(x => x.id === id);
  if (!g) return;
  e.windowU = g.windowU;
  e.doorU = g.doorU;
}

/**
 * Rounds an authored thermal figure (Rc or U) to two decimals and rejects a
 * non-positive result, returning undefined instead -- a wall or opening with
 * no meaningful figure reads as unstated rather than as zero resistance.
 */
export function thermalValue(n: number): number | undefined {
  const r = Math.round(n * 100) / 100;
  return r > 0 ? r : undefined;
}

/**
 * Surface (film) resistances added to a construction's own Rc to reach the
 * total the U-value formula uses, m²K/W -- indicative NEN 1068 / NTA 8800
 * conventions for the three envelope kinds this takeoff distinguishes.
 */
export const SURFACE_R = { wall: 0.17, roof: 0.14, floor: 0.34 } as const;

export type EnvelopeKind = keyof typeof SURFACE_R;

/** U from Rc for one envelope kind: 1 / (Rc + Rsi + Rse). */
export function uFromRc(rc: number, kind: EnvelopeKind): number {
  return 1 / (rc + SURFACE_R[kind]);
}

/**
 * Heating degree days per year, base 18°C -- the long-term De Bilt figure,
 * rounded. One constant for the whole document: this is a climate figure, not
 * a per-plan one, and the estimate it feeds is indicative only.
 */
export const HEATING_DEGREE_DAYS = 2800;

/**
 * A wall counts as part of the thermal envelope exactly when it states a
 * facade -- the document's one statement of "this is the building's exterior
 * skin". A wall without one is internal or a party wall, and carries neither
 * an Rc default nor an orientation.
 */
export function isEnvelopeWall(w: Wall): boolean {
  return w.facadeMm !== undefined && w.facadeMm > 0;
}

/**
 * The Rc that applies to a wall: its OWN figure whenever stated, read
 * regardless of whether the wall is part of the envelope -- an authored value
 * is a fact about the wall, not about the building's exterior. Only the
 * DOCUMENT default is restricted to an envelope wall; outside one, a wall
 * with no figure of its own is null rather than borrowing a default that
 * describes something the wall is not.
 */
export function wallRcOf(doc: PlanDoc, w: Wall): number | null {
  if (w.rc !== undefined) return w.rc;
  if (!isEnvelopeWall(w)) return null;
  return doc.energy?.wallRc ?? null;
}

/** True for a window, or a door stated as glazed -- a leaf drawn as glass
 *  rather than a solid panel. */
export function openingIsGlazing(o: Opening): boolean {
  return o.kind === "window" || (o.kind === "door" && o.glazed === true);
}

/**
 * The U that applies to an opening: its OWN figure whenever stated, read
 * regardless of the wall it sits in -- an authored value is a fact about the
 * element, not about the envelope. Only the DOCUMENT default (windowU or
 * doorU, by openingIsGlazing()) is restricted to an envelope wall; outside
 * one, an opening with no figure of its own is null rather than borrowing a
 * default that describes the building's exterior.
 */
export function openingUOf(doc: PlanDoc, w: Wall, o: Opening): number | null {
  if (o.uValue !== undefined) return o.uValue;
  if (!isEnvelopeWall(w)) return null;
  const fallback = openingIsGlazing(o) ? doc.energy?.windowU : doc.energy?.doorU;
  return fallback ?? null;
}
