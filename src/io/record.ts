// Replays a symbol's canvas drawing as plain geometry.
//
// The symbol library draws with canvas calls against a contract (1 unit = 1 mm,
// caller owns colour). Rather than maintain a second, hand-written outline for
// every symbol in the library — which would drift the first time somebody edited
// one — an export replays `draw()` against an object that implements just
// enough of CanvasRenderingContext2D to capture the path.
//
// Curves flatten to polylines. A symbol may be rotated, mirrored and scaled, and
// working out how an arbitrary transform maps onto a CAD arc is guesswork that
// gets mirrored symbols subtly wrong; at symbol scale a 32-segment circle is
// indistinguishable and always correct.
import { Vec } from "../geometry/vec";

export type Prim =
  | { kind: "line"; a: Vec; b: Vec }
  | { kind: "poly"; pts: Vec[]; closed: boolean }
  | { kind: "text"; at: Vec; size: number; text: string }
  /** Angles in degrees, document (y-down) space; sweep is signed and short-way. */
  | { kind: "arc"; c: Vec; r: number; start: number; sweep: number };

/** 2x3 affine transform, same layout as canvas: [a c e; b d f]. */
interface M { a: number; b: number; c: number; d: number; e: number; f: number }

const IDENTITY: M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const mul = (m: M, n: M): M => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
});
const apply = (m: M, x: number, y: number): Vec => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f,
});

const ARC_SEGMENTS = 32;

/**
 * The subset of CanvasRenderingContext2D the symbol library uses. Colour and
 * line-width setters are accepted and ignored: the contract says the caller owns
 * them, and a CAD layer carries that instead.
 */
class Recorder {
  prims: Prim[] = [];
  private m: M = IDENTITY;
  private stack: M[] = [];
  private sub: Vec[][] = [];
  private cur: Vec[] = [];

  // — colour and style: accepted, discarded —
  strokeStyle = ""; fillStyle = ""; lineWidth = 1; font = ""; lineCap = ""; lineJoin = "";
  textAlign = ""; textBaseline = "";
  setLineDash(_d: number[]): void { /* dash is a screen concern */ }
  fillText(s: string, x: number, y: number): void { this.recordText(s, x, y); }
  strokeText(s: string, x: number, y: number): void { this.recordText(s, x, y); }

  private recordText(text: string, x: number, y: number): void {
    const fontSize = Number.parseFloat(this.font) || 12;
    const scale = Math.hypot(this.m.a, this.m.b) || 1;
    this.prims.push({ kind: "text", at: apply(this.m, x, y), size: fontSize * scale, text });
  }

  // — transform —
  save(): void { this.stack.push(this.m); }
  restore(): void { this.m = this.stack.pop() ?? IDENTITY; }
  translate(x: number, y: number): void { this.m = mul(this.m, { ...IDENTITY, e: x, f: y }); }
  scale(x: number, y: number): void { this.m = mul(this.m, { ...IDENTITY, a: x, d: y }); }
  rotate(t: number): void {
    const cos = Math.cos(t), sin = Math.sin(t);
    this.m = mul(this.m, { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.m = { a, b, c, d, e, f };
  }
  getTransform(): M { return this.m; }

  // — path —
  beginPath(): void { this.flushPath(); }
  closePath(): void {
    if (this.cur.length > 1) { this.cur.push(this.cur[0]!); this.pushSub(); }
  }
  moveTo(x: number, y: number): void { this.pushSub(); this.cur = [apply(this.m, x, y)]; }
  lineTo(x: number, y: number): void { this.cur.push(apply(this.m, x, y)); }

  arc(cx: number, cy: number, r: number, a0: number, a1: number, ccw = false): void {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep += Math.PI * 2;
    if (ccw && sweep > 0) sweep -= Math.PI * 2;
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * ARC_SEGMENTS));
    for (let i = 0; i <= steps; i++) {
      const t = a0 + (sweep * i) / steps;
      this.cur.push(apply(this.m, cx + Math.cos(t) * r, cy + Math.sin(t) * r));
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, rot: number,
          a0: number, a1: number, ccw = false): void {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep += Math.PI * 2;
    if (ccw && sweep > 0) sweep -= Math.PI * 2;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * ARC_SEGMENTS));
    for (let i = 0; i <= steps; i++) {
      const t = a0 + (sweep * i) / steps;
      const px = Math.cos(t) * rx, py = Math.sin(t) * ry;
      this.cur.push(apply(this.m, cx + px * cosR - py * sinR, cy + px * sinR + py * cosR));
    }
  }

  /** Corner fillet between the current point and (x2,y2), via (x1,y1). */
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    // A faithful arcTo needs the current point in local space, which the
    // recorder does not keep. The tangent corner is visually a rounded corner,
    // and at symbol scale the corner point itself is within a millimetre of it.
    void r;
    this.cur.push(apply(this.m, x1, y1));
    this.cur.push(apply(this.m, x2, y2));
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const from = this.cur[this.cur.length - 1];
    const to = apply(this.m, x, y);
    const ctrl = apply(this.m, cx, cy);
    if (!from) { this.cur.push(to); return; }
    for (let i = 1; i <= 12; i++) {
      const t = i / 12, u = 1 - t;
      this.cur.push({
        x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x,
        y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y,
      });
    }
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.pushSub();
    this.cur = [
      apply(this.m, x, y), apply(this.m, x + w, y),
      apply(this.m, x + w, y + h), apply(this.m, x, y + h),
      apply(this.m, x, y),
    ];
    this.pushSub();
  }
  strokeRect(x: number, y: number, w: number, h: number): void { this.rect(x, y, w, h); this.stroke(); }

  // — paint: both stroke and fill emit outlines; CAD has no fill for line work —
  stroke(): void { this.flushPath(); }
  fill(): void { this.flushPath(); }

  private pushSub(): void {
    if (this.cur.length > 1) this.sub.push(this.cur);
    this.cur = [];
  }

  private flushPath(): void {
    this.pushSub();
    for (const pts of this.sub) {
      const first = pts[0]!, last = pts[pts.length - 1]!;
      const closed = pts.length > 2
        && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6;
      this.prims.push({ kind: "poly", pts: closed ? pts.slice(0, -1) : pts, closed });
    }
    this.sub = [];
  }
}

/**
 * Geometry for one placed symbol, in world millimetres. The transform mirrors
 * drawSymbol() in the renderer exactly, so an export lands where the screen
 * shows it.
 */
export function recordSymbol(
  def: { draw(ctx: CanvasRenderingContext2D): void },
  x: number, y: number, rotation: number, mirrored: boolean,
): Prim[] {
  const rec = new Recorder();
  rec.translate(x, y);
  rec.rotate(rotation);
  if (mirrored) rec.scale(-1, 1);
  // The recorder implements the drawing subset the contract allows; the cast is
  // the seam between that contract and the full DOM type.
  def.draw(rec as unknown as CanvasRenderingContext2D);
  rec.stroke();
  return rec.prims;
}
