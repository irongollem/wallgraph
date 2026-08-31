// Permit sheet export: the plan on a standard sheet at a standard scale.
//
// Where the plain SVG export is the drawing at true scale, this is the drawing
// laid on paper: an A4 or A3 page at 1:100 (1:200 when 1:100 does not fit) with
// a border, dimension chains, a north arrow, a scale bar and a title block.
// Printing the file at 100% yields the stated scale — the page's width and
// height are the paper's own millimetres.
//
// Everything drawn inside the plan group is in world millimetres under a
// scale() transform; line weights and text that must hold a size ON PAPER are
// multiplied by the scale so they stay constant whichever scale is chosen.
import { PlanDoc, Floor, projectOf, areaModeOf, dimModeOf } from "../model/doc";
import { resolveFloor } from "../core/resolve";
import { permitLayout, PermitLayout, CHAIN_OVERALL_MM, CHAIN_LIFT_MM } from "../core/permit";
import { DimChain } from "../core/dimensions";
import { planSvgParts, esc } from "./svg";
import { COLORS } from "../render/draw";
import { saveViaHost, downloadBlob } from "./save";
import { t, language } from "../i18n";

export type PermitResult = "saved" | "empty" | "failed";

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/** Ink for the sheet furniture: frame, title block, north arrow, scale bar. */
const SHEET_INK = "#26292e";

/**
 * One dimension chain as SVG, in world millimetres. Same anatomy as the canvas
 * (`drawDimChains` in input/tools.ts): extension lines from the wall face,
 * the chain line with a surveyor's slash at every break, an overall run below
 * when it says something the spans do not. `scale` converts paper sizes to
 * world sizes so weights and digits hold their size on paper.
 */
function chainSvg(c: DimChain, lift: number, tag: string, scale: number): string[] {
  const parts: string[] = [];
  const at = (d: number, off: number): { x: number; y: number } => ({
    x: c.origin.x + c.dir.x * d + c.out.x * off,
    y: c.origin.y + c.dir.y * d + c.out.y * off,
  });
  const gap = c.half + 260 + lift;
  const first = c.spans[0]!.from, last = c.spans[c.spans.length - 1]!.to;
  const ticks = [first, ...c.spans.map(s => s.to)];
  const w = 0.13 * scale;        // 0.13 mm on paper
  const tick = 0.7 * scale;      // slash half-length
  const font = 2.4 * scale;      // 2.4 mm digits on paper

  const line = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
    parts.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"/>`);
  };
  const slash = (d: number, off: number): void => {
    const p = at(d, off);
    const mx = c.dir.x * tick + c.out.x * tick, my = c.dir.y * tick + c.out.y * tick;
    parts.push(`<line x1="${n(p.x - mx)}" y1="${n(p.y - my)}" x2="${n(p.x + mx)}" y2="${n(p.y + my)}"/>`);
  };
  // Rotated to run along the line, flipped past vertical so it never reads
  // upside down — the same rule the canvas applies.
  let deg = (Math.atan2(c.dir.y, c.dir.x) * 180) / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;
  const label = (text: string, d: number, off: number, size: number): void => {
    const p = at(d, off);
    parts.push(
      `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(size)}" text-anchor="middle"` +
      ` dominant-baseline="central" stroke="none" fill="${COLORS.dimension}"` +
      ` transform="rotate(${n(deg)} ${n(p.x)} ${n(p.y)})">${esc(text)}</text>`,
    );
  };

  parts.push(`<g stroke="${COLORS.dimension}" stroke-width="${n(w)}" fill="none">`);
  for (const d of ticks) line(at(d, c.half + 60), at(d, gap + 90));
  line(at(first, gap), at(last, gap));
  for (const d of ticks) slash(d, gap);
  if (c.spans.length > 1) {
    line(at(first, gap + CHAIN_OVERALL_MM), at(last, gap + CHAIN_OVERALL_MM));
    for (const d of [first, last]) slash(d, gap + CHAIN_OVERALL_MM);
    label(String(Math.round(last - first)), (first + last) / 2, gap + CHAIN_OVERALL_MM + font * 0.9, font);
  }
  for (const s of c.spans) label(String(s.mm), (s.from + s.to) / 2, gap - font * 0.9, font);
  if (tag !== "") label(tag, last + font * 1.2, gap, font * 0.75);
  parts.push(`</g>`);
  return parts;
}

