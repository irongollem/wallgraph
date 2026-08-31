// The geometry one resolved route contributes to an export, as plain
// primitives: a line per straight segment, a real ARC entity per bulged one
// (the corridor fan in core/route.ts only ever offsets straight segments, so
// every arc reaching here is exactly as drawn). No dash pattern and no
// waypoint marks -- those are canvas-only reading aids, not part of the
// service run's geometry. An electrical data run (utp/coax) is drawn dashed,
// but not here: the recorder/prims path this feeds cannot carry a dash (the
// same reasoning io/dxf.ts documents for CABINETS-OVERHEAD), so io/svg.ts
// carries it on the SVG group and io/dxf.ts on its own DXF layer instead.
import { ResolvedRoute } from "../core/route";
import { arcInfo, sweepOf } from "../geometry/arc";
import { Prim } from "./record";
import type { ResolvedRiserMark } from "../core/continuation";

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

/** Cross-floor plan mark in the same geometry vocabulary SVG and DXF share. */
export function riserPrims(mark: ResolvedRiserMark): Prim[] {
  const rim = Array.from({ length: 20 }, (_, i) => {
    const angle = (i / 20) * Math.PI * 2;
    return { x: mark.at.x + Math.cos(angle) * 78, y: mark.at.y + Math.sin(angle) * 78 };
  });
  const out: Prim[] = [{ kind: "poly", closed: true, pts: rim }];
  const head = (sign: -1 | 1): void => {
    const y = mark.at.y + sign * 48;
    out.push({ kind: "poly", closed: true, pts: [
      { x: mark.at.x, y: y + sign * 38 },
      { x: mark.at.x - 38, y: y - sign * 8 },
      { x: mark.at.x + 38, y: y - sign * 8 },
    ] });
  };
  if (mark.direction !== "down") head(-1);
  if (mark.direction !== "up") head(1);
  if (mark.members.length > 1)
    out.push({ kind: "text", at: mark.at, size: 90, text: String(mark.members.length) });
  if (mark.tag)
    out.push({ kind: "text", at: { x: mark.at.x, y: mark.at.y + 153 }, size: 90, text: mark.tag });
  return out;
}
