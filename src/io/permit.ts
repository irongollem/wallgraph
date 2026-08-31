// Permit sheet export: the plan on a standard sheet at a standard scale.
//
// Where the plain SVG export is the drawing at true scale, this is the drawing
// laid on paper: an A4 or A3 page at 1:100 (1:200 when 1:100 does not fit) with
// a border, dimension chains, a north arrow, a scale bar and a title block.
// The page's width and height are the paper's own millimetres, so the stated
// scale is the printed scale.
//
// PDF is the format a submission takes, and it is the one that holds the scale
// on its own: a page whose MediaBox is A4 prints as A4, where an SVG only
// prints true if whoever prints it defeats the print dialog's fit-to-page. SVG
// stays available for a sheet that is going into a report or an illustrator.
// Both come from one scene (io/scene.ts), so neither can draw a different
// sheet.
//
// Deliberately excludes routes (model/route.ts): a bouwkundige permit sheet
// carries no services. This falls out of composition rather than a filter --
// the plan group below is built from planScene() alone, and routes are emitted
// only by the separate routeScene() in io/svg.ts, which nothing here imports.
// See tests/route.test.ts for the assertion.
import { PlanDoc, Floor, projectOf, areaModeOf, dimModeOf } from "../model/doc";
import { resolveFloor } from "../core/resolve";
import { permitLayout, PermitLayout, CHAIN_OVERALL_MM, CHAIN_LIFT_MM } from "../core/permit";
import { DimChain } from "../core/dimensions";
import { planScene, sceneSvg } from "./svg";
import { Item, circle, group, line, place, poly, rect, text, turn } from "./scene";
import { pdfBytes, pdfDocument } from "./pdf";
import { COLORS } from "../render/draw";
import { saveViaHost, downloadBlob } from "./save";
import { t, language } from "../i18n";

export type PermitResult = "saved" | "empty" | "failed";
export type PermitFormat = "pdf" | "svg";

const n = (v: number): string => (Math.round(v * 100) / 100).toString();

/** Ink for the sheet furniture: frame, title block, north arrow, scale bar. */
const SHEET_INK = "#26292e";

/** The paper the sheet is drawn on. */
const PAPER_WHITE = "#ffffff";

const SHEET_FONT = "system-ui, sans-serif";

/** The sheet as paper plus a scene in paper millimetres. */
interface Sheet {
  widthMm: number;
  heightMm: number;
  title: string;
  scene: Item[];
}

/**
 * One dimension chain, in world millimetres. Same anatomy as the canvas
 * (`drawDimChains` in input/tools.ts): extension lines from the wall face,
 * the chain line with a surveyor's slash at every break, an overall run below
 * when it says something the spans do not. `scale` converts paper sizes to
 * world sizes so weights and digits hold their size on paper.
 */
function chainItems(c: DimChain, lift: number, tag: string, scale: number): Item {
  const items: Item[] = [];
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

  const slash = (d: number, off: number): void => {
    const p = at(d, off);
    const mx = c.dir.x * tick + c.out.x * tick, my = c.dir.y * tick + c.out.y * tick;
    items.push(line({ x: p.x - mx, y: p.y - my }, { x: p.x + mx, y: p.y + my }));
  };
  const label = (body: string, d: number, off: number, size: number): void => {
    items.push(text(at(d, off), size, body));
  };

  for (const d of ticks) items.push(line(at(d, c.half + 60), at(d, gap + 90)));
  items.push(line(at(first, gap), at(last, gap)));
  for (const d of ticks) slash(d, gap);
  if (c.spans.length > 1) {
    items.push(line(at(first, gap + CHAIN_OVERALL_MM), at(last, gap + CHAIN_OVERALL_MM)));
    for (const d of [first, last]) slash(d, gap + CHAIN_OVERALL_MM);
    label(String(Math.round(last - first)), (first + last) / 2, gap + CHAIN_OVERALL_MM + font * 0.9, font);
  }
  for (const s of c.spans) label(String(s.mm), (s.from + s.to) / 2, gap - font * 0.9, font);
  if (tag !== "") label(tag, last + font * 1.2, gap, font * 0.75);

  // Rotated to run along the line, flipped past vertical so it never reads
  // upside down — the same rule the canvas applies.
  let deg = (Math.atan2(c.dir.y, c.dir.x) * 180) / Math.PI;
  if (deg > 90 || deg <= -90) deg += 180;
  return group(items, {
    ink: COLORS.dimension, fill: "none", width: w,
    anchor: "middle", baseline: "central", rotate: deg,
  });
}

