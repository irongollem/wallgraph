// Joining two walls that nearly meet: the wall counterpart of the route merge
// in core/routegraph.ts, and deliberately the same shape. `planWallJoin` is
// pure and says both whether the join is possible and, when it is not, which
// condition failed -- so the pane can tell the reader "these do not reach"
// rather than silently withholding a button.
//
// The operation is CAD's extend-to-intersection, not a weld of what is already
// there: two walls drawn slightly short of each other are extended along their
// own directions to where those directions cross, and the two ends become one
// node. That handles a gap and an overlap with the same arithmetic, because the
// intersection is behind one end and beyond the other in the overlap case.
import { Floor, Wall, Id, wallFacadeMm, facadeSideOf } from "../model/doc";
import { Vec, v, add, sub, scale, dist, norm, perp, lineIntersect } from "../geometry/vec";
import { arcTangentAt } from "../geometry/arc";
import {
  nodeAt, mergeNodes, wallLength, flipWall, cleanOrphanNodes, clampOpening, deleteWall,
} from "../model/ops";

/** Which end of a wall a join moves. */
export interface JoinEnd { wallId: Id; end: "a" | "b" }

export interface WallJoinPlan {
  /** The two ends that move, one per wall. */
  ends: [JoinEnd, JoinEnd];
  /** Where they meet, integer mm. */
  at: Vec;
  /** The furthest either end travels to get there, mm. */
  reach: number;
  /**
   * True when the two directions never cross and the ends were simply welded
   * at their midpoint instead. Reported so the pane can say so: welding two
   * parallel walls is a different edit from extending them to a corner.
   */
  parallel: boolean;
}

/** Why a join is not on offer. Mirrors planRouteMerge's shape. */
export interface WallJoinRefusal {
  reason: "already" | "busy" | "apart";
}

export type WallJoinResult = WallJoinPlan | WallJoinRefusal;

export const isJoinPlan = (r: WallJoinResult | null): r is WallJoinPlan =>
  r !== null && "ends" in r;

/**
 * How far a wall may be stretched to reach the meeting point, as a multiple of
 * its own length. Two walls crossing at a shallow angle intersect a long way
 * off, and silently doubling a wall to get there is not a join -- it is a
 * different drawing.
 */
const REACH_LIMIT = 1;

/**
 * The join two selected walls would produce, or a refusal saying why not.
 * Null when the selection is not two walls at all, which is not a refusal to
 * explain -- there is simply nothing being asked.
 */
export function planWallJoin(f: Floor, ids: readonly Id[]): WallJoinResult | null {
  if (ids.length !== 2) return null;
  const w1 = f.walls.find(w => w.id === ids[0]);
  const w2 = f.walls.find(w => w.id === ids[1]);
  if (!w1 || !w2 || w1.id === w2.id) return null;

  // Already sharing a node: there is nothing to close.
  if (w1.a === w2.a || w1.a === w2.b || w1.b === w2.a || w1.b === w2.b) return { reason: "already" };

  // The closest pair of ends is the corner the drawer means.
  const pos = (id: Id): Vec | null => {
    const n = f.nodes.find(x => x.id === id);
    return n ? v(n.x, n.y) : null;
  };
  let best: { e1: JoinEnd; e2: JoinEnd; p1: Vec; p2: Vec; d: number } | null = null;
  for (const end1 of ["a", "b"] as const) {
    for (const end2 of ["a", "b"] as const) {
      const p1 = pos(end1 === "a" ? w1.a : w1.b), p2 = pos(end2 === "a" ? w2.a : w2.b);
      if (!p1 || !p2) continue;
      const d = dist(p1, p2);
      if (!best || d < best.d) {
        best = { e1: { wallId: w1.id, end: end1 }, e2: { wallId: w2.id, end: end2 }, p1, p2, d };
      }
    }
  }
  if (!best) return null;

  // Both ends must be free. Moving an end that other walls also hang off would
  // drag them along, which is a different edit from joining these two.
  const degree = (id: Id): number => f.walls.filter(w => w.a === id || w.b === id).length;
  const n1 = best.e1.end === "a" ? w1.a : w1.b;
  const n2 = best.e2.end === "a" ? w2.a : w2.b;
  if (degree(n1) > 1 || degree(n2) > 1) return { reason: "busy" };

  // Direction of each wall AT that end, pointing outward, so an arc extends
  // along its own tangent rather than along its chord.
  const outward = (w: Wall, end: "a" | "b"): Vec | null => {
    const A = pos(w.a), B = pos(w.b);
    if (!A || !B || dist(A, B) < 1) return null;
    const t = arcTangentAt(A, B, w.bulge, end === "a" ? 0 : 1);
    return end === "a" ? scale(t, -1) : t;   // out of the wall, not along it
  };
  const d1 = outward(w1, best.e1.end), d2 = outward(w2, best.e2.end);
  if (!d1 || !d2) return null;

  const cross = lineIntersect(best.p1, d1, best.p2, d2);
  const meet = cross ?? scale(add(best.p1, best.p2), 0.5);
  const reach = Math.max(dist(best.p1, meet), dist(best.p2, meet));
  const limit = REACH_LIMIT * Math.min(wallLength(f, w1), wallLength(f, w2));
  if (reach > limit) return { reason: "apart" };

  return {
    ends: [best.e1, best.e2],
    at: v(Math.round(meet.x), Math.round(meet.y)),
    reach: Math.round(reach),
    parallel: cross === null,
  };
}

