// Straight flights: everything whose walking line is one line.
import { stairParams } from "../../model/stair";
import { v, Vec } from "../../geometry/vec";
import { cutTread } from "../../core/stair";
import { StairDef, withCtx, box, seg, treadLines, walkArrow, breakLine, clipSeg } from "./defs";

/** Wheeling gutter down each side of a rijstroken flight, mm. */
const GUTTER = 200;
/** Balustrade band on each side of an escalator, mm. */
const BALUSTRADE = 250;
/** How far a scheluw tread rakes off square, as a slope. 0.4 is about 22 degrees. */
const RAKE = 0.4;
/** Clearance between the arrow and the head of the flight, mm. */
const NOSE = 60;

/** The walking line up the middle of a flight, kept long enough to carry a head. */
export function axisArrow(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number): void {
  const from = Math.min(y0, y1 - 220);
  walkArrow(ctx, [v(x, from), v(x, y1)]);
}

export const STAIRS_STRAIGHT: StairDef[] = [
  {
    kind: "steektrap",
    label: "Straight flight",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const L = s.treads * p.going;
        box(ctx, -p.width / 2, 0, p.width, L);
        treadLines(ctx, -p.width / 2, p.width / 2, 0, p.going, s.treads);
        axisArrow(ctx, 0, p.going * 0.5, L - NOSE);
      });
    },
  },
  {
    kind: "steektrap-boven-elkaar",
    label: "Flights over each other",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const L = s.treads * p.going;
        box(ctx, -p.width / 2, 0, p.width, L);
        treadLines(ctx, -p.width / 2, p.width / 2, 0, p.going, s.treads);
        // The cut sits where the flight passes the section plane, which follows
        // from the optrede: on a shallow flight that is nowhere near halfway.
        const cutAt = cutTread(s) * p.going;
        breakLine(ctx, -p.width / 2, p.width / 2, cutAt, p.width * 0.5);
        axisArrow(ctx, 0, p.going * 0.5, L - NOSE);
      });
    },
  },
  {
    kind: "steektrap-scheluw",
    label: "Raking flight",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const L = s.treads * p.going;
        const half = p.width / 2;
        const bounds = { x0: -half, y0: 0, x1: half, y1: L };
        box(ctx, -half, 0, p.width, L);
        // Treads rake off square, so near the ends they run out through the
        // sides of the flight rather than reaching both stringers.
        const reach = p.width;
        for (let i = 1; i < s.treads; i++) {
          const y = i * p.going;
          const a: Vec = v(-reach, y + reach * RAKE);
          const b: Vec = v(reach, y - reach * RAKE);
          const cut = clipSeg(a, b, bounds);
          if (cut) seg(ctx, cut[0].x, cut[0].y, cut[1].x, cut[1].y);
        }
        axisArrow(ctx, 0, p.going * 0.5, L - NOSE);
      });
    },
  },
  {
    kind: "rijstroken",
    label: "Flight with wheeling gutters",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const L = s.treads * p.going;
        const half = p.width / 2;
        const inner = Math.max(60, half - GUTTER);
        box(ctx, -half, 0, p.width, L);
        seg(ctx, -inner, 0, -inner, L);
        seg(ctx, inner, 0, inner, L);
        // Treads stop at the gutters: the strips are ramps to wheel a bicycle
        // up, which is the whole reason the stair is drawn this way.
        treadLines(ctx, -inner, inner, 0, p.going, s.treads);
        axisArrow(ctx, 0, p.going * 0.5, L - NOSE);
      });
    },
  },
  {
    kind: "roltrap",
    label: "Escalator",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const L = s.treads * p.going;
        const half = p.width / 2;
        const inner = Math.max(80, half - BALUSTRADE);
        box(ctx, -half, 0, p.width, L);
        box(ctx, -inner, 0, inner * 2, L);
        treadLines(ctx, -inner, inner, 0, p.going, s.treads);
        axisArrow(ctx, 0, p.going * 0.5, L - NOSE);
      });
    },
  },
  {
    kind: "vlizotrap",
    label: "Loft ladder with hatch",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const L = s.treads * p.going;
        const half = p.width / 2;
        // The hatch is the opening; the frame is the line inside it. The ladder
        // is drawn where it lands when it is pulled down.
        box(ctx, -half, 0, p.width, L);
        box(ctx, -half + 60, 60, p.width - 120, L - 120);
        const rail = Math.max(80, p.width * 0.3);
        seg(ctx, -rail, 120, -rail, L - 120);
        seg(ctx, rail, 120, rail, L - 120);
        for (let i = 1; i < s.treads; i++) {
          const y = 120 + ((L - 240) * i) / s.treads;
          seg(ctx, -rail, y, rail, y);
        }
        axisArrow(ctx, 0, 200, L - 160);
      });
    },
  },
];
