// A PDF writer, in the drawing subset a sheet needs.
//
// Wallgraph ships no runtime dependencies (see the licensing constraint in
// CLAUDE.md) and every PDF library is one. A PDF page's content is a plain
// text stream of postfix operators, and a sheet draws paths, arcs and short
// runs of text, so the writer is small enough to own outright.
//
// Deliberately absent: stream compression (the content stays readable, and a
// sheet is a few hundred kilobytes either way), embedded fonts (Helvetica is
// one of the fourteen faces every reader carries, so nothing has to be shipped
// or licensed) and images (a sheet carries none -- the underlay is a drawing
// aid that never leaves the editor).
//
// The file is assembled as a string of Latin-1 characters, one per byte, so
// the cross-reference table's byte offsets are plain string indices;
// `pdfBytes` widens it to bytes at the end.
import { Prim } from "./record";
import { Group, Item, Look, ROOT, arcSteps, onCircle, resolve } from "./scene";

/** PostScript points per millimetre: a PDF page is measured in points. */
const PT_PER_MM = 72 / 25.4;

/**
 * Where a `central` baseline puts the text origin, in em above the alphabetic
 * baseline. Half of Helvetica's cap height: the centred text on a sheet is
 * digits and the code letters of a symbol's mark, neither of which descends,
 * so centring on the cap box is what reads as centred.
 */
const CENTRAL_EM = 0.359;

const n = (v: number): string => {
  const r = Number(v.toFixed(4));
  return Object.is(r, -0) ? "0" : String(r);
};

interface Rgba { r: number; g: number; b: number; a: number }

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };

/**
 * A CSS colour as PDF components. "none" means no paint at all; anything
 * unreadable falls back to black rather than to nothing, because a dropped
 * colour must not silently drop the geometry with it.
 */
function color(v: string): Rgba | null {
  if (v === "none") return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!;
    const p = h.length === 3 ? [...h].map(c => parseInt(c + c, 16)) : [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    return { r: p[0]! / 255, g: p[1]! / 255, b: p[2]! / 255, a: 1 };
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(v);
  if (fn) {
    const p = fn[1]!.split(",").map(s => Number(s.trim()));
    if (p.length >= 3 && p.slice(0, 3).every(x => Number.isFinite(x))) {
      const a = p.length > 3 && Number.isFinite(p[3]!) ? p[3]! : 1;
      return { r: p[0]! / 255, g: p[1]! / 255, b: p[2]! / 255, a };
    }
  }
  return BLACK;
}

const rgb = (c: Rgba): string => `${n(c.r)} ${n(c.g)} ${n(c.b)}`;

/** Fill and stroke opacity of a resolved style; "none" contributes nothing. */
function opacity(look: Look): [number, number] {
  const f = look.fill === "none" ? 1 : (color(look.fill)?.a ?? 1);
  const s = look.ink === "none" ? 1 : (color(look.ink)?.a ?? 1);
  return [f, s];
}

// ── text: the core fonts, their advances, and WinAnsi ────────────────────────

/**
 * Advances per 1000 units for codes 32..126, from the core Helvetica metrics.
 * A PDF reader supplies the glyphs; the writer only has to know how wide they
 * are, because PDF has no text anchoring -- centring a string means placing
 * its origin half a width back.
 */
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/**
 * An accented Latin letter carries its base letter's advance in these faces:
 * the glyph is that letter plus a mark, and the mark adds no width.
 */
const ACCENTED = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ";
const ACCENT_BASE = "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy";

/** The punctuation a plan actually prints, regular and bold. */
const EXTRA: Record<string, [number, number]> = {
  "¹": [333, 333], "²": [333, 333], "³": [333, 333], "·": [278, 278], "°": [400, 400],
  "–": [556, 556], "—": [1000, 1000], "‘": [222, 238], "’": [222, 238],
  "“": [333, 500], "”": [333, 500], "•": [350, 350], "…": [1000, 1000], "€": [556, 556],
  "ß": [556, 611], "æ": [889, 889], "Æ": [1000, 1000], "ø": [611, 611], "Ø": [778, 778],
};

/** The commonest advance in both faces, for anything outside the tables. */
const W_DEFAULT = 556;

function advance(ch: string, bold: boolean): number {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REGULAR)[code - 32]!;
  const extra = EXTRA[ch];
  if (extra) return extra[bold ? 1 : 0];
  const i = ACCENTED.indexOf(ch);
  if (i >= 0) return advance(ACCENT_BASE[i]!, bold);
  return W_DEFAULT;
}

/** Width of a string in em, so a caller multiplies by the font size. */
export function textWidth(s: string, bold: boolean): number {
  let w = 0;
  for (const ch of s) w += advance(ch, bold);
  return w / 1000;
}