/**
 * Carry out a plan: move both ends onto the meeting point and weld them into
 * one node. `nodeAt` rounds to integer mm and reuses a node already there, so
 * the corner lands on the graph rather than beside it.
 */
export function applyWallJoin(f: Floor, plan: WallJoinPlan): void {
  const node = nodeAt(f, plan.at, 0);
  const attach = (e: JoinEnd): Id | null => {
    const w = f.walls.find(x => x.id === e.wallId);
    if (!w) return null;
    const old = e.end === "a" ? w.a : w.b;
    if (e.end === "a") w.a = node.id; else w.b = node.id;
    return old;
  };
  // Re-point both ends first, then drop what they left behind: an end whose old
  // node is now unused would otherwise sit on the plan holding nothing.
  const freed = [attach(plan.ends[0]), attach(plan.ends[1])];
  for (const old of freed) {
    if (old && old !== node.id) mergeNodes(f, node.id, old);
  }
}


// ── dissolving a node ────────────────────────────────────────────────────────
//
// The inverse of splitWall(): a node with exactly two collinear walls on it is
// a node the drawing does not need, and removing it leaves one wall where there
// were two. Same plan/refuse shape as the join above, for the same reason.

export interface NodeDissolvePlan {
  nodeId: Id;
  /** The wall that survives, extended through the node. */
  keepId: Id;
  /** The wall absorbed into it. */
  dropId: Id;
  /** Length of the merged wall, mm. */
  length: number;
}

export interface NodeDissolveRefusal {
  reason: "degree" | "curved" | "bent" | "differs" | "opposed";
}

/**
 * Whether this wall can be reversed without changing its drawing. Everything
 * else in flipWall() turns cleanly; a sliding sash does not, because which side
 * its leaf runs on is taken from the wall normal and stored nowhere.
 */
const canFlip = (w: Wall): boolean =>
  w.openings.every(o => o.sashes.every(sh => sh.action !== "slide" && sh.action !== "turn-slide"));

export type NodeDissolveResult = NodeDissolvePlan | NodeDissolveRefusal;

export const isDissolvePlan = (r: NodeDissolveResult | null): r is NodeDissolvePlan =>
  r !== null && "keepId" in r;

/** Collinear within about half a degree, matching rooms.ts's straight-run rule. */
const STRAIGHT_TOL = 0.01;

/**
 * What removing this node would do, or a refusal saying why it cannot.
 *
 * Deliberately strict about the two walls agreeing. Merging a 100 wall into a
 * 200 one, or a clad wall into a bare one, would silently discard what one of
 * them states -- so the pane says they differ and leaves the drawing alone.
 */
