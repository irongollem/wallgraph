// The wall pane: what the NEXT wall is drawn with -- the shape it is struck out
// in, how thick it is, and whatever that shape needs to know.
//
// The shapes are here because a room is rarely four separate decisions. A
// rectangle is two clicks and leaves four ordinary walls behind: the shape is
// how they were entered, not something the document keeps (see model/shape.ts).
import { Tools } from "../input/tools";
import { Store } from "../model/store";
import {
  WALL_SHAPES, POLYGON_MIN_SIDES, POLYGON_MAX_SIDES, type WallShape,
} from "../model/shape";
import { WALL_MATERIALS, POST_DEFAULT_MM, POST_WIDTH_DEFAULT, type WallMaterial } from "../model/doc";
import type { Wall } from "../model/doc";
import { wallLength, MIN_WALL_MM } from "../model/ops";
import { floorSurface, type FloorSurface, type WallSurface } from "../core/surface";
import { v } from "../geometry/vec";
import { foldOut } from "./foldout";
import { icon, type IconName } from "./icons";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/** Thicknesses a plan is ordinarily drawn at, mm. Anything else is typed. */
const THICKNESSES: readonly number[] = [70, 100, 150, 200, 300];

const SHAPE_ICON: Record<WallShape, IconName> = {
  line: "shapeLine", rect: "shapeRect", circle: "shapeCircle", polygon: "shapePoly",
};

/** The shape picker and the dimensions the next wall will carry. */
export function renderWallTool(
  host: HTMLElement, store: Store, tools: Tools, rows: PaneRows, onPick: () => void,
): void {
  rows.secHead(t("panel.newWall"));

  const grid = el("div", "shape-row");
  for (const shape of WALL_SHAPES) {
    grid.append(shapeTile(shape, tools.wallShape === shape, () => {
      tools.setWallShape(shape);
      onPick();
    }));
  }
  host.append(grid);

  const setThickness = (n: number): void => {
    tools.lastThickness = Math.max(20, Math.round(n));
    tools.refresh();
  };
  rows.numRow(t("panel.thickness"), tools.lastThickness, setThickness, 10);
  rows.chipRow(t("panel.thickness"), THICKNESSES, tools.lastThickness, setThickness);

  // What the next wall is built of and drawn in. Armed rather than set
  // afterwards for the reason the thickness above is: a glazed partition is a
  // run of walls, and so is everything marked as new work on a verbouwtekening.
  rows.selRow(t("panel.newWallMaterial"), tools.wallMaterial ?? "",
    [["", t("panel.materialUnknown")],
      ...WALL_MATERIALS.map(m => [m, t("panel.material_" + m)] as [string, string])],
    value => tools.setWallPen({ wallMaterial: value ? value as WallMaterial : null }));
  rows.checkRow(t("panel.postsOn"), tools.wallPostMm !== null,
    on => tools.setWallPen({ wallPostMm: on ? POST_DEFAULT_MM : null }));
  if (tools.wallPostMm !== null) {
    rows.numRow(t("panel.posts"), tools.wallPostMm,
      n => tools.setWallPen({ wallPostMm: Math.max(100, Math.round(n)) }), 100);
    rows.checkRow(t("panel.postWidthOn"), tools.wallPostWidthMm !== null,
      on => tools.setWallPen({ wallPostWidthMm: on ? POST_WIDTH_DEFAULT : null }));
    if (tools.wallPostWidthMm !== null) {
      rows.numRow(t("panel.postWidth"), tools.wallPostWidthMm,
        n => tools.setWallPen({ wallPostWidthMm: Math.max(10, Math.round(n)) }), 10);
    }
    rows.noteRow(t("panel.postsHelp"));
  }
  rows.colorRow(t("panel.newWallColor"), tools.wallColor,
    hex => tools.setWallPen({ wallColor: hex }));

  // Shift squares off a rectangle while it is being drawn, which a touch screen
  // has no way to say; the toggle is how it is said there, and it stays armed.
  if (tools.wallShape === "rect") {
    rows.checkRow(t("panel.square"), tools.squareLock, b => {
      tools.squareLock = b;
      tools.refresh();
    });
  }
  if (tools.wallShape === "polygon") {
    rows.numRow(t("panel.sides"), tools.polygonSides, n => tools.setPolygonSides(n), 1, {
      title: t("panel.sidesHelp", { min: POLYGON_MIN_SIDES, max: POLYGON_MAX_SIDES }),
    });
  }
  // The chain's own way to finish a room, offered where the chain is open. The
  // key is in the title: a phone has none.
  if (tools.canCloseChain) {
    rows.btnRow(t("panel.chainClose"), () => tools.closeChain(), t("panel.chainCloseTitle"));
  }
  rows.noteRow(t("panel.wallWeldNote"));

  // One takeoff for both readers below: the storey total, and the per-wall
  // figure each row of the wall list carries.
  const surface = floorSurface(store.floor, tools.resolvedFloor(), tools.rooms());
  renderStoreySurface(rows, surface);
  renderWallList(host, store, tools, surface);
}

