// The wall pane: what the NEXT wall is drawn with -- the shape it is struck out
// in, how thick it is, and whatever that shape needs to know.
//
// The shapes are here because a room is rarely four separate decisions. A
// rectangle is two clicks and leaves four ordinary walls behind: the shape is
// how they were entered, not something the document keeps (see model/shape.ts).
import { Tools } from "../input/tools";
import {
  WALL_SHAPES, POLYGON_MIN_SIDES, POLYGON_MAX_SIDES, type WallShape,
} from "../model/shape";
import { WALL_MATERIALS, POST_DEFAULT_MM, POST_WIDTH_DEFAULT, type WallMaterial } from "../model/doc";
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
  host: HTMLElement, tools: Tools, rows: PaneRows, onPick: () => void,
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
