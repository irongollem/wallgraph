// SVG icon set for the sidebar. Every icon is authored on a 20x20 grid and
// built from the same tiny shape table below, so adding one is a data change,
// not a new function. door/window/passage deliberately share their wall-stub
// and jamb-return geometry -- what fills the gap (a leaf + swing arc, two
// sash lines, or nothing) is the whole differentiator, mirroring how the plan
// itself draws the three opening kinds.

const SVG_NS = "http://www.w3.org/2000/svg";

type Shape =
  | { kind: "path"; d: string; fill?: boolean }
  | { kind: "circle"; cx: number; cy: number; r: number; fill?: boolean }
  | { kind: "rect"; x: number; y: number; w: number; h: number; rx: number; fill?: boolean };

function P(d: string): Shape {
  return { kind: "path", d };
}

function C(cx: number, cy: number, r: number, fill = false): Shape {
  return { kind: "circle", cx, cy, r, fill };
}

function R(x: number, y: number, w: number, h: number, rx: number, fill = false): Shape {
  return { kind: "rect", x, y, w, h, rx, fill };
}

export type IconName =
  | "select" | "wall" | "door" | "window" | "passage" | "stair" | "vide" | "symbols"
  | "cabinet" | "roomName" | "zoom"
  | "gridSnap" | "angleSnap" | "dimensions"
  | "undo" | "redo" | "dots" | "chevron" | "plus" | "minus" | "close"
  | "trash" | "search" | "floors"
  | "docNew" | "docDemo" | "docOpen" | "docSave" | "docPng" | "docDxf" | "docSvg" | "docCopy" | "docPaste";