/** The WinAnsi slots that are not their own Unicode code point. */
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85,
  "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a,
  "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92,
  "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c,
  "ž": 0x9e, "Ÿ": 0x9f,
};

/** A string as a PDF literal, in the WinAnsi encoding the fonts declare. */
function pdfString(s: string): string {
  let out = "(";
  for (const ch of s) {
    const mapped = CP1252[ch];
    const code = ch.codePointAt(0) ?? 63;
    const b = mapped ?? ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) ? code : 63);
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += "\\" + b.toString(8).padStart(3, "0");
    else out += String.fromCharCode(b);
  }
  return out + ")";
}

/**
 * A string for the document information dictionary. Those are text strings,
 * which are read as PDFDocEncoding rather than WinAnsi -- the two disagree
 * about every byte from 0x80 up, so a title travels as UTF-16BE instead, which
 * the leading byte-order mark declares.
 */
function pdfTextString(s: string): string {
  let out = "(\\376\\377";
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    for (const b of [unit >> 8, unit & 0xff]) {
      if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
      else if (b < 32 || b > 126) out += "\\" + b.toString(8).padStart(3, "0");
      else out += String.fromCharCode(b);
    }
  }
  return out + ")";
}

// ── the content stream ───────────────────────────────────────────────────────

export interface PdfPage {
  /** Paper size. The scene is in paper millimetres; the page transform is the
   *  only place points appear. */
  widthMm: number;
  heightMm: number;
  background?: string;
  scene: readonly Item[];
}

/**
 * Walks a scene into page operators. PDF's origin is bottom-left with y up and
 * the document's is top-left with y down, so the page transform flips y once
 * and everything below is written in document orientation; text carries a
 * second flip in its own matrix so the glyphs stay upright.
 */
class Painter {
  readonly ops: string[] = [];
  /** Distinct fill/stroke opacity pairs, emitted as ExtGState resources. */
  readonly states: Array<[number, number]> = [];

  page(p: PdfPage): void {
    this.ops.push("q", `${n(PT_PER_MM)} 0 0 ${n(-PT_PER_MM)} 0 ${n(p.heightMm * PT_PER_MM)} cm`);
    const bg = p.background === undefined ? null : color(p.background);
    if (bg) this.ops.push(`${rgb(bg)} rg`, `0 0 ${n(p.widthMm)} ${n(p.heightMm)} re`, "f");
    this.walk(p.scene, ROOT);
    this.ops.push("Q");
  }

  private gs(fill: number, stroke: number): string {
    let i = this.states.findIndex(s => s[0] === fill && s[1] === stroke);
    if (i < 0) i = this.states.push([fill, stroke]) - 1;
    return `/GS${i} gs`;
  }

  private walk(items: readonly Item[], look: Look): void {
    for (const it of items) {
      if (it.kind === "group") this.group(it, look);
      else this.prim(it, look);
    }
  }

  private group(g: Group, parent: Look): void {
    const look = resolve(parent, g.style);
    this.ops.push("q");
    const tf = g.transform;
    if (tf?.kind === "place") {
      this.ops.push(`${n(tf.k)} 0 0 ${n(tf.k)} ${n(tf.tx)} ${n(tf.ty)} cm`);
    } else if (tf?.kind === "turn") {
      const rad = (tf.deg * Math.PI) / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      this.ops.push(`${n(c)} ${n(s)} ${n(-s)} ${n(c)}` +
        ` ${n(tf.cx - c * tf.cx + s * tf.cy)} ${n(tf.cy - s * tf.cx - c * tf.cy)} cm`);
    }
    const st = g.style;
    if (st) {
      if (st.fill !== undefined) { const c = color(st.fill); if (c) this.ops.push(`${rgb(c)} rg`); }
      if (st.ink !== undefined) { const c = color(st.ink); if (c) this.ops.push(`${rgb(c)} RG`); }
      if (st.width !== undefined) this.ops.push(`${n(st.width)} w`);
      if (st.dash !== undefined) this.ops.push(`[${st.dash.map(n).join(" ")}] 0 d`);
      if (st.cap !== undefined) this.ops.push(`${st.cap === "round" ? 1 : 0} J`);
      if (st.join !== undefined) this.ops.push(`${st.join === "round" ? 1 : 0} j`);
    }
    const [fa, sa] = opacity(look), [pfa, psa] = opacity(parent);
    if (fa !== pfa || sa !== psa) this.ops.push(this.gs(fa, sa));
    this.walk(g.items, look);
    this.ops.push("Q");
  }

  private prim(p: Prim, look: Look): void {
    if (p.kind === "text") { this.text(p.at.x, p.at.y, p.size, p.text, look); return; }
    const fill = look.fill === "none" ? null : color(look.fill);
    const stroke = look.ink === "none" ? null : color(look.ink);
    if (!fill && !stroke) return;
    const closed = this.path(p);
    if (closed) this.ops.push("h");
    this.ops.push(fill && stroke ? "B" : fill ? "f" : "S");
  }