/** Square metres, as a paint or plaster quantity is written. */
export function sqm(mm2: number): string {
  return (mm2 / 1e6).toFixed(2) + " m\u00b2";
}

/**
 * The figures a face area is read in, shared by the storey total and the
 * selected wall's own pane so the two cannot state it differently.
 *
 * Every row but the net one is conditional, because a row that repeats the one
 * above it is noise: gross and the deduction only where there is a deduction to
 * make, the reveals and the total only where there are openings to have any,
 * and `inner` only where cladding takes a face out of it.
 */
function surfaceRows(
  rows: PaneRows,
  s: {
    grossMm2: number; openingsMm2: number; netMm2: number;
    revealsMm2: number; finishMm2: number; innerMm2: number;
  },
  clad: boolean,
): void {
  if (s.openingsMm2 > 0) {
    rows.infoRow(t("panel.wallSurfaceGross"), sqm(s.grossMm2));
    rows.infoRow(t("panel.wallSurfaceOpenings"), "\u2212" + sqm(s.openingsMm2));
  }
  rows.infoRow(t("panel.wallSurfaceNet"), sqm(s.netMm2));
  // Kept beside the net figure rather than inside it: a stucadoor prices the
  // dagkanten separately, and a plan that wants the wall alone still has it.
  if (s.revealsMm2 > 0) {
    rows.infoRow(t("panel.wallSurfaceReveals"), "+" + sqm(s.revealsMm2));
    rows.infoRow(t("panel.wallSurfaceFinish"), sqm(s.finishMm2));
  }
  if (clad) rows.infoRow(t("panel.wallSurfaceInner"), sqm(s.innerMm2));
}

/**
 * The face area of one wall, in the pane of the wall that is selected. The
 * measurement basis is stated beside the figure every time rather than once in
 * a manual: a quantity read off it needs to say what height it was measured to.
 *
 * Where a suspended ceiling lowers one of the two faces, they are also listed
 * separately. That is exactly the case where one total is surprising -- the two
 * sides of a wall between a badkamer and a slaapkamer are then not the same
 * area, and the row naming the room says which is which.
 */
export function renderWallSurface(rows: PaneRows, s: WallSurface): void {
  const clad = s.faces.some(x => x.clad);
  surfaceRows(rows, s, clad);
  const lowered = s.faces.some(x => x.heightMm < s.heightMm);
  if (lowered) {
    for (const face of s.faces) {
      rows.infoRow(faceLabel(face),
        t("panel.wallSurfaceFaceValue", { area: sqm(face.finishMm2), mm: face.heightMm }));
    }
  }
  rows.noteRow(lowered ? t("panel.wallSurfaceCeilingNote") : t("panel.wallSurfaceNote"));
  if (s.revealsMm2 > 0) rows.noteRow(t("panel.wallSurfaceRevealNote"));
  if (clad) rows.noteRow(t("panel.wallSurfaceCladNote"));
}

/** What to call one face: the room it looks into, named or not, or the outside
 *  where it looks into no room at all. */
function faceLabel(face: WallSurface["faces"][number]): string {
  if (face.roomName !== undefined) return face.roomName;
  return face.roomKey === undefined
    ? t("panel.wallSurfaceFaceOutside")
    : t("panel.wallSurfaceFaceUnnamed");
}

/** The storey's total wall face area: what an order for stucwerk, verf or
 *  behang is placed against. Reported, never checked against anything. */
function renderStoreySurface(rows: PaneRows, total: FloorSurface): void {
  if (total.walls.length === 0) return;
  rows.secHead(t("panel.wallSurface"), { later: true });
  surfaceRows(rows, total, total.cladFaces > 0);
  // What the rooms of this storey take between them: the figure a quote for
  // the whole floor is written against, and the one the room list breaks down.
  // Stated only where a wall loop closes -- with none, every face is outside
  // and the row would read zero for a storey that plainly has walls.
  if (total.rooms.length > 0) {
    rows.infoRow(t("panel.wallSurfaceRooms"),
      sqm(total.rooms.reduce((n, r) => n + r.finishMm2, 0)));
  }
  const lowered = total.walls.some(s => s.faces.some(x => x.heightMm < s.heightMm));
  rows.noteRow(lowered ? t("panel.wallSurfaceCeilingNote") : t("panel.wallSurfaceNote"));
  if (total.revealsMm2 > 0) rows.noteRow(t("panel.wallSurfaceRevealNote"));
  if (total.cladFaces > 0) rows.noteRow(t("panel.wallSurfaceCladNote"));
}

