// Wall-top consistency: two walls meeting at a node whose profiles say
// different things about the height at that corner. Reported, never
// repaired -- see model/profile.ts and the model decision in issue #53.
import { Floor, Id } from "../model/doc";
import { wallLength } from "../model/ops";
import { wallTopAt } from "../model/profile";

export interface TopMismatch {
  nodeId: Id;
  walls: { wallId: Id; heightMm: number }[];
}

/** Beyond this the two tops are read as disagreeing rather than as rounding. */
const MISMATCH_TOL_MM = 1;

/**
 * Every node where walls END and at least one of them states a profile, and
 * the tops there disagree by more than a millimetre. Flat walls of different
 * heights meeting (a borstwering against a full-height wall) are ordinary and
 * not reported.
 *
 * Two walls meeting must agree. Where three or more meet, only the two highest
 * are compared: they carry the roof line through the junction, and a partition
 * ending below them is ordinary. A partition standing above one of them is
 * reported, since it then rises through the roof line.
 */
export function topMismatches(f: Floor): TopMismatch[] {
  const byNode = new Map<Id, { entries: { wallId: Id; heightMm: number }[]; sloped: boolean }>();
  const add = (nodeId: Id, wallId: Id, heightMm: number, sloped: boolean): void => {
    const at = byNode.get(nodeId) ?? { entries: [], sloped: false };
    at.entries.push({ wallId, heightMm });
    at.sloped ||= sloped;
    byNode.set(nodeId, at);
  };
  for (const w of f.walls) {
    const L = wallLength(f, w);
    const sloped = (w.profile?.length ?? 0) > 0;
    add(w.a, w.id, Math.round(wallTopAt(f, w, 0)), sloped);
    add(w.b, w.id, Math.round(wallTopAt(f, w, L)), sloped);
  }
  const out: TopMismatch[] = [];
  for (const [nodeId, { entries, sloped }] of byNode) {
    if (!sloped || entries.length < 2) continue;
    const top = entries.map(x => x.heightMm).sort((a, b) => b - a);
    if (top[0]! - top[1]! > MISMATCH_TOL_MM) out.push({ nodeId, walls: entries });
  }
  return out;
}
