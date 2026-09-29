// Permit sheet layout and content checklist.
//
// A permit drawing is a plan at a standard scale on a standard sheet with the
// pieces a submission expects: dimensions, room names, a north arrow, a title
// block naming the project. This module decides how a storey lands on paper —
// which sheet, which scale, where the drawing area is, and the one sheet and
// scale a set of storeys shares — and reports which of those pieces the
// document carries. It reports, it does not enforce:
// Wallgraph draws what it is given (see the disclaimer), so an incomplete
// checklist never blocks the export.
import { PlanDoc, Floor, dimModeOf, projectOf } from "../model/doc";
import { dimensionChains, DimChain } from "./dimensions";
import { detectRooms } from "./rooms";
import { resolveFloor } from "./resolve";
import { planBounds } from "./bounds";

/** ISO 216 sheet sizes in paper millimetres, portrait. */
const PAPER = { a4: { w: 210, h: 297 }, a3: { w: 297, h: 420 } } as const;
export type PaperName = keyof typeof PAPER;

/** Frame inset from the paper edge, paper mm. */
export const FRAME_MM = 10;
/** Bottom strip inside the frame reserved for the title block and scale bar. */
export const STRIP_MM = 45;

/** The scales a plan is submitted at, preferred first. 100 means 1:100. */
export const PERMIT_SCALES: readonly number[] = [100, 200];

export interface PaperRect { x: number; y: number; w: number; h: number }

export interface PermitLayout {
  paper: PaperName;
  landscape: boolean;
  /** Paper size as laid, paper mm. */
  pageW: number;
  pageH: number;
  /** 100 means 1:100. */
  scale: number;
  /** False when even the largest sheet at the coarsest scale cannot hold it. */
  fits: boolean;
  /** Border rectangle, paper mm. */
  frame: PaperRect;
  /** Where the plan may land: the frame minus the bottom strip. */
  drawing: PaperRect;
  /** The reserved bottom strip: scale bar left, title block right. */
  strip: PaperRect;
  /** World extent placed, mm, dimension-chain reach included. */
  extent: { minX: number; minY: number; w: number; h: number };
  /** The chains the sheet draws, per the document's dimension convention. */
  chains: { clear: DimChain[]; centerline: DimChain[] };
}

/** Extra world mm past the chain line for its overall run and label. */
export const CHAIN_OVERALL_MM = 420;
/** The two-chain stack: how far the outer (centerline) chain lifts. */
export const CHAIN_LIFT_MM = 840;

/** How far past the walls the drawing reaches, world mm. */
function reachMm(chains: DimChain[], lift: number): number {
  let reach = 500; // breathing room when nothing else claims more
  for (const c of chains) {
    reach = Math.max(reach, c.half + 260 + lift + CHAIN_OVERALL_MM + 320);
  }
  return reach;
}

/** A sheet and a scale, as permitLayout() chooses them. */
export interface PaperChoice { paper: PaperName; landscape: boolean; scale: number }

/** Every sheet, in the order permitLayout() tries them at each scale. */
const CANDIDATES: ReadonlyArray<{ paper: PaperName; landscape: boolean }> = [
  { paper: "a4", landscape: true }, { paper: "a4", landscape: false },
  { paper: "a3", landscape: true }, { paper: "a3", landscape: false },
];

/** Where the drawing may land on a sheet, paper mm. */
function sheetRects(paper: PaperName, landscape: boolean) {
  const p = PAPER[paper];
  const pageW = landscape ? p.h : p.w;
  const pageH = landscape ? p.w : p.h;
  const frame = { x: FRAME_MM, y: FRAME_MM, w: pageW - 2 * FRAME_MM, h: pageH - 2 * FRAME_MM };
  const strip = { x: frame.x, y: frame.y + frame.h - STRIP_MM, w: frame.w, h: STRIP_MM };
  const drawing = { x: frame.x, y: frame.y, w: frame.w, h: frame.h - STRIP_MM };
  return { pageW, pageH, frame, drawing, strip };
}

type Extent = PermitLayout["extent"];

const fitsOn = (extent: Extent, c: PaperChoice): boolean => {
  const { drawing } = sheetRects(c.paper, c.landscape);
  return extent.w / c.scale <= drawing.w && extent.h / c.scale <= drawing.h;
};

