// The geometry an opening contributes to a drawing, as plain primitives.
//
// Both exporters need the same marks — jambs across the wall, a leaf and its
// swing arc for a hinged sash — and they must agree, or a DXF and an SVG of the
// same plan show different doors. Computing it once here is the only way to
// keep that true; the renderer draws to a canvas and cannot be reused for it.
//
// Angles are degrees in the document's own y-down space, and `sweep` is signed
// and already normalised to the short way round, because a door swings a
// quarter turn and not three quarters. Each exporter converts from there.
import { Opening, sashesOf } from "../model/doc";
import { ResolvedWall } from "../core/resolve";
import { Vec } from "../geometry/vec";
import { Prim } from "./record";

export function openingMarks(rw: ResolvedWall): Prim[] {
  const out: Prim[] = [];
  for (const og of rw.openings) {
    const o: Opening = og.opening;
    const h = og.half;
    // Jambs: a line across the wall at each end of the hole.
    out.push({
      kind: "line",
      a: { x: og.p0.x - og.n0.x * h, y: og.p0.y - og.n0.y * h },
      b: { x: og.p0.x + og.n0.x * h, y: og.p0.y + og.n0.y * h },
    });
    out.push({
      kind: "line",
      a: { x: og.p1.x - og.n1.x * h, y: og.p1.y - og.n1.y * h },
      b: { x: og.p1.x + og.n1.x * h, y: og.p1.y + og.n1.y * h },
    });

    // A window's frame: a line along each wall face across the hole, plus the
    // glass between them. Without it a window exports as an empty gap — the
    // wall simply stops and starts again, which reads as a doorway.
    if (o.kind === "window") {
      for (const off of [-h, h]) {
        out.push({
          kind: "line",
          a: { x: og.p0.x + og.n0.x * off, y: og.p0.y + og.n0.y * off },
          b: { x: og.p1.x + og.n1.x * off, y: og.p1.y + og.n1.y * off },
        });
      }
      out.push({ kind: "line", a: og.p0, b: og.p1 });
    }

    const span = Math.hypot(og.p1.x - og.p0.x, og.p1.y - og.p0.y);
    if (span <= 1) continue;
    const along: Vec = { x: (og.p1.x - og.p0.x) / span, y: (og.p1.y - og.p0.y) / span };
    let cursor = 0;
    for (const sash of sashesOf(o, span)) {
      const a: Vec = { x: og.p0.x + along.x * cursor, y: og.p0.y + along.y * cursor };
      const b: Vec = {
        x: og.p0.x + along.x * (cursor + sash.width),
        y: og.p0.y + along.y * (cursor + sash.width),
      };
      cursor += sash.width;
      if (cursor < span - 1 && o.kind === "window") {
        out.push({
          kind: "line",
          a: { x: b.x - og.n0.x * h, y: b.y - og.n0.y * h },
          b: { x: b.x + og.n0.x * h, y: b.y + og.n0.y * h },
        });
      }
      const swings = sash.action === "turn" || sash.action === "turn-tilt"
        || sash.action === "turn-slide" || sash.action === "double-acting";
      if (!swings || sash.width <= 1) continue;

      const hingeAtA = (sash.hinge ?? "a") !== "b";
      const hinge = hingeAtA ? a : b;
      const other = hingeAtA ? b : a;
      const dir: Vec = {
        x: (other.x - hinge.x) / sash.width,
        y: (other.y - hinge.y) / sash.width,
      };
      // perp() is (x,y) -> (-y,x); opening outward flips it.
      const sign = sash.outward === true ? -1 : 1;
      const swing: Vec = { x: -dir.y * sign, y: dir.x * sign };
      const tip: Vec = {
        x: hinge.x + swing.x * sash.width,
        y: hinge.y + swing.y * sash.width,
      };
      out.push({ kind: "line", a: hinge, b: tip });

      const start = Math.atan2(other.y - hinge.y, other.x - hinge.x) * 180 / Math.PI;
      const end = Math.atan2(tip.y - hinge.y, tip.x - hinge.x) * 180 / Math.PI;
      let sweep = end - start;
      while (sweep > 180) sweep -= 360;
      while (sweep < -180) sweep += 360;
      out.push({ kind: "arc", c: hinge, r: sash.width, start, sweep });
    }
  }
  return out;
}
