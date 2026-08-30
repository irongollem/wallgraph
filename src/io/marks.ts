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
import { Opening, sashesOf, fireLabel } from "../model/doc";
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
      if (sash.width <= 1) continue;
      const n = og.n0;
      const face = sash.outward === true ? mul(n, -1) : n;

      if (sash.action === "slide" || sash.action === "turn-slide") {
        const off = h * 0.35;
        addLine(out, plus(a, mul(n, -off)), plus(plus(a, mul(along, sash.width * 0.6)), mul(n, -off)));
        addLine(out, plus(plus(a, mul(along, sash.width * 0.4)), mul(n, off)), plus(b, mul(n, off)));
        const toB = (sash.slideTo ?? "b") === "b";
        const dir = toB ? along : mul(along, -1);
        const base = plus(plus(a, mul(along, sash.width * (toB ? 0.55 : 0.85))), mul(n, off * 2.2));
        const tip = plus(base, mul(dir, sash.width * 0.3));
        addLine(out, base, tip);
        const back = mul(dir, -Math.min(60, sash.width * 0.12));
        const wing = mul(perp(dir), Math.min(40, sash.width * 0.08));
        addLine(out, tip, plus(plus(tip, back), wing));
        addLine(out, tip, plus(plus(tip, back), mul(wing, -1)));
      }

      if (sash.action === "turn" || sash.action === "turn-tilt" || sash.action === "turn-slide"
          || sash.action === "double-acting") {
        const signs = sash.action === "double-acting" ? [1, -1] : [sash.outward === true ? -1 : 1];
        for (const sign of signs) addSwing(out, sash.width, sash.hinge, a, b, sign);
      }

      if (sash.action === "fold") {
        const leaves = Math.max(2, Math.round(sash.width / 700));
        const step = sash.width / leaves;
        const depth = Math.min(step * 0.8, 500);
        for (let i = 0; i < leaves; i++) {
          const p0 = plus(a, mul(along, i * step));
          const p1 = plus(a, mul(along, (i + 1) * step));
          const peak = plus(plus(p0, mul(along, step * 0.5)), mul(face, i % 2 === 0 ? depth : depth * 0.25));
          addLine(out, p0, peak); addLine(out, peak, p1);
        }
      }

      if (sash.action === "revolve") {
        const mid = midpoint(a, b), r = sash.width * 0.5;
        const base = degrees(Math.atan2(along.y, along.x));
        out.push({ kind: "arc", c: mid, r, start: base - 49.5, sweep: 99 });
        out.push({ kind: "arc", c: mid, r, start: base + 130.5, sweep: 99 });
        for (let i = 0; i < 4; i++) {
          const ang = (base + 45 + i * 90) * Math.PI / 180;
          addLine(out, mid, plus(mid, { x: Math.cos(ang) * r, y: Math.sin(ang) * r }));
        }
      }

      if (sash.action === "overhead") {
        const off = mul(face, h * 0.45);
        addLine(out, plus(a, off), plus(b, off));
        addLine(out, a, plus(a, off)); addLine(out, b, plus(b, off));
        addLine(out, plus(a, mul(face, h * 0.9)), plus(b, mul(face, h * 0.9)));
      }

      if (sash.action === "pivot") {
        const mid = midpoint(a, b), r = sash.width * 0.5;
        addLine(out, plus(mid, mul(face, r)), plus(mid, mul(face, -r)));
        out.push({ kind: "arc", c: mid, r, start: 0, sweep: 180 });
        out.push({ kind: "arc", c: mid, r, start: 180, sweep: 180 });
      }

      if (["tilt", "turn-tilt", "tumble", "project", "parallel"].includes(sash.action)) {
        const mid = midpoint(a, b), depth = Math.min(sash.width * 0.28, 300);
        const apex = plus(mid, mul(face, depth * 0.35));
        const arm = mul(along, depth * 0.5);
        addLine(out, plus(plus(mid, arm), mul(face, depth)), apex);
        addLine(out, plus(plus(mid, mul(arm, -1)), mul(face, depth)), apex);
      }

      if (sash.action === "slide-vertical") {
        const mid = midpoint(a, b);
        addLine(out, plus(mid, mul(n, -h * 0.5)), plus(mid, mul(n, h * 0.5)));
      }

      const panes = sash.bars ?? 0;
      for (let i = 1; i < panes; i++) {
        const p = plus(a, mul(along, sash.width * i / panes));
        addLine(out, plus(p, mul(n, -h * 0.4)), plus(p, mul(n, h * 0.4)));
      }
    }

    // Compact, conventional annotations on the room side of the opening.
    const labels: string[] = [];
    if (o.powered) labels.push("E");
    if (o.selfClosing) labels.push("Z");
    if (o.fireRating) labels.push(fireLabel(o.fireRating));
    labels.forEach((text, i) => out.push({
      kind: "text", text, size: 120,
      at: plus(og.center, mul(og.n0, h + 120 + i * 140)),
    }));
  }
  return out;
}

function addSwing(out: Prim[], width: number, hingeEdge: string | undefined, a: Vec, b: Vec, sign: number): void {
  const hingeAtA = (hingeEdge ?? "a") !== "b";
  const hinge = hingeAtA ? a : b, other = hingeAtA ? b : a;
  const dir = mul({ x: other.x - hinge.x, y: other.y - hinge.y }, 1 / width);
  const tip = plus(hinge, mul(perp(dir), width * sign));
  addLine(out, hinge, tip);
  const start = degrees(Math.atan2(other.y - hinge.y, other.x - hinge.x));
  let sweep = degrees(Math.atan2(tip.y - hinge.y, tip.x - hinge.x)) - start;
  while (sweep > 180) sweep -= 360;
  while (sweep < -180) sweep += 360;
  out.push({ kind: "arc", c: hinge, r: width, start, sweep });
}

function addLine(out: Prim[], a: Vec, b: Vec): void { out.push({ kind: "line", a, b }); }
function plus(a: Vec, b: Vec): Vec { return { x: a.x + b.x, y: a.y + b.y }; }
function mul(a: Vec, n: number): Vec { return { x: a.x * n, y: a.y * n }; }
function perp(a: Vec): Vec { return { x: -a.y, y: a.x }; }
function midpoint(a: Vec, b: Vec): Vec { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function degrees(radians: number): number { return radians * 180 / Math.PI; }