/** The north arrow at (cx, cy) in paper mm, turned to the stated north. */
function northArrow(cx: number, cy: number, deg: number): Item {
  const r = 7;
  const head = (dx: number): Item[] =>
    [poly([{ x: cx, y: cy - r }, { x: cx + dx, y: cy - 1 }, { x: cx, y: cy - 2.6 }], true)];
  return group([
    circle({ x: cx, y: cy }, r),
    line({ x: cx, y: cy + r }, { x: cx, y: cy - r }),
    // Half-filled head: the filled side marks the arrow, per drawing custom.
    group(head(-2.2), { fill: SHEET_INK, ink: "none" }),
    ...head(2.2),
    text({ x: cx, y: cy - r - 1.6 }, 3.2, "N"),
  ], { ink: SHEET_INK, fill: "none", width: 0.35, anchor: "middle" }, "north", turn(deg, cx, cy));
}

/** Alternating-block scale bar in paper mm. States metres at the sheet scale. */
function scaleBar(x: number, y: number, scale: number): Item {
  const block = 1000 / scale;              // one metre of building on paper
  const count = block >= 8 ? 5 : 10;       // keep the bar ~50 mm long
  const h = 2.4;
  const solid: Item[] = [], hollow: Item[] = [];
  for (let i = 0; i < count; i++)
    (i % 2 === 0 ? solid : hollow).push(rect(x + i * block, y, block, h));
  return group([
    group(solid, { fill: SHEET_INK }),
    ...hollow,
    text({ x, y: y - 1.4 }, 2.6, "0"),
    text({ x: x + count * block, y: y - 1.4 }, 2.6, `${count} m`),
  ], { ink: SHEET_INK, fill: "none", width: 0.25, anchor: "middle" }, "scalebar");
}

/** One labelled title-block cell: a small caption over the value. */
function cell(x: number, y: number, w: number, h: number,
              caption: string, value: string, size: "big" | "small" | "" = ""): Item[] {
  const font = size === "big" ? 5 : size === "small" ? 2.3 : 3;
  const body = text({ x: x + 1.6, y: y + h - 2.4 }, font, value);
  return [
    rect(x, y, w, h),
    text({ x: x + 1.6, y: y + 3 }, 1.9, caption),
    size === "big" ? group([body], { bold: true }) : body,
  ];
}

