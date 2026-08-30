// The two entries on the sheet that are not flights of treads: irons set into a
// wall, and a ramp.
import { stairParams } from "../../model/stair";
import { KLIMIJZER_DEPTH } from "../../core/stair";
import { StairDef, withCtx, box, seg, walkArrow } from "./defs";
import { v } from "../../geometry/vec";

const NOSE = 60;

export const STAIRS_SPECIAL: StairDef[] = [
  {
    kind: "klimijzers",
    label: "Climbing irons",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const half = p.width / 2;
        // Irons stack up one line in the wall, so a plan shows them end-on: the
        // bar they are set into, with one iron projecting from it. Neither the
        // going nor the count is visible from above.
        ctx.beginPath();
        ctx.rect(-half, 0, p.width, 70);
        ctx.fill();
        const arm = Math.max(60, p.width * 0.25);
        seg(ctx, -arm, 70, -arm, KLIMIJZER_DEPTH - 40);
        seg(ctx, arm, 70, arm, KLIMIJZER_DEPTH - 40);
        seg(ctx, -arm, KLIMIJZER_DEPTH - 40, arm, KLIMIJZER_DEPTH - 40);
      });
    },
  },
  {
    kind: "hellingbaan",
    label: "Ramp",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const p = stairParams(s);
        const L = s.treads * p.going;
        const half = p.width / 2;
        // A ramp has no treads to draw: the outline and the direction of the
        // slope are the whole mark.
        box(ctx, -half, 0, p.width, L);
        walkArrow(ctx, [v(0, NOSE * 2), v(0, L - NOSE)]);
      });
    },
  },
];