export function planNodeDissolve(f: Floor, nodeId: Id): NodeDissolveResult | null {
  const at = f.nodes.find(n => n.id === nodeId);
  if (!at) return null;
  const touching = f.walls.filter(w => w.a === nodeId || w.b === nodeId);
  if (touching.length !== 2) return { reason: "degree" };
  const [w1, w2] = touching as [Wall, Wall];
  if (w1.bulge !== 0 || w2.bulge !== 0) return { reason: "curved" };

  const pos = (id: Id): Vec | null => {
    const n = f.nodes.find(x => x.id === id);
    return n ? v(n.x, n.y) : null;
  };
  const far = (w: Wall): Vec | null => pos(w.a === nodeId ? w.b : w.a);
  const f1 = far(w1), f2 = far(w2);
  if (!f1 || !f2) return null;
  const here = v(at.x, at.y);
  // Both directions point AWAY from the node, so a straight run has them
  // opposed: their dot product is -1.
  const d1 = norm(sub(f1, here)), d2 = norm(sub(f2, here));
  if (d1.x * d2.x + d1.y * d2.y > -1 + STRAIGHT_TOL) return { reason: "bent" };

  // Everything the two walls state about themselves has to match, or one of
  // them loses it. facadeSide is compared as a WORLD side: it is written in
  // each wall's own a->b frame, and the two may run opposite ways.
  const facadeNormal = (w: Wall): Vec | null => {
    if (wallFacadeMm(w) === undefined) return null;
    const A = pos(w.a), B = pos(w.b);
    if (!A || !B) return null;
    const n = perp(norm(sub(B, A)));
    return facadeSideOf(w) === "left" ? n : scale(n, -1);
  };
  const n1 = facadeNormal(w1), n2 = facadeNormal(w2);
  const sameFacadeSide = (n1 === null && n2 === null)
    || (n1 !== null && n2 !== null && n1.x * n2.x + n1.y * n2.y > 0.99);
  const same = w1.thickness === w2.thickness
    && w1.height === w2.height
    && w1.loadBearing === w2.loadBearing
    && w1.material === w2.material
    && w1.color === w2.color
    && w1.postMm === w2.postMm
    && w1.postWidthMm === w2.postWidthMm
    && w1.facadeMm === w2.facadeMm
    && sameFacadeSide
    && w1.fireRating?.kind === w2.fireRating?.kind
    && w1.fireRating?.minutes === w2.fireRating?.minutes;
  if (!same) return { reason: "differs" };

  // The merged wall runs keep.a -> drop.b, so `keep` has to END at the node and
  // `drop` has to START there. Two of the four ways the pair can be drawn need
  // no reversal at all -- which is every node splitWall() ever made. Where one
  // is needed, it goes to a wall that can survive it.
  const endsAt = (w: Wall): boolean => w.b === nodeId;
  const startsAt = (w: Wall): boolean => w.a === nodeId;
  let keep = w1, drop = w2;
  if (endsAt(w1) && startsAt(w2)) { keep = w1; drop = w2; }
  else if (endsAt(w2) && startsAt(w1)) { keep = w2; drop = w1; }
  else {
    // Both point the same way: exactly one has to be turned round.
    const turnable = [w1, w2].filter(canFlip);
    if (turnable.length === 0) return { reason: "opposed" };
    const turn = turnable[0]!;
    const other = turn === w1 ? w2 : w1;
    // Whichever is turned takes the role its NEW orientation fits.
    if (endsAt(other)) { keep = other; drop = turn; } else { keep = turn; drop = other; }
  }

  return {
    nodeId, keepId: keep.id, dropId: drop.id,
    length: Math.round(wallLength(f, w1) + wallLength(f, w2)),
  };
}

/**
 * The dissolve two SELECTED walls would produce, found from the node they share.
 *
 * The same operation planNodeDissolve() describes, reached the way a drawer
 * actually reaches for it: two collinear wall sections are two things on the
 * screen, and "merge these" is a statement about them rather than about the dot
 * between them. Null when the pair shares no node at all -- then there is
 * nothing to dissolve and planWallJoin() is the question being asked instead.
 */
export function planWallMerge(f: Floor, ids: readonly Id[]): NodeDissolveResult | null {
  if (ids.length !== 2) return null;
  const w1 = f.walls.find(w => w.id === ids[0]);
  const w2 = f.walls.find(w => w.id === ids[1]);
  if (!w1 || !w2 || w1.id === w2.id) return null;
  const shared = [w1.a, w1.b].find(id => id === w2.a || id === w2.b);
  return shared === undefined ? null : planNodeDissolve(f, shared);
}

/**
 * Carry out a dissolve: orient both walls through the node, move the survivor's
 * far end out to the other's, and carry the absorbed openings across at their
 * new distance from a. flipWall() keeps the drawing identical while doing it.
 */
