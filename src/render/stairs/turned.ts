// Stairs that change direction: a landing between two flights, or a quarter of
// winders at one or both ends.
//
// A quarter turns inside a square the width of the flight, which is why the
// footprint of a kwartslag stair is still a rectangle — only longer. The
// winders fan from the inside corner of the turn, and the walking line bends
// through the middle of that square and leaves by its side.
import { stairParams } from "../../model/stair";
import { landingSplit, stairRun, straightTreads, WINDERS_PER_QUARTER } from "../../core/stair";
import { v } from "../../geometry/vec";
import { StairDef, withCtx, box, seg, arcPath, treadLines, walkArrow, winderFan } from "./defs";

const NOSE = 60;
const DEG = Math.PI / 180;

export const STAIRS_TURNED: StairDef[] = [
  {
    kind: "bordestrap",
    label: "Stair with landing",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const split = landingSplit(s);
        const total = 2 * p.width + p.well;
        const half = total / 2;
        const rise = split.lower * p.going;      // head of the lower flight
        const landing = p.width;                 // as deep as a flight is wide
        const depth = rise + landing;
        const midL = -(p.well / 2 + p.width / 2);
        const midR = p.well / 2 + p.width / 2;

        box(ctx, -half, 0, total, depth);
        seg(ctx, -half, rise, half, rise);       // the landing's near edge

        treadLines(ctx, -half, -p.well / 2, 0, p.going, split.lower);
        // The upper flight comes back down the sheet: its treads are measured
        // from the landing, so an odd tread count leaves the short step at its
        // foot rather than a half tread in the middle of the run.
        const upperFoot = rise - split.upper * p.going;
        for (let i = 1; i < split.upper; i++) {
          const y = rise - i * p.going;
          seg(ctx, p.well / 2, y, half, y);
        }
        if (upperFoot > 1) seg(ctx, p.well / 2, upperFoot, half, upperFoot);

        // The well between the flights, closed with a round end at the landing.
        if (p.well > 1) {
          const r = p.well / 2;
          seg(ctx, -r, 0, -r, rise - r);
          arcPath(ctx, v(0, rise - r), r, Math.PI, Math.PI * 2);
          seg(ctx, r, rise - r, r, 0);
        } else {
          seg(ctx, 0, 0, 0, rise);
        }

        walkArrow(ctx, [
          v(midL, p.going * 0.5),
          v(midL, rise + landing / 2),
          v(midR, rise + landing / 2),
          v(midR, Math.max(NOSE, upperFoot + p.going * 0.5)),
        ]);
      });
    },
  },
  {
    kind: "bovenkwart",
    label: "Quarter turn at the top",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const w = p.width, half = w / 2;
        const run = stairRun(s);
        const depth = run + w;
        box(ctx, -half, 0, w, depth);
        treadLines(ctx, -half, half, 0, p.going, straightTreads(s));
        seg(ctx, -half, run, half, run);
        // Inside corner of the turn: the flight arrives from below and leaves
        // to the right, so the winders pivot on the corner between those edges.
        winderFan(ctx, v(half, run), 180 * DEG, 90 * DEG, WINDERS_PER_QUARTER,
          { x0: -half, y0: run, x1: half, y1: depth });
        walkArrow(ctx, [v(0, p.going * 0.5), v(0, run + w / 2), v(half - NOSE, run + w / 2)]);
      });
    },
  },
  {
    kind: "onderkwart",
    label: "Quarter turn at the foot",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const w = p.width, half = w / 2;
        const run = stairRun(s);
        const depth = w + run;
        box(ctx, -half, 0, w, depth);
        seg(ctx, -half, w, half, w);
        treadLines(ctx, -half, half, w, p.going, straightTreads(s));
        winderFan(ctx, v(half, w), -90 * DEG, -180 * DEG, WINDERS_PER_QUARTER,
          { x0: -half, y0: 0, x1: half, y1: w });
        walkArrow(ctx, [v(half - NOSE, w / 2), v(0, w / 2), v(0, depth - NOSE)]);
      });
    },
  },
  {
    kind: "onder-bovenkwart",
    label: "Quarter turn at both ends",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const w = p.width, half = w / 2;
        const run = stairRun(s);
        const top = w + run;
        const depth = top + w;
        box(ctx, -half, 0, w, depth);
        seg(ctx, -half, w, half, w);
        seg(ctx, -half, top, half, top);
        treadLines(ctx, -half, half, w, p.going, straightTreads(s));
        // The two quarters turn opposite ways: a stair that turns the same way
        // twice is a bordestrap, which is its own kind.
        winderFan(ctx, v(half, w), -90 * DEG, -180 * DEG, WINDERS_PER_QUARTER,
          { x0: -half, y0: 0, x1: half, y1: w });
        winderFan(ctx, v(-half, top), 0, 90 * DEG, WINDERS_PER_QUARTER,
          { x0: -half, y0: top, x1: half, y1: depth });
        walkArrow(ctx, [
          v(half - NOSE, w / 2), v(0, w / 2), v(0, top + w / 2), v(-half + NOSE, top + w / 2),
        ]);
      });
    },
  },
];
