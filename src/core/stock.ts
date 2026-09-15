// Stock-length nesting: fitting a list of cut pieces into bars bought at
// fixed lengths, first-fit decreasing. Used by core/materials.ts to turn a
// wall system's studs, plates and the rest into a buy list, but the packing
// itself knows nothing about walls.
//
// Kerf accounting: every cut removes kerfMm of material. The first piece
// placed in a bar costs exactly its own length -- the bar's own end is one
// face of that cut, so nothing is charged for it. Each further piece pays
// lengthMm + kerfMm, a kerf ahead of it for the cut that frees it from what
// is left of the bar, EXCEPT when it exactly fills what remains: the last
// piece off a bar needs no further cut beyond the one that frees it, so it
// costs its length alone.
export interface Piece { name: string; lengthMm: number; count: number; spliceable: boolean }

export interface NestResult {
  /** Per stock length, ascending: how many to buy and what was cut from each. */
  stock: { lengthMm: number; count: number; offcutMm: number }[];
  /** Pieces longer than every stock length that may not be spliced. Reported, never split. */
  unfit: Piece[];
  /** Splices made in spliceable pieces (plates), for the order to know. */
  splices: number;
  /** Sum of nested piece lengths (unfit pieces excluded). */
  totalMm: number;
  /** Sum of the length of every bar bought. */
  boughtMm: number;
  /** (boughtMm - totalMm) / boughtMm * 100. 0 when nothing was bought. */
  wastePct: number;
}

interface Instance { name: string; lengthMm: number }

/** One bar of stock, open for further pieces until nested() moves on. */
interface Bar { lengthMm: number; usedMm: number; pieces: number }

function fits(bar: Bar, lengthMm: number, kerfMm: number): boolean {
  const remaining = bar.lengthMm - bar.usedMm;
  if (bar.pieces === 0) return lengthMm <= remaining;
  if (lengthMm === remaining) return true; // exact fill: no further cut, no kerf
  return lengthMm + kerfMm <= remaining;
}

function costOf(bar: Bar, lengthMm: number, kerfMm: number): number {
  const remaining = bar.lengthMm - bar.usedMm;
  if (bar.pieces === 0 || lengthMm === remaining) return lengthMm;
  return lengthMm + kerfMm;
}

/**
 * Nests `pieces` into bars bought at `stockMm` lengths, first-fit decreasing:
 * every piece instance (counts expanded), longest first with a stable
 * tie-break on name for a deterministic result, placed into the first open
 * bar with room; when none has room, a new bar is opened at the SMALLEST
 * stock length that fits it.
 *
 * A non-spliceable piece longer than every stock length is reported in
 * `unfit`, aggregated by name and length, and never split. A spliceable piece
 * longer than every stock length is cut into longest-stock chunks plus a
 * remainder BEFORE nesting -- those chunks are then nested like any other
 * piece -- and `splices` counts one less than the chunks made (a 7000 mm
 * piece at a 6000 mm maximum is one splice, two chunks).
 */
export function nest(pieces: readonly Piece[], stockMm: readonly number[], kerfMm: number): NestResult {
  const stocks = [...new Set(stockMm.filter(n => n > 0))].sort((a, b) => a - b);
  const maxStock = stocks.length > 0 ? stocks[stocks.length - 1]! : 0;

  const instances: Instance[] = [];
  const unfitMap = new Map<string, Piece>();
  let splices = 0;

  for (const p of pieces) {
    if (p.count <= 0 || p.lengthMm <= 0) continue;
    for (let i = 0; i < p.count; i++) {
      if (p.lengthMm > maxStock) {
        if (!p.spliceable) {
          const key = `${p.name}:${p.lengthMm}`;
          const existing = unfitMap.get(key);
          if (existing) existing.count++;
          else unfitMap.set(key, { name: p.name, lengthMm: p.lengthMm, count: 1, spliceable: false });
          continue;
        }
        let remaining = p.lengthMm;
        let chunks = 0;
        while (remaining > maxStock) {
          instances.push({ name: p.name, lengthMm: maxStock });
          remaining -= maxStock;
          chunks++;
        }
        if (remaining > 0) { instances.push({ name: p.name, lengthMm: remaining }); chunks++; }
        splices += Math.max(0, chunks - 1);
        continue;
      }
      instances.push({ name: p.name, lengthMm: p.lengthMm });
    }
  }

  const ordered = instances
    .map((inst, i) => ({ inst, i }))
    .sort((a, b) => b.inst.lengthMm - a.inst.lengthMm || a.inst.name.localeCompare(b.inst.name) || a.i - b.i)
    .map(x => x.inst);

  const bars: Bar[] = [];
  for (const inst of ordered) {
    let placed = false;
    for (const bar of bars) {
      if (fits(bar, inst.lengthMm, kerfMm)) {
        bar.usedMm += costOf(bar, inst.lengthMm, kerfMm);
        bar.pieces++;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const openLen = stocks.find(s => s >= inst.lengthMm);
      if (openLen === undefined) continue; // guarded above: cannot exceed maxStock here
      bars.push({ lengthMm: openLen, usedMm: inst.lengthMm, pieces: 1 });
    }
  }

  const byLength = new Map<number, { count: number; offcutMm: number }>();
  let boughtMm = 0;
  for (const bar of bars) {
    boughtMm += bar.lengthMm;
    const entry = byLength.get(bar.lengthMm) ?? { count: 0, offcutMm: 0 };
    entry.count++;
    entry.offcutMm += bar.lengthMm - bar.usedMm;
    byLength.set(bar.lengthMm, entry);
  }
  const stock = [...byLength.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lengthMm, e]) => ({ lengthMm, count: e.count, offcutMm: e.offcutMm }));

  const totalMm = instances.reduce((s, i) => s + i.lengthMm, 0);
  return {
    stock,
    unfit: [...unfitMap.values()],
    splices,
    totalMm,
    boughtMm,
    wastePct: boughtMm > 0 ? ((boughtMm - totalMm) / boughtMm) * 100 : 0,
  };
}