const ICONS: Record<IconName, Shape[]> = {
  select: [P("M5.5 3.2 L5.5 15.4 L8.7 12.4 L10.9 17 L13.2 16 L11 11.4 L15.2 11.2 Z")],
  wall: [P("M3.2 4.2 H16.8 M3.2 7.6 H13.4 M3.2 4.2 V7.6 M16.8 4.2 V16.8 M13.4 7.6 V16.8 M13.4 16.8 H16.8")],
  door: [
    P("M2 4 H7 M2 8 H7 M7 4 V8 M16 4 H18 M16 8 H18 M16 4 V8 M7 8 V17"),
    P("M16 8 A9 9 0 0 1 7 17"),
  ],
  window: [
    P("M2 8 H7 M2 12 H7 M7 8 V12 M13 8 H18 M13 12 H18 M13 8 V12 M7 9.3 H13 M7 10.7 H13"),
  ],
  passage: [
    P("M2 8 H7.5 M2 12 H7.5 M7.5 8 V12 M12.5 8 H18 M12.5 12 H18 M12.5 8 V12"),
  ],
  // A flight seen in plan: stringers, treads, and the arrow that says which
  // way is up -- the same three marks the drawing itself carries.
  stair: [
    P("M5 3 H15 V17 H5 Z M5 6.5 H15 M5 10 H15 M5 13.5 H15"),
    P("M10 16 V5.4 M7.8 7.6 L10 5.4 L12.2 7.6"),
  ],
  // An opening in the floor: its outline, crossed corner to corner -- the mark
  // the plan itself uses for a hole with no floor in it.
  vide: [P("M4 4 H16 V16 H4 Z M4 4 L16 16 M16 4 L4 16")],
  // A unit in plan: the carcass, the front band across it, and the diagonal
  // that says which end the door is hung on -- what the drawing itself shows.
  cabinet: [P("M3.4 4 H16.6 V15 H3.4 Z M3.4 12.8 H16.6 M3.4 12.8 L16.6 4")],
  // A room with its name written in it: the outline and two lines of text.
  roomName: [P("M3 4.5 H17 V15.5 H3 Z"), P("M6 9.4 H14 M6 12.2 H11")],
  // A lens over a plan, with the plus that says it frames rather than pans.
  zoom: [
    C(9, 9, 5.4),
    P("M12.9 12.9 L17 17"),
    P("M6.6 9 H11.4 M9 6.6 V11.4"),
  ],
  symbols: [C(10, 10, 6), P("M5.8 5.8 L14.2 14.2 M14.2 5.8 L5.8 14.2")],
  gridSnap: [
    P("M4 4 H16 M4 10 H16 M4 16 H16 M4 4 V16 M10 4 V16 M16 4 V16"),
    C(10, 10, 2.1, true),
  ],
  angleSnap: [
    P("M5 4.6 V16 H16.4 M5 13.2 H7.8 V16"),
    P("M5 9 A7 7 0 0 1 12 16"),
  ],
  dimensions: [
    P("M4 5.4 V14.6 M16 5.4 V14.6 M4 10 H16 M6.6 8 L4 10 L6.6 12 M13.4 8 L16 10 L13.4 12"),
  ],
  undo: [P("M8.2 5.6 L4.2 9.6 L8.2 13.6 M4.2 9.6 H12.4 A4.2 4.2 0 0 1 12.4 18 H8.6")],
  redo: [P("M11.8 5.6 L15.8 9.6 L11.8 13.6 M15.8 9.6 H7.6 A4.2 4.2 0 0 0 7.6 18 H11.4")],
  dots: [C(5, 10, 1.5, true), C(10, 10, 1.5, true), C(15, 10, 1.5, true)],
  chevron: [P("M6.5 8.5 L10 12 L13.5 8.5")],
  plus: [P("M10 5 V15 M5 10 H15")],
  minus: [P("M5 10 H15")],
  close: [P("M6 6 L14 14 M14 6 L6 14")],
  trash: [P("M4.6 6.2 H15.4 M8.2 6.2 V4.6 H11.8 V6.2 M6.2 6.2 V16 H13.8 V6.2 M8.6 8.8 V13.6 M11.4 8.8 V13.6")],
  search: [C(9, 9, 5), P("M12.8 12.8 L16.5 16.5")],
  floors: [P("M10 3.6 L17 7.2 L10 10.8 L3 7.2 Z M3 11.4 L10 15 L17 11.4")],
  docNew: [P("M5.2 3.4 H11.6 L14.8 6.6 V16.6 H5.2 Z M11.6 3.4 V6.6 H14.8")],
  docDemo: [P("M3.4 4.6 H16.6 V15.4 H3.4 Z M9.6 4.6 V15.4 M9.6 10 H16.6")],
  docOpen: [P("M3.2 15.8 V5.4 H8 L9.6 7.4 H16.8 V15.8 Z")],
  docSave: [P("M10 3.8 V12.6 M6.6 9.2 L10 12.6 L13.4 9.2 M4 16.2 H16")],
  docPng: [
    R(3.4, 5, 13.2, 10, 1.2),
    P("M3.4 12.4 L7.4 8.6 L10.6 11.6 L12.8 9.8 L16.6 13.4"),
    C(12.9, 8.1, 1.1, true),
  ],
  // Geometry rather than a picture: a wall corner, an arc, and a dimension line
  // with ticks -- what a CAD file carries that a PNG does not.
  docDxf: [
    P("M3.4 4 V13.4 H12.8"),
    P("M12.8 13.4 A9.4 9.4 0 0 0 3.4 4"),
    P("M3.4 16.6 H16.6 M3.4 15.4 V17.8 M16.6 15.4 V17.8"),
  ],
  // Vector artwork: a curve with its control points, the universal shorthand
  // for "this scales" as against docPng's raster frame.
  docSvg: [
    P("M3 15.6 C3 7.6 15.6 12.4 15.6 4.4"),
    C(3, 15.6, 1.6, true),
    C(15.6, 4.4, 1.6, false),
  ],
  docCopy: [
    R(7.4, 7.4, 9.2, 9.2, 1.4),
    P("M12.8 4.6 H4.9 a1.3 1.3 0 0 0 -1.3 1.3 V12.6"),
  ],
  docPaste: [
    P("M7.8 4.6 H5.4 a1.2 1.2 0 0 0 -1.2 1.2 V16.4 a1.2 1.2 0 0 0 1.2 1.2 H14.6 a1.2 1.2 0 0 0 1.2 -1.2 V5.8 a1.2 1.2 0 0 0 -1.2 -1.2 H12.2"),
    R(7.8, 2.9, 4.4, 3.4, 1),
  ],
};

/** Builds a fresh <svg> element. size is the rendered px box (default 20). */
export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");

  for (const shape of ICONS[name]) {
    let el: SVGElement;
    if (shape.kind === "path") {
      el = document.createElementNS(SVG_NS, "path");
      el.setAttribute("d", shape.d);
    } else if (shape.kind === "circle") {
      el = document.createElementNS(SVG_NS, "circle");
      el.setAttribute("cx", String(shape.cx));
      el.setAttribute("cy", String(shape.cy));
      el.setAttribute("r", String(shape.r));
    } else {
      el = document.createElementNS(SVG_NS, "rect");
      el.setAttribute("x", String(shape.x));
      el.setAttribute("y", String(shape.y));
      el.setAttribute("width", String(shape.w));
      el.setAttribute("height", String(shape.h));
      el.setAttribute("rx", String(shape.rx));
    }
    if (shape.fill) {
      el.setAttribute("fill", "currentColor");
      el.setAttribute("stroke", "none");
    }
    svg.appendChild(el);
  }

  return svg;
}