export function applyNodeDissolve(f: Floor, plan: NodeDissolvePlan): void {
  const keep = f.walls.find(w => w.id === plan.keepId);
  const drop = f.walls.find(w => w.id === plan.dropId);
  if (keep && drop) mergeThrough(f, keep, drop, plan.nodeId);
}

/**
 * Merge `drop` into `keep` through the node they share.
 *
 * Both are oriented first so the result runs keep.a -> drop.b and every `t`
 * measures from the end it always did. The openings are clamped afterwards
 * because a merge through a BENT node straightens the pair, and the straight
 * line between the far ends is shorter than the two legs -- so an opening
 * carried over from the far leg can otherwise land past the end of the wall it
 * now belongs to. On a collinear merge the length is unchanged and the clamp
 * does nothing.
 */
function mergeThrough(f: Floor, keep: Wall, drop: Wall, nodeId: Id): void {
  if (keep.a === nodeId) flipWall(f, keep);
  if (drop.b === nodeId) flipWall(f, drop);
  const keepLength = wallLength(f, keep);
  for (const o of drop.openings) {
    o.t += keepLength;
    keep.openings.push(o);
  }
  keep.b = drop.b;
  f.walls = f.walls.filter(w => w.id !== drop.id);
  cleanOrphanNodes(f);
  for (const o of keep.openings) clampOpening(f, keep, o);
}

/**
 * Take one node out of the graph, healing what it joined.
 *
 * The wall counterpart of removeRoutePoint() in core/routegraph.ts, and
 * deliberately the same rule: a node of degree 2 DISSOLVES, its two walls
 * becoming one, so removing a redundant point from the middle of a run shortens
 * the drawing rather than cutting it in half. Any other degree loses its
 * incident walls -- which for a wall means only a LOOSE END, where there is no
 * second wall to heal into. A junction of three or more is refused outright and
 * nothing happens: removing it would leave three dangling ends, and quietly
 * deleting three walls is the very thing this exists to stop. Someone who
 * wants that has the pane's own "delete with walls" beside it.
 *
 * More permissive than planNodeDissolve(), on purpose. That plan backs the
 * OFFERED merge and refuses where merging would straighten a corner or discard
 * what one of the walls states, because a button that quietly loses a fire
 * rating is a trap. This is not an offer: Del says remove this node, and the
 * answer to that is the one a route gives -- the corner goes, the survivor's
 * own properties stand, and one Ctrl+Z puts it back.
 */
export type NodeRemoval =
  /** Degree 2: the two walls became one. */
  | "dissolved"
  /** Degree 0 or 1: there was nothing to heal, so the node and its one wall go. */
  | "cut"
  /** Degree 3 or more: nothing happened. */
  | "junction";

/**
 * What removing this node would do, without doing it. Pure, so the pane can
 * offer the action or say why it is not on offer.
 */
export function planNodeRemoval(f: Floor, nodeId: Id): NodeRemoval {
  const degree = f.walls.filter(w => w.a === nodeId || w.b === nodeId).length;
  return degree === 2 ? "dissolved" : degree >= 3 ? "junction" : "cut";
}

export function removeNode(f: Floor, nodeId: Id): NodeRemoval {
  const outcome = planNodeRemoval(f, nodeId);
  const touching = f.walls.filter(w => w.a === nodeId || w.b === nodeId);
  if (outcome === "junction") return outcome;
  if (outcome === "cut") {
    // A node with one wall on it IS that wall's end; there is no second wall to
    // heal into, so the wall goes with it. Nothing else this could mean.
    for (const w of [...touching]) deleteWall(f, w.id);
    cleanOrphanNodes(f);
    return "cut";
  }
  const [w1, w2] = touching as [Wall, Wall];
  // keep must end at the node and drop must start there. Two of the four ways
  // the pair can be drawn already do; the other two need one wall turned, and
  // the choice of which falls on a wall that survives being turned.
  let keep = w1, drop = w2;
  if (w1.a === nodeId && w2.a === nodeId) keep = canFlip(w1) ? w1 : w2;
  else if (w1.b === nodeId && w2.b === nodeId) keep = canFlip(w2) ? w1 : w2;
  else if (w2.b === nodeId) keep = w2;
  drop = keep === w1 ? w2 : w1;
  mergeThrough(f, keep, drop, nodeId);
  return "dissolved";
}
