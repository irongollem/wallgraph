// Trace-over-image underlay: the calibration math, the link/schema/JSON
// contracts around Floor.underlay, and the integer-mm rounding invariant
// through the store mutations this feature adds. The image import pipeline
// itself (io/underlay.ts's prepareUnderlayImage) runs on browser Canvas/
// Image/FileReader APIs and is not exercised here -- see CLAUDE.md's note
// that render/import code stays thin because it is not testable in node.
import { emptyDoc, type Underlay } from "../src/model/doc";
import { Store } from "../src/model/store";
import { calibrateUnderlay } from "../src/model/ops";
import { initialUnderlay } from "../src/io/underlay";
import { encodePlan, decodePlan } from "../src/io/link";
import { parseDoc } from "../src/io/json";
import { toSvg } from "../src/io/svg";
import { seedDoc } from "../src/seed";
import { planSchema, validate } from "../scripts/site/schema";
import { resources } from "../src/i18n";
import { v } from "../src/geometry/vec";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

const sampleUnderlay = (): Underlay => ({
  dataUrl: "data:image/jpeg;base64,AAAA", x: 1000, y: 2000, mmPerPixel: 5, opacity: 1,
});

/* ── calibration math (model/ops.ts's calibrateUnderlay) ── */
{
  const u = sampleUnderlay();
  // Two points a visitor clicked, 600 mm apart at the underlay's CURRENT
  // (uncalibrated) scale; they type "1000" as the real-world distance.
  const p0 = v(1200, 2100), p1 = v(1800, 2100);
  const next = calibrateUnderlay(u, p0, p1, 1000);
  check("calibration produces a result", next !== null);
  if (next) {
    const factor = 1000 / 600;
    check("mmPerPixel scales by realMm / measuredMm",
      Math.abs(next.mmPerPixel - u.mmPerPixel * factor) < 1e-9,
      String(next.mmPerPixel));

    // "p0 stays put on screen" means the image pixel that was under p0 is
    // still under it after the rescale -- recover that pixel from the
    // ORIGINAL placement and re-project it through the NEW one.
    const relX = (p0.x - u.x) / u.mmPerPixel, relY = (p0.y - u.y) / u.mmPerPixel;
    const p0After = v(next.x + relX * next.mmPerPixel, next.y + relY * next.mmPerPixel);
    check("the first clicked point stays fixed",
      Math.abs(p0After.x - p0.x) < 1 && Math.abs(p0After.y - p0.y) < 1,
      JSON.stringify(p0After));

    check("x/y stay integer mm (invariant 1)", Number.isInteger(next.x) && Number.isInteger(next.y));
    // mmPerPixel is a ratio, not a stored length -- a float is expected, not
    // an invariant-1 violation (see model/doc.ts's Underlay comment).
    check("mmPerPixel is finite and positive", isFinite(next.mmPerPixel) && next.mmPerPixel > 0);
    check("opacity and dataUrl pass through unchanged",
      next.opacity === u.opacity && next.dataUrl === u.dataUrl);
  }

  check("a degenerate measurement (same point twice) is rejected",
    calibrateUnderlay(u, v(500, 500), v(500, 500), 1000) === null);
  check("a zero typed distance is rejected",
    calibrateUnderlay(u, p0, p1, 0) === null);
  check("a negative typed distance is rejected",
    calibrateUnderlay(u, p0, p1, -100) === null);
}

/* ── initial placement (io/underlay.ts's initialUnderlay) ── */
{
  const placed = initialUnderlay("data:image/jpeg;base64,AAAA", 3000, 1500, v(1234.6, -789.2));
  check("initialUnderlay places at integer mm (invariant 1)",
    Number.isInteger(placed.x) && Number.isInteger(placed.y), JSON.stringify(placed));
  check("initialUnderlay centres on the given point", (() => {
    const w = 3000 * placed.mmPerPixel, h = 1500 * placed.mmPerPixel;
    const cx = placed.x + w / 2, cy = placed.y + h / 2;
    return Math.abs(cx - 1234.6) < 1 && Math.abs(cy - (-789.2)) < 1;
  })());
  check("initialUnderlay's long edge spans about 10 m", (() => {
    const spanMm = 3000 * placed.mmPerPixel;
    return spanMm > 9000 && spanMm < 11000;
  })(), String(3000 * placed.mmPerPixel));
}