/** The active storey as a permit sheet, or null for a plan with nothing drawn. */
function permitSheet(doc: PlanDoc, floorIndex: number): Sheet | null {
  const layout: PermitLayout | null = permitLayout(doc, floorIndex);
  const floor: Floor | undefined = doc.floors[floorIndex] ?? doc.floors[0];
  if (!layout || !floor) return null;
  const resolved = resolveFloor(floor);
  const meta = projectOf(doc);
  const { pageW, pageH, scale, frame, drawing, strip, extent } = layout;
  const scene: Item[] = [];

  scene.push(group([rect(frame.x, frame.y, frame.w, frame.h)],
    { fill: "none", ink: SHEET_INK, width: 0.35 }, "frame"));

  // The plan, centred in the drawing area. Inside this group 1 unit = 1 world
  // mm; the transform brings it to paper.
  const k = 1 / scale;
  const both = dimModeOf(doc) === "both";
  const chains: Item[] = [];
  for (const c of layout.chains.clear)
    chains.push(chainItems(c, 0, both ? t("hint.dimTagClear") : "", scale));
  for (const c of layout.chains.centerline)
    chains.push(chainItems(c, both ? CHAIN_LIFT_MM : 0, both ? t("hint.dimTagCenterline") : "", scale));
  scene.push(group([
    ...planScene(doc, floor, resolved),
    group(chains, undefined, "dimensions"),
  ], undefined, "plan", place(k,
    drawing.x + drawing.w / 2 - (extent.minX + extent.w / 2) * k,
    drawing.y + drawing.h / 2 - (extent.minY + extent.h / 2) * k)));

  // North arrow only when the document states a direction: a guessed arrow
  // would be a false statement on exactly the sheet that gets relied on.
  if (doc.northDeg !== undefined)
    scene.push(northArrow(drawing.x + drawing.w - 12, drawing.y + 12, doc.northDeg));

  scene.push(scaleBar(strip.x + 4, strip.y + strip.h / 2 + 1, scale));

  // Title block, bottom-right of the strip. Cell sizes are paper mm.
  const bw = { a: 55, b: 34, c: 30, d: 25 };
  const tbW = bw.a + bw.b + bw.c + bw.d;
  const tbH = 30;
  const tbX = strip.x + strip.w - tbW;
  const tbY = strip.y + strip.h - tbH - 2;
  const rh = tbH / 2;
  const dateText = meta.date ?? new Date().toLocaleDateString(language() === "nl" ? "nl-NL" : "en-GB");
  const cells: Item[] = [];
  let x = tbX;
  cells.push(...cell(x, tbY, bw.a, rh, t("sheet.project"), meta.name ?? ""));
  cells.push(...cell(x, tbY + rh, bw.a, rh, t("sheet.address"), meta.address ?? ""));
  x += bw.a;
  cells.push(...cell(x, tbY, bw.b, rh, t("sheet.storey"), floor.name));
  cells.push(...cell(x, tbY + rh, bw.b, rh, t("sheet.date"), dateText));
  x += bw.b;
  cells.push(...cell(x, tbY, bw.c, rh, t("sheet.author"), meta.author ?? ""));
  cells.push(...cell(x, tbY + rh, bw.c, rh, t("sheet.number"), meta.number ?? ""));
  x += bw.c;
  // The paper name rides in the caption so the stated scale stays large
  // without overrunning its cell.
  cells.push(...cell(x, tbY, bw.d, rh, `${t("sheet.scale")} · ${layout.paper.toUpperCase()}`, `1:${scale}`, "big"));
  cells.push(...cell(x, tbY + rh, bw.d, rh, t("sheet.areas"),
    areaModeOf(doc) === "net" ? t("sheet.areaNet") : t("sheet.areaCenterline"), "small"));
  scene.push(group(cells, {
    fill: "none", ink: SHEET_INK, width: 0.25,
    family: SHEET_FONT, anchor: "start", baseline: "alphabetic",
  }, "titleblock"));

  const named = [meta.name, floor.name].filter(s => s !== undefined && s !== "").join(" — ");
  return { widthMm: pageW, heightMm: pageH, title: named, scene };
}

/** The sheet as an SVG document, sized in paper millimetres. */
export function permitSvg(doc: PlanDoc, floorIndex = 0): string | null {
  const sheet = permitSheet(doc, floorIndex);
  if (!sheet) return null;
  const { widthMm: w, heightMm: h } = sheet;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"` +
    ` width="${n(w)}mm" height="${n(h)}mm" viewBox="0 0 ${n(w)} ${n(h)}">`,
    `<rect x="0" y="0" width="${n(w)}" height="${n(h)}" fill="${PAPER_WHITE}"/>`,
    ...sceneSvg(sheet.scene),
    `</svg>`,
  ].join("\n") + "\n";
}

/** The sheet as a PDF file, as a Latin-1 string of bytes. */
export function permitPdf(doc: PlanDoc, floorIndex = 0): string | null {
  const sheet = permitSheet(doc, floorIndex);
  if (!sheet) return null;
  return pdfDocument({
    widthMm: sheet.widthMm, heightMm: sheet.heightMm,
    background: PAPER_WHITE, scene: sheet.scene,
  }, sheet.title);
}

const FILENAME = { pdf: "floorplan-sheet.pdf", svg: "floorplan-sheet.svg" };

export async function exportPermit(
  doc: PlanDoc, floorIndex = 0, format: PermitFormat = "pdf",
): Promise<PermitResult> {
  const name = FILENAME[format];
  if (format === "svg") {
    const body = permitSvg(doc, floorIndex);
    if (!body) return "empty";
    if (await saveViaHost(name, () => body)) return "saved";
    return downloadBlob(name, new Blob([body], { type: "image/svg+xml" })) ? "saved" : "failed";
  }
  const body = permitPdf(doc, floorIndex);
  if (!body) return "empty";
  // The hosted downloads capability takes a string, so the bytes travel as a
  // data URL there and as a Blob down the ordinary link.
  if (await saveViaHost(name, () => `data:application/pdf;base64,${btoa(body)}`)) return "saved";
  return downloadBlob(name, new Blob([pdfBytes(body)], { type: "application/pdf" })) ? "saved" : "failed";
}
