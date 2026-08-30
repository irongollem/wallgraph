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