/** The north arrow, drawn at (cx, cy) in paper mm, rotated to the stated north. */
function northSvg(cx: number, cy: number, deg: number): string[] {
  const r = 7;
  return [
    `<g stroke="${SHEET_INK}" fill="none" stroke-width="0.35"` +
    ` transform="rotate(${n(deg)} ${n(cx)} ${n(cy)})">`,
    `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}"/>`,
    `<line x1="${n(cx)}" y1="${n(cy + r)}" x2="${n(cx)}" y2="${n(cy - r)}"/>`,
    // Half-filled head: the filled side marks the arrow, per drawing custom.
    `<path d="M${n(cx)} ${n(cy - r)} L${n(cx - 2.2)} ${n(cy - 1)} L${n(cx)} ${n(cy - 2.6)} Z" fill="${SHEET_INK}" stroke="none"/>`,
    `<path d="M${n(cx)} ${n(cy - r)} L${n(cx + 2.2)} ${n(cy - 1)} L${n(cx)} ${n(cy - 2.6)} Z"/>`,
    `<text x="${n(cx)}" y="${n(cy - r - 1.6)}" font-size="3.2" text-anchor="middle"` +
    ` fill="${SHEET_INK}" stroke="none">N</text>`,
    `</g>`,
  ];
}

/** Alternating-block scale bar in paper mm. States metres at the sheet scale. */
function scaleBarSvg(x: number, y: number, scale: number): string[] {
  const block = 1000 / scale;              // one metre of building on paper
  const count = block >= 8 ? 5 : 10;       // keep the bar ~50 mm long
  const h = 2.4;
  const parts: string[] = [`<g stroke="${SHEET_INK}" stroke-width="0.25" fill="none">`];
  for (let i = 0; i < count; i++) {
    const fill = i % 2 === 0 ? SHEET_INK : "none";
    parts.push(`<rect x="${n(x + i * block)}" y="${n(y)}" width="${n(block)}" height="${n(h)}" fill="${fill}"/>`);
  }
  const lbl = (px: number, text: string): string =>
    `<text x="${n(px)}" y="${n(y - 1.4)}" font-size="2.6" text-anchor="middle" fill="${SHEET_INK}" stroke="none">${esc(text)}</text>`;
  parts.push(lbl(x, "0"), lbl(x + count * block, `${count} m`));
  parts.push(`</g>`);
  return parts;
}

