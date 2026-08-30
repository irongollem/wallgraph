// Aggregated stair registry, in the order the symbol sheet lists the kinds.
// tests/stairs.test.ts asserts that every kind on the StairKind union has an
// entry here, so the library cannot fall behind the document model.
import { StairDef } from "./defs";
import { StairKind, STAIR_KINDS } from "../../model/stair";
import { STAIRS_STRAIGHT } from "./straight";
import { STAIRS_TURNED } from "./turned";
import { STAIRS_SPIRAL } from "./spiral";
import { STAIRS_SPECIAL } from "./special";

export type { StairDef } from "./defs";

const ALL: StairDef[] = [
  ...STAIRS_STRAIGHT, ...STAIRS_TURNED, ...STAIRS_SPIRAL, ...STAIRS_SPECIAL,
];

const byKind = Object.fromEntries(ALL.map(d => [d.kind, d])) as Record<StairKind, StairDef>;

/** Every kind's drawing, in the order the sheet lists them. */
export const STAIRS: StairDef[] = STAIR_KINDS.map(k => byKind[k]);

export function getStair(kind: string): StairDef | undefined {
  return (byKind as Record<string, StairDef | undefined>)[kind];
}
