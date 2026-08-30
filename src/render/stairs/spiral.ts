// Stairs that wind: spiltrap around a newel, wenteltrap around an open well.
//
// The angle each tread takes is not stored. It is what the going asks for at
// the walking line — the radius two thirds out, where a winding stair is
// measured — so a deeper tread takes a wider bite of the circle and the flight
// comes round in fewer of them. See spiralOf() in core/stair.ts.
import { spiralOf } from "../../core/stair";
import { v } from "../../geometry/vec";
import { StairDef, withCtx, box, seg, circle, arcPath, walkArrowArc, rayExit } from "./defs";

export const STAIRS_SPIRAL: StairDef[] = [
  {
    kind: "spiltrap-recht",
    label: "Spiral stair in a square well",
    draw(ctx, s) {
      withCtx(ctx, () => {
        const g = spiralOf(s);
        const side = g.outer * 2;
        const bounds = { x0: -g.outer, y0: 0, x1: g.outer, y1: side };
        box(ctx, -g.outer, 0, side, side);
        circle(ctx, g.c, g.inner);
        // Treads reach the wall of the well rather than a circle, which is what
        // makes this the square variant.
        for (let i = 0; i <= s.treads; i++) {
          const a = g.start + i * g.step;
          const d = v(Math.cos(a), Math.sin(a));
          const from = v(g.c.x + d.x * g.inner, g.c.y + d.y * g.inner);
          const to = rayExit(g.c, d, bounds);
          if (to) seg(ctx, from.x, from.y, to.x, to.y);
        }
        walkArrowArc(ctx, g.c, g.walk, g.start + g.step * 0.5, g.start + g.sweep - g.step * 0.3);
      });
    },
  },
  {
    kind: "spiltrap-rond",
    label: "Spiral stair in a round well",
    region(ctx, s) {
      const g = spiralOf(s);
      ctx.arc(g.c.x, g.c.y, g.outer, 0, Math.PI * 2);
    },
    draw(ctx, s) {
      withCtx(ctx, () => {
        const g = spiralOf(s);
        circle(ctx, g.c, g.outer);
        circle(ctx, g.c, g.inner);
        for (let i = 0; i <= s.treads; i++) {
          const a = g.start + i * g.step;
          const c = Math.cos(a), sn = Math.sin(a);
          seg(ctx, g.c.x + c * g.inner, g.c.y + sn * g.inner, g.c.x + c * g.outer, g.c.y + sn * g.outer);
        }
        walkArrowArc(ctx, g.c, g.walk, g.start + g.step * 0.5, g.start + g.sweep - g.step * 0.3);
      });
    },
  },
  {
    kind: "wenteltrap",
    label: "Helical stair",
    region(ctx, s) {
      // The annulus the flight sweeps, not the circle it sits in: a wenteltrap
      // leaves its well open, and the wash must leave it open too.
      const g = spiralOf(s);
      const end = g.start + g.sweep;
      ctx.arc(g.c.x, g.c.y, g.outer, g.start, end);
      ctx.arc(g.c.x, g.c.y, g.inner, end, g.start, true);
      ctx.closePath();
    },
    draw(ctx, s) {
      withCtx(ctx, () => {
        const g = spiralOf(s);
        const end = g.start + g.sweep;
        // An open well: the flight is an arc of an annulus, not a full circle,
        // so both ends are drawn and the treads stop where the stair does.
        arcPath(ctx, g.c, g.outer, g.start, end);
        arcPath(ctx, g.c, g.inner, g.start, end);
        for (let i = 0; i <= s.treads; i++) {
          const a = g.start + i * g.step;
          const c = Math.cos(a), sn = Math.sin(a);
          seg(ctx, g.c.x + c * g.inner, g.c.y + sn * g.inner, g.c.x + c * g.outer, g.c.y + sn * g.outer);
        }
        walkArrowArc(ctx, g.c, g.walk, g.start + g.step * 0.5, end - g.step * 0.3);
      });
    },
  },
];