/**
 * Every wall on this storey with the length it was built to, shortest first.
 *
 * Shortest first because of what the list is read for. A wall of a few
 * millimetres is invisible at plan zoom and says nothing about itself on the
 * canvas, but beside one of four metres in a column it is unmistakable.
 * Pressing a row frames and selects it; the bin removes it.
 *
 * Folded away, and shut until asked for. This is the pane a plan is drawn
 * from, rebuilt at every wall placed, and a storey's worth of rows standing
 * open above the shape picker would bury the controls the drawing is actually
 * being made with. The head carries the count, and is marked when the list
 * holds something too short to be a wall -- so the one thing worth opening it
 * for is legible without opening it.
 *
 * The list states what the graph holds and changes nothing about it. It is not
 * a check and it repairs nothing: a short wall may be exactly what was meant.
 */
function renderWallList(
  host: HTMLElement, store: Store, tools: Tools, surface: FloorSurface,
): void {
  const f = store.floor;
  if (f.walls.length === 0) return;
  const area = new Map(surface.walls.map(s => [s.wallId, s] as const));
  const walls = [...f.walls]
    .map(w => ({ w, len: Math.round(wallLength(f, w)), stub: false }))
    .sort((a, b) => a.len - b.len);
  for (const row of walls) row.stub = row.len < Math.max(MIN_WALL_MM, row.w.thickness);

  const list = el("div", "zone-list");
  for (const { w, len, stub } of walls) list.append(wallRow(store, tools, w, len, stub, area.get(w.id)));
  const note = el("div", "prop-note");
  note.textContent = t("panel.wallListNote");
  const body = el("div");
  body.append(list, note);

  const fold = foldOut({
    id: "wg-wall-list",
    label: t("panel.wallList"),
    count: walls.length,
    open: tools.wallListOpen,
    content: body,
    onToggle: open => { tools.wallListOpen = open; },
  });
  if (walls.some(x => x.stub)) {
    fold.head.classList.add("is-warn");
    fold.head.title = t("panel.wallListStub");
  }
  host.append(fold.head, fold.body);
}

/**
 * One wall: its length, its thickness and net face area, and a bin. `stub`
 * marks it as shorter than it is thick, which is a length nothing can be built
 * to. `surface` is absent for a degenerate wall, which resolveFloor() drops and
 * so has no face to state.
 */
function wallRow(
  store: Store, tools: Tools, w: Wall, len: number, stub: boolean, surface?: WallSurface,
): HTMLElement {
  const f = store.floor;
  const row = el("div", "zone-row");
  const b = el("button", "zone") as HTMLButtonElement;
  b.type = "button";
  if (stub) b.title = t("panel.wallListStub");
  b.append(
    Object.assign(el("span", "zone-name" + (stub ? " is-warn" : "")),
      { textContent: t("panel.wallListLength", { mm: len }) }),
    Object.assign(el("span", "zone-area"), {
      textContent: surface
        ? t("panel.wallListMeta", { mm: w.thickness, area: sqm(surface.finishMm2) })
        : t("panel.wallListThickness", { mm: w.thickness }),
    }),
  );
  b.onclick = () => {
    const a = f.nodes.find(n => n.id === w.a), z = f.nodes.find(n => n.id === w.b);
    store.select({ kind: "wall", id: w.id });
    if (a && z) tools.fitWorldBox(v(a.x, a.y), v(z.x, z.y));
  };
  const bin = el("button", "zone-edit") as HTMLButtonElement;
  bin.type = "button";
  bin.title = t("panel.deleteWall");
  bin.setAttribute("aria-label", t("panel.deleteWall"));
  bin.append(icon("trash", 15));
  // Through the selection, so this is the same delete the canvas and the wall
  // pane perform -- including the room names it orphans.
  bin.onclick = () => { store.select({ kind: "wall", id: w.id }); tools.deleteSelected(); };
  row.append(b, bin);
  return row;
}

function shapeTile(shape: WallShape, active: boolean, onPick: () => void): HTMLButtonElement {
  const b = el("button", "sym-tile shape-tile") as HTMLButtonElement;
  b.type = "button";
  const label = t("shape." + shape);
  b.title = label;
  b.setAttribute("aria-pressed", String(active));
  if (active) b.classList.add("is-active");
  b.append(icon(SHAPE_ICON[shape], 30), Object.assign(el("span"), { textContent: label }));
  b.onclick = onPick;
  return b;
}

function el(tag: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
