// Stock-length nesting: first-fit decreasing, kerf accounted per cut, an
// oversized non-spliceable piece reported rather than split, an oversized
// spliceable one cut into stock-length chunks plus a remainder.
import { nest, type Piece } from "../src/core/stock";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

function piece(over: Partial<Piece> & Pick<Piece, "lengthMm" | "count">): Piece {
  return { name: "p", spliceable: false, ...over };
}

// ---- a known piece list nests into the expected stock counts ---------------

{
  // Five 1000 mm pieces at 2400 mm stock, 3 mm kerf: two fit a bar (1000,
  // 1000+3 = 2003 used, 397 left over, too little for a third at 1003), so
  // three bars are bought -- two holding a pair, one holding the odd piece.
  const r = nest([piece({ lengthMm: 1000, count: 5 })], [2400, 3000, 3600], 3);
  check("five 1000s at 2400 stock buy three bars", r.stock.length === 1 && r.stock[0]!.lengthMm === 2400,
    JSON.stringify(r.stock));
  check("three bars bought", r.stock[0]!.count === 3, String(r.stock[0]!.count));
  check("total nested is 5000", r.totalMm === 5000, String(r.totalMm));
  check("bought is 3 x 2400 = 7200", r.boughtMm === 7200, String(r.boughtMm));
  check("offcut is 397 + 397 + 1400 = 2194", r.stock[0]!.offcutMm === 2194, String(r.stock[0]!.offcutMm));
  check("wastePct matches (bought - total) / bought", Math.abs(r.wastePct - ((7200 - 5000) / 7200) * 100) < 1e-9);
  check("no unfit pieces", r.unfit.length === 0);
  check("no splices", r.splices === 0);
}

// ---- oversized, non-spliceable: unfit, never split -------------------------

{
  const r = nest(
    [piece({ name: "stud", lengthMm: 6100, count: 1, spliceable: false })],
    [2400, 3000, 3600, 4200, 4800, 5400, 6000], 3,
  );
  check("a 6100 stud at 6000 max stock is unfit", r.unfit.length === 1, JSON.stringify(r.unfit));
  check("unfit carries the piece's own length and name",
    r.unfit[0]!.name === "stud" && r.unfit[0]!.lengthMm === 6100 && r.unfit[0]!.count === 1);
  check("nothing was bought for it", r.stock.length === 0 && r.boughtMm === 0);
  check("wastePct is 0 when nothing is bought", r.wastePct === 0);
}

{
  // Unfit pieces aggregate by name + length.
  const r = nest(
    [piece({ name: "stud", lengthMm: 6100, count: 3, spliceable: false })],
    [6000], 3,
  );
  check("three identical oversized pieces aggregate into one unfit entry",
    r.unfit.length === 1 && r.unfit[0]!.count === 3, JSON.stringify(r.unfit));
}

// ---- oversized, spliceable: cut into stock-length chunks + remainder -------

{
  const r = nest(
    [piece({ name: "plate", lengthMm: 7000, count: 1, spliceable: true })],
    [6000], 3,
  );
  check("a 7000 plate at 6000 max stock splices once", r.splices === 1, String(r.splices));
  check("nothing is unfit -- a spliceable piece is never reported unfit", r.unfit.length === 0);
  check("total nested is still 7000 (6000 + 1000 chunks)", r.totalMm === 7000, String(r.totalMm));
  check("two bars bought (the 6000 chunk exactly fills one, the 1000 remainder opens another)",
    r.stock.length === 1 && r.stock[0]!.count === 2, JSON.stringify(r.stock));
  check("bought is 2 x 6000 = 12000", r.boughtMm === 12000, String(r.boughtMm));
}

// ---- kerf is charged per cut, not per piece ---------------------------------

{
  // Two 400s in a 1000 bar: the first costs 400 (bar's own end is the first
  // face, no kerf), the second costs 400 + kerf because it does not exactly
  // fill what remains (600).
  const r = nest([piece({ lengthMm: 400, count: 2 })], [1000], 10);
  check("kerf lands both pieces in one bar", r.stock.length === 1 && r.stock[0]!.count === 1,
    JSON.stringify(r.stock));
  check("offcut is 1000 - 400 - 400 - 10 = 190", r.stock[0]!.offcutMm === 190, String(r.stock[0]!.offcutMm));
}

{
  // Two 500s in a 1000 bar: the second exactly fills the remainder, so no
  // kerf is charged for it.
  const r = nest([piece({ lengthMm: 500, count: 2 })], [1000], 10);
  check("an exact-fill piece needs no kerf", r.stock[0]!.offcutMm === 0, String(r.stock[0]!.offcutMm));
}

// ---- determinism -------------------------------------------------------------

{
  const pieces: Piece[] = [
    piece({ name: "b", lengthMm: 1800, count: 2 }),
    piece({ name: "a", lengthMm: 1800, count: 2 }),
    piece({ name: "c", lengthMm: 900, count: 3 }),
  ];
  const r1 = nest(pieces, [2400, 3600, 6000], 3);
  const r2 = nest(pieces, [2400, 3600, 6000], 3);
  check("nesting the same pieces twice gives the same result",
    JSON.stringify(r1) === JSON.stringify(r2));
}

console.log(failures === 0 ? "ok" : `FAIL (${failures} failures)`);
process.exit(failures === 0 ? 0 : 1);
