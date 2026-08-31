// Demo document so the editor opens with something worth poking at:
// a small apartment with exterior walls, two interior walls, doors with swing,
// a sliding window, a curved wall, a kitchen run, sanitair, furniture and
// named rooms.
import { PlanDoc, emptyDoc, newId, Wall } from "./model/doc";
import { Furnishing, furnishingPreset, writeSpec } from "./model/furnishing";
import { bulgeFromSagitta } from "./geometry/arc";
import { v } from "./geometry/vec";

export function seedDoc(): PlanDoc {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const N = (x: number, y: number): string => {
    const id = newId("n");
    f.nodes.push({ id, x, y });
    return id;
  };
  const W = (a: string, b: string, thickness: number, bulge = 0): Wall => {
    const w: Wall = { id: newId("w"), a, b, thickness, bulge, openings: [] };
    f.walls.push(w);
    return w;
  };

  // Exterior shell 8000 x 5400, 300mm walls.
  const nTL = N(0, 0), nTM = N(4800, 0), nTR = N(8000, 0);
  const nBR = N(8000, 5400), nBM = N(4800, 5400), nBL = N(0, 5400);
  const top1 = W(nTL, nTM, 300);
  W(nTM, nTR, 300);
  const right = W(nTR, nBR, 300);
  W(nBR, nBM, 300);
  const bottom2 = W(nBM, nBL, 300);
  const left = W(nBL, nTL, 300);

  // Interior: bedroom wall at x=4800 (top to bottom), 100mm.
  const inner = W(nTM, nBM, 100);

  // Bathroom: a curved feature wall bowing from the inner wall across to the
  // right wall, splitting both at y=2300.
  const nC1 = N(4800, 2300), nC2 = N(8000, 2300);
  // Split inner wall at nC1 by rebuilding: inner runs nTM->nBM; replace with two.
  inner.b = nC1;
  W(nC1, nBM, 100);
  const bath = W(nC1, nC2, 100, bulgeFromSagitta(v(4800, 2300), v(8000, 2300), -450));
  // Split right wall at nC2.
  right.b = nC2;
  W(nC2, nBR, 300);

  // Openings.
  const frontDoor = { id: newId("o"), kind: "door" as const, t: 2400, width: 930,
    sashes: [{ action: "turn" as const, hinge: "a" as const, outward: false }] };
  bottom2.openings.push(frontDoor);
  top1.openings.push({ id: newId("o"), kind: "window", t: 2400, width: 1800,
    sashes: [{ action: "slide", slideTo: "b" }] });
  left.openings.push({ id: newId("o"), kind: "window", t: 2700, width: 1400,
    sashes: [{ action: "fixed" }] });
  inner.openings.push({ id: newId("o"), kind: "door", t: 1100, width: 830,
    sashes: [{ action: "turn", hinge: "b", outward: true }] });
  bath.openings.push({ id: newId("o"), kind: "door", t: 800, width: 730,
    sashes: [{ action: "turn", hinge: "a", outward: true }] });

  // Symbols. Rotations: 0 faces +y (down on screen).
  const S = (type: string, x: number, y: number, rotation: number, wallId?: string): void => {
    f.symbols.push({ id: newId("s"), type, x, y, rotation, ...(wallId ? { wallId } : {}) });
  };
  // Along top wall (faces into room, +y): sockets & switch.
  S("socket-double", 900, 150, 0);
  S("switch-single", 3200, 150, 0);
  S("radiator", 3600, 5250, Math.PI);
  // Bedroom bits.
  S("socket-single", 4950, 3000, -Math.PI / 2);
  S("light-point", 6400, 3900, 0);
  S("light-point", 2200, 3600, 0);

  // The fit-out. A kitchen run along the top wall of the living space: the
  // inner face is at y = 150 (a 300 mm wall), and rotation 0 puts +y into the
  // room, so the units stand flush against it and butt end to end the way the
  // tool snaps them. The spoelkast goes under the window, as it is nearly
  // always built.
  const K = (preset: string, x: number, y: number, rotation: number, over: Partial<Furnishing> = {}): void => {
    const p = furnishingPreset(preset);
    if (!p) return;
    const { id: _preset, group: _group, ...spec } = p;
    const piece: Furnishing = {
      id: newId("i"), form: spec.form, x, y, rotation,
      width: spec.width, depth: spec.depth,
    };
    writeSpec(piece, spec);
    f.furnishings ??= [];
    f.furnishings.push({ ...piece, ...over });
  };
  K("hoekkast-onder", 600, 150, 0);          // 150..1050, into the left corner
  K("ladenkast", 1350, 150, 0);              // 1050..1650
  K("spoelkast", 1950, 150, 0);              // 1650..2250, under the window
  K("onderkast", 2550, 150, 0);              // 2250..2850
  // One wall unit, over the corner where there is no window. It hangs above the
  // plan's section plane, so it draws dashed over the base unit beneath it —
  // which is what a plattegrond does with overhead work, and worth seeing.
  K("bovenkast", 450, 150, 0);
  // The fridge housing against the interior wall, facing back into the living
  // space: rotation PI/2 turns +y onto -x. Clear of the door at y = 685..1515.
  K("koelkast-ombouw", 4750, 2200, Math.PI / 2);
  // A wardrobe in the bedroom, against the bottom wall: rotation PI turns +y
  // back into the room.
  K("garderobekast", 7000, 5250, Math.PI);

  // Sanitair against the right wall of the bathroom, facing -x: rotation =
  // angle(outNormal) - PI/2, outNormal = (-1, 0) -> PI - PI/2 = PI/2. The bath
  // runs along the top wall. All three are built to a size, so they are
  // furnishings rather than symbols -- see model/furnishing.ts.
  K("toilet", 7850, 900, Math.PI / 2);
  K("wastafel", 7850, 1750, Math.PI / 2);
  K("bad", 6300, 150, 0);

  // A bed and a bedside table, free-standing: no wall to take, so the anchor is
  // the middle of the footprint.
  K("tweepersoonsbed", 6300, 4300, 0);
  K("tafel", 3000, 4200, 0, { width: 900, depth: 900 });

  // Room names. The name and its point are stored; which room carries it
  // follows from the walls. See model/room.ts.
  f.roomNames = [
    { id: newId("r"), x: 2400, y: 3400, name: "Woonkeuken" },
    { id: newId("r"), x: 5600, y: 1100, name: "Badkamer" },
    { id: newId("r"), x: 6400, y: 4400, name: "Slaapkamer" },
  ];
  return doc;
}