/** One labelled title-block cell: a small caption over the value. */
function cell(x: number, y: number, w: number, h: number, caption: string, value: string, size: "big" | "small" | "" = ""): string[] {
  const font = size === "big" ? 5 : size === "small" ? 2.3 : 3;
  return [
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/>`,
    `<text x="${n(x + 1.6)}" y="${n(y + 3)}" font-size="1.9" fill="${SHEET_INK}" stroke="none">${esc(caption)}</text>`,
    `<text x="${n(x + 1.6)}" y="${n(y + h - 2.4)}" font-size="${n(font)}"` +
    ` fill="${SHEET_INK}" stroke="none"${size === "big" ? ` font-weight="600"` : ""}>${esc(value)}</text>`,
  ];
}

/** The active storey as a permit sheet, or null for a plan with nothing drawn. */
export function permitSvg(doc: PlanDoc, floorIndex = 0): string | null {
  const layout: PermitLayout | null = permitLayout(doc, floorIndex);
  const floor: Floor | undefined = doc.floors[floorIndex] ?? doc.floors[0];
  if (!layout || !floor) return null;
  const resolved = resolveFloor(floor);
  const meta = projectOf(doc);
  const { pageW, pageH, scale, frame, drawing, strip, extent } = layout;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"` +
    ` width="${n(pageW)}mm" height="${n(pageH)}mm" viewBox="0 0 ${n(pageW)} ${n(pageH)}">`,
  );
  parts.push(`<rect x="0" y="0" width="${n(pageW)}" height="${n(pageH)}" fill="#ffffff"/>`);
  parts.push(`<rect x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.w)}" height="${n(frame.h)}"` +
    ` fill="none" stroke="${SHEET_INK}" stroke-width="0.35"/>`);

  // The plan, centred in the drawing area. Inside this group 1 unit = 1 world
  // mm; the transform brings it to paper.
  const k = 1 / scale;
  const tx = drawing.x + drawing.w / 2 - (extent.minX + extent.w / 2) * k;
  const ty = drawing.y + drawing.h / 2 - (extent.minY + extent.h / 2) * k;
  parts.push(`<g id="plan" transform="translate(${n(tx)} ${n(ty)}) scale(${k})">`);
  parts.push(...planSvgParts(doc, floor, resolved));
  const both = dimModeOf(doc) === "both";
  parts.push(`<g id="dimensions">`);
  for (const c of layout.chains.clear)
    parts.push(...chainSvg(c, 0, both ? t("hint.dimTagClear") : "", scale));
  for (const c of layout.chains.centerline)
    parts.push(...chainSvg(c, both ? CHAIN_LIFT_MM : 0, both ? t("hint.dimTagCenterline") : "", scale));
  parts.push(`</g>`);
  parts.push(`</g>`);

  // North arrow only when the document states a direction: a guessed arrow
  // would be a false statement on exactly the sheet that gets relied on.
  if (doc.northDeg !== undefined) {
    parts.push(`<g id="north">`);
    parts.push(...northSvg(drawing.x + drawing.w - 12, drawing.y + 12, doc.northDeg));
    parts.push(`</g>`);
  }

  parts.push(`<g id="scalebar">`);
  parts.push(...scaleBarSvg(strip.x + 4, strip.y + strip.h / 2 + 1, scale));
  parts.push(`</g>`);

  // Title block, bottom-right of the strip. Cell sizes are paper mm.
  const bw = { a: 55, b: 34, c: 30, d: 25 };
  const tbW = bw.a + bw.b + bw.c + bw.d;
  const tbH = 30;
  const tbX = strip.x + strip.w - tbW;
  const tbY = strip.y + strip.h - tbH - 2;
  const rh = tbH / 2;
  const dateText = meta.date ?? new Date().toLocaleDateString(language() === "nl" ? "nl-NL" : "en-GB");
  parts.push(`<g id="titleblock" fill="none" stroke="${SHEET_INK}" stroke-width="0.25" font-family="system-ui, sans-serif">`);
  let x = tbX;
  parts.push(...cell(x, tbY, bw.a, rh, t("sheet.project"), meta.name ?? ""));
  parts.push(...cell(x, tbY + rh, bw.a, rh, t("sheet.address"), meta.address ?? ""));
  x += bw.a;
  parts.push(...cell(x, tbY, bw.b, rh, t("sheet.storey"), floor.name));
  parts.push(...cell(x, tbY + rh, bw.b, rh, t("sheet.date"), dateText));
  x += bw.b;
  parts.push(...cell(x, tbY, bw.c, rh, t("sheet.author"), meta.author ?? ""));
  parts.push(...cell(x, tbY + rh, bw.c, rh, t("sheet.number"), meta.number ?? ""));
  x += bw.c;
  // The paper name rides in the caption so the stated scale stays large
  // without overrunning its cell.
  parts.push(...cell(x, tbY, bw.d, rh, `${t("sheet.scale")} · ${layout.paper.toUpperCase()}`, `1:${scale}`, "big"));
  parts.push(...cell(x, tbY + rh, bw.d, rh, t("sheet.areas"),
    areaModeOf(doc) === "net" ? t("sheet.areaNet") : t("sheet.areaCenterline"), "small"));
  parts.push(`</g>`);

  parts.push(`</svg>`);
  return parts.join("\n") + "\n";
}

const FILENAME = "floorplan-sheet.svg";

export async function exportPermit(doc: PlanDoc, floorIndex = 0): Promise<PermitResult> {
  const text = permitSvg(doc, floorIndex);
  if (!text) return "empty";
  if (await saveViaHost(FILENAME, () => text)) return "saved";
  if (downloadBlob(FILENAME, new Blob([text], { type: "image/svg+xml" }))) return "saved";
  return "failed";
}