/** The first sheet and scale, preferred first, that holds every extent; the
 *  largest sheet at the coarsest scale when none does. */
function chooseSheet(extents: readonly Extent[]): PaperChoice & { fits: boolean } {
  for (const scale of PERMIT_SCALES) {
    for (const c of CANDIDATES) {
      const choice = { ...c, scale };
      if (extents.every(e => fitsOn(e, choice))) return { ...choice, fits: true };
    }
  }
  return { paper: "a3", landscape: true, scale: PERMIT_SCALES[PERMIT_SCALES.length - 1] ?? 100, fits: false };
}

/** What one storey puts on paper: its world extent and the chains it draws. */
function storeyExtent(doc: PlanDoc, floorIndex: number):
  { extent: Extent; chains: PermitLayout["chains"] } | null {
  const floor: Floor | undefined = doc.floors[floorIndex] ?? doc.floors[0];
  if (!floor) return null;
  const resolved = resolveFloor(floor);
  const bounds = planBounds(floor, resolved);
  if (!bounds) return null;

  const mode = dimModeOf(doc);
  const both = mode === "both";
  const clear = mode !== "centerline" ? dimensionChains(floor, "clear") : [];
  const centerline = mode !== "clear" ? dimensionChains(floor, "centerline") : [];
  const pad = Math.max(reachMm(clear, 0), reachMm(centerline, both ? CHAIN_LIFT_MM : 0));
  return {
    extent: {
      minX: bounds.min.x - pad,
      minY: bounds.min.y - pad,
      w: bounds.max.x - bounds.min.x + 2 * pad,
      h: bounds.max.y - bounds.min.y + 2 * pad,
    },
    chains: { clear, centerline },
  };
}

/**
 * How a storey lands on paper, or null for a storey with nothing drawn.
 * Tries each sheet at each scale, preferred first, and falls back to the
 * largest at the coarsest scale with `fits: false` rather than refusing — the
 * checklist states the problem, the export still happens. `choice` imposes a
 * sheet and scale instead, which is how a set of storeys shares one
 * (sharedSheet()).
 */
export function permitLayout(doc: PlanDoc, floorIndex: number, choice?: PaperChoice): PermitLayout | null {
  const storey = storeyExtent(doc, floorIndex);
  if (!storey) return null;
  const { extent, chains } = storey;
  const c = choice ? { ...choice, fits: fitsOn(extent, choice) } : chooseSheet([extent]);
  return { paper: c.paper, landscape: c.landscape, scale: c.scale, fits: c.fits,
    ...sheetRects(c.paper, c.landscape), extent, chains };
}

/**
 * One sheet and one scale for a set of storeys: the first, in permitLayout()'s
 * own order, that holds every storey with something drawn, so the sheets of a
 * set compare at the same scale. Null when no storey has anything drawn.
 */
export function sharedSheet(doc: PlanDoc, floorIndices: readonly number[]): PaperChoice | null {
  const extents = floorIndices.flatMap(i => {
    const s = storeyExtent(doc, i);
    return s ? [s.extent] : [];
  });
  if (extents.length === 0) return null;
  const { fits: _fits, ...choice } = chooseSheet(extents);
  return choice;
}

export type PermitCheckId = "paper" | "title" | "north" | "dims" | "names";

export interface PermitCheck { id: PermitCheckId; ok: boolean }

/**
 * Which of the pieces a submission ordinarily expects the document carries.
 * Every check is derived from the document; none is a regulatory judgement.
 */
export function permitChecklist(doc: PlanDoc, floorIndex: number): PermitCheck[] {
  const layout = permitLayout(doc, floorIndex);
  const floor: Floor | undefined = doc.floors[floorIndex] ?? doc.floors[0];
  const meta = projectOf(doc);
  const rooms = floor ? detectRooms(floor) : [];
  const hasChains = layout !== null
    && layout.chains.clear.length + layout.chains.centerline.length > 0;
  return [
    { id: "paper", ok: layout !== null && layout.fits },
    { id: "title", ok: (meta.name ?? "") !== "" && (meta.address ?? "") !== "" },
    { id: "north", ok: doc.northDeg !== undefined },
    { id: "dims", ok: hasChains },
    { id: "names", ok: rooms.length > 0 && rooms.every(r => r.name !== undefined) },
  ];
}