/* ── store mutations: duplicateFloor drops the underlay ── */
{
  const store = new Store();
  store.replace(emptyDoc());
  store.mutate(d => { d.floors[0]!.underlay = sampleUnderlay(); });
  store.duplicateFloor("Verdieping 2");
  check("duplicateFloor does not carry the underlay to the new storey",
    store.doc.floors[1]!.underlay === undefined);
  check("the source floor keeps its own underlay",
    store.doc.floors[0]!.underlay !== undefined);
}

/* ── link stripping (io/link.ts's encodePlan) ── */
{
  const doc = emptyDoc();
  doc.floors[0]!.underlay = sampleUnderlay();
  const payload = encodePlan(doc);
  const decoded = decodePlan(payload);
  check("encodePlan's payload decodes", decoded !== null);
  check("the decoded document carries no underlay",
    decoded !== null && decoded.floors[0]!.underlay === undefined);
  check("the SOURCE document is untouched -- it still carries its own underlay",
    doc.floors[0]!.underlay !== undefined);
  // A document with no underlay anywhere must round-trip exactly, unaffected
  // by the stripping path.
  const plain = seedDoc();
  check("a document with no underlay round-trips exactly",
    JSON.stringify(decodePlan(encodePlan(plain))) === JSON.stringify(plain));
}

/* ── JSON export/import keeps it verbatim (io/json.ts's parseDoc) ── */
{
  const doc = emptyDoc();
  doc.floors[0]!.underlay = { dataUrl: "data:image/png;base64,BBBB", x: 10, y: -20, mmPerPixel: 3.3, opacity: 0.5 };
  const parsed = parseDoc(JSON.stringify(doc));
  check("JSON round-trip keeps the underlay verbatim",
    JSON.stringify(parsed?.floors[0]?.underlay) === JSON.stringify(doc.floors[0]!.underlay));
}

/* ── the published schema ── */
{
  const schema = planSchema("");
  const good = emptyDoc();
  good.floors[0]!.underlay = sampleUnderlay();
  check("a document with an underlay validates",
    validate(schema, good).length === 0, validate(schema, good).join(" | "));

  const badType = JSON.parse(JSON.stringify(good));
  badType.floors[0].underlay.dataUrl = "https://example.com/scan.png";
  check("a non-data: dataUrl is rejected", validate(schema, badType).length > 0);

  const notImage = JSON.parse(JSON.stringify(good));
  notImage.floors[0].underlay.dataUrl = "data:text/plain;base64,AAAA";
  check("a data: URI that is not an image is rejected", validate(schema, notImage).length > 0);

  const zeroScale = JSON.parse(JSON.stringify(good));
  zeroScale.floors[0].underlay.mmPerPixel = 0;
  check("mmPerPixel must be > 0 (exclusiveMinimum)", validate(schema, zeroScale).length > 0);

  const badOpacity = JSON.parse(JSON.stringify(good));
  badOpacity.floors[0].underlay.opacity = 1.5;
  check("opacity above 1 is rejected", validate(schema, badOpacity).length > 0);

  const missing = JSON.parse(JSON.stringify(good));
  delete missing.floors[0].underlay.opacity;
  check("a missing required field is rejected", validate(schema, missing).length > 0);

  const extra = JSON.parse(JSON.stringify(good));
  extra.floors[0].underlay.rotation = 0;
  check("an unknown underlay property is rejected", validate(schema, extra).length > 0);

  const withoutOne = emptyDoc();
  check("a document without an underlay still validates",
    validate(schema, withoutOne).length === 0, validate(schema, withoutOne).join(" | "));
}

/* ── SVG never carries the underlay, even when the floor has one ── */
{
  const doc = seedDoc();
  doc.floors[0]!.underlay = sampleUnderlay();
  const svg = toSvg(doc, 0) ?? "";
  check("SVG export produced something", svg.length > 0);
  check("SVG carries no data: URI", !svg.includes("data:"));
}

/* ── the calibration hint exists in both languages, with a touch twin ── */
{
  const bases = ["calibrateFirst", "calibrateSecond", "calibrateDistance"];
  const touchKey = (b: string): string => `touch${b[0]!.toUpperCase()}${b.slice(1)}`;
  for (const lang of ["nl", "en"] as const) {
    const hints = resources[lang].translation.hint as Record<string, string | undefined>;
    for (const base of bases) {
      check(`${lang} has hint.${base}`, typeof hints[base] === "string");
      check(`${lang} has hint.${touchKey(base)}`, typeof hints[touchKey(base)] === "string");
    }
  }
}

console.log(failures === 0 ? "ALL UNDERLAY TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
