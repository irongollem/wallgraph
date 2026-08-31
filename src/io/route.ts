// The geometry one resolved route contributes to an export, as plain
// primitives: a line per straight segment, a real ARC entity per bulged one
// (the corridor fan in core/route.ts only ever offsets straight segments, so
// every arc reaching here is exactly as drawn). No dash pattern and no
// waypoint marks -- those are canvas-only reading aids, not part of the
// service run's geometry.
import { ResolvedRoute } from "../core/route";
import { arcInfo, sweepOf } from "../geometry/arc";
import { Prim } from "./record";

export function routePrims(resolved: ResolvedRoute): Prim[] {
  const out: Prim[] = [];
  for (const seg of resolved.segments) {
    if (seg.bulge === 0) { out.push({ kind: "line", a: seg.a, b: seg.b }); continue; }
    const info = arcInfo(seg.a, seg.b, seg.bulge);
    if (!info) { out.push({ kind: "line", a: seg.a, b: seg.b }); continue; }
    const sweep = sweepOf(info);
    out.push({
      kind: "arc", c: info.center, r: info.radius,
      start: (info.a0 * 180) / Math.PI, sweep: (sweep * 180) / Math.PI,
    });
  }
  return out;
}