  /** Emits the path construction operators; reports whether it closes. */
  private path(p: Prim): boolean {
    if (p.kind === "line") {
      this.ops.push(`${n(p.a.x)} ${n(p.a.y)} m`, `${n(p.b.x)} ${n(p.b.y)} l`);
      return false;
    }
    if (p.kind === "poly") {
      const [first, ...rest] = p.pts;
      if (!first) return false;
      this.ops.push(`${n(first.x)} ${n(first.y)} m`);
      for (const q of rest) this.ops.push(`${n(q.x)} ${n(q.y)} l`);
      return p.closed;
    }
    if (p.kind === "arc") {
      // PDF has no arc operator. A quarter turn is within a thousandth of a
      // radius of its cubic, which is finer than any printer resolves.
      const start = onCircle(p.c, p.r, p.start);
      this.ops.push(`${n(start.x)} ${n(start.y)} m`);
      for (const step of arcSteps(p.start, p.sweep, 90)) {
        const a0 = (step.from * Math.PI) / 180, a1 = ((step.from + step.sweep) * Math.PI) / 180;
        const k = ((4 / 3) * Math.tan((a1 - a0) / 4)) * p.r;
        const from = onCircle(p.c, p.r, step.from);
        const to = onCircle(p.c, p.r, step.from + step.sweep);
        const c1 = { x: from.x - Math.sin(a0) * k, y: from.y + Math.cos(a0) * k };
        const c2 = { x: to.x + Math.sin(a1) * k, y: to.y - Math.cos(a1) * k };
        this.ops.push(`${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(to.x)} ${n(to.y)} c`);
      }
      return Math.abs(p.sweep) >= 360;
    }
    return false;
  }

  private text(x: number, y: number, size: number, body: string, look: Look): void {
    if (body === "") return;
    const ink = look.ink !== "none" ? look.ink : look.fill;
    const paint = ink === "none" ? null : color(ink);
    if (!paint) return;
    const rad = (look.rotate * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // The anchor sits at the start or the middle of the run, and on the
    // alphabetic or the central baseline; PDF places the origin, so both
    // become offsets along the run and across it.
    const back = look.anchor === "middle" ? -textWidth(body, look.bold) * size / 2 : 0;
    const drop = look.baseline === "central" ? CENTRAL_EM * size : 0;
    const ox = x + back * cos - drop * sin;
    const oy = y + back * sin + drop * cos;
    this.ops.push("BT",
      `/${look.bold ? "F2" : "F1"} ${n(size)} Tf`,
      `${rgb(paint)} rg`,
      `${n(cos)} ${n(sin)} ${n(sin)} ${n(-cos)} ${n(ox)} ${n(oy)} Tm`,
      `${pdfString(body)} Tj`,
      "ET");
  }
}

// ── the file ─────────────────────────────────────────────────────────────────

/** Fixed object numbers; the ExtGStates follow `info`. */
const OBJ = { regular: 5, bold: 6, info: 7 };

/** One page as a complete PDF file, as a Latin-1 string of bytes. */
export function pdfDocument(page: PdfPage, title?: string): string {
  const painter = new Painter();
  painter.page(page);
  const content = painter.ops.join("\n") + "\n";

  const gsFirst = OBJ.info + 1;
  const gsNames = painter.states
    .map((_, i) => `/GS${i} ${gsFirst + i} 0 R`).join(" ");
  const resources = `<< /Font << /F1 ${OBJ.regular} 0 R /F2 ${OBJ.bold} 0 R >>` +
    (gsNames === "" ? "" : ` /ExtGState << ${gsNames} >>`) + ` >>`;

  const objs: string[] = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.widthMm * PT_PER_MM)} ${n(page.heightMm * PT_PER_MM)}]` +
      ` /Resources ${resources} /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
    `<< /Producer (Wallgraph)${title === undefined || title === "" ? "" : ` /Title ${pdfTextString(title)}`} >>`,
    ...painter.states.map(([f, s]) => `<< /Type /ExtGState /ca ${n(f)} /CA ${n(s)} >>`),
  ];

  // The header's second line is a comment of high bytes, which is how a
  // transfer that would mangle binary content is detected as text.
  let out = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${OBJ.info} 0 R >>\n`;
  out += `startxref\n${startxref}\n%%EOF\n`;
  return out;
}

/** The byte string as actual bytes, for a Blob. */
export function pdfBytes(doc: string) {
  // Built on an explicit buffer so the type carries it: a Blob part may not be
  // backed by shared memory.
  const bytes = new Uint8Array(new ArrayBuffer(doc.length));
  for (let i = 0; i < doc.length; i++) bytes[i] = doc.charCodeAt(i) & 0xff;
  return bytes;
}
