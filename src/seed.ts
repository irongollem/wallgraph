// Demo document so the editor opens with something worth poking at:
// a small apartment with exterior walls, two interior walls, doors with swing,
// a sliding window, a curved wall, and fixtures.
import { PlanDoc, emptyDoc, newId, Wall } from "./model/doc";
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
  const top2 = W(nTM, nTR, 300);
  const right = W(nTR, nBR, 300);
  const bottom1 = W(nBR, nBM, 300);
  const bottom2 = W(nBM, nBL, 300);
  const left = W(nBL, nTL, 300);
  void top2; void bottom1;

  // Interior: bedroom wall at x=4800 (top to bottom), 100mm.
  const inner = W(nTM, nBM, 100);

  // Bathroom inside bedroom: wall at y=2400 from x=4800 to x=8000... make it
  // partial with a curved feature wall instead: quarter-curve from inner wall to right wall.
  const nC1 = N(4800, 2300), nC2 = N(8000, 2300);
  // Split inner wall at nC1 by rebuilding: inner runs nTM->nBM; replace with two.
  inner.b = nC1;
  W(nC1, nBM, 100);
  const bath = W(nC1, nC2, 100, bulgeFromSagitta(v(4800, 2300), v(8000, 2300), -450));
  // Split right wall at nC2.
  right.b = nC2;
  W(nC2, nBR, 300);

  // Openings.
  const frontDoor = { id: newId("o"), kind: "door" as const, t: 2400, width: 930, hinge: "a" as const, swingIn: true };
  bottom2.openings.push(frontDoor);
  top1.openings.push({ id: newId("o"), kind: "window" as const, t: 2400, width: 1800, windowType: "sliding" as const, slideTo: "b" as const });
  left.openings.push({ id: newId("o"), kind: "window" as const, t: 2700, width: 1400, windowType: "fixed" as const });
  inner.openings.push({ id: newId("o"), kind: "door" as const, t: 1100, width: 830, hinge: "b" as const, swingIn: false });
  bath.openings.push({ id: newId("o"), kind: "door" as const, t: 800, width: 730, hinge: "a" as const, swingIn: false });

  // Symbols. Rotations: 0 faces +y (down on screen).
  const S = (type: string, x: number, y: number, rotation: number, wallId?: string): void => {
    f.symbols.push({ id: newId("s"), type, x, y, rotation, ...(wallId ? { wallId } : {}) });
  };
  // Along top wall (faces into room, +y): sockets & switch.
  S("socket-double", 900, 150, 0);
  S("switch-single", 3200, 150, 0);
  S("radiator", 3600, 5250, Math.PI);
  // Bathroom fixtures against right wall (face -x): rotation = angle(outNormal)-PI/2, outNormal=(-1,0) -> PI - PI/2 = PI/2
  S("toilet", 7850, 900, Math.PI / 2);
  S("sink", 7850, 1750, Math.PI / 2);
  // Bath along the top wall of bathroom area.
  S("bath", 6300, 150, 0);
  // Bedroom bits.
  S("socket-single", 4950, 3000, -Math.PI / 2);
  S("light-point", 6400, 3900, 0);
  S("light-point", 2200, 3600, 0);
  return doc;
}
