// A voorzetwand (Wall.buildUp's FaceFrame) is drawn and counted as a wall of
// its own: frameLayout() and computeBacking() in core/frame.ts need real Wall
// records in a real Floor and a real ResolvedWall, not a band on the host
// wall's own resolve. This module synthesises them.
//
// NOTHING HERE IS EVER STORED. `Floor` and `Wall` are used as the SHAPE the
// geometry code already speaks -- resolveFloor(), frameLayout(),
// computeBacking() -- not as a document: a leaf floor is rebuilt whole from
// the host floor and its resolve on every revision, and nothing about it is
// written back into PlanDoc.
import {
  Floor, Wall, PlanNode, Id, Opening, ProfilePoint, FaceFrame,
  frameOf, wallHeight, floorHeight, frameZoneOf, faceRunsOf, normalizeFaceRuns,
} from "../model/doc";
import { wallTopAt, wallTopPolyline } from "../model/profile";
import { Vec, v, dist, sub, dot, norm, angleOf, perp, add, scale } from "../geometry/vec";
import { arcInfo, arcLength, sweepOf, arcPointAt, arcTangentAt } from "../geometry/arc";
import { resolveFloor, type Resolved, type ResolvedWall } from "./resolve";

/**
 * A floor's derived leaves: one synthetic Wall per host wall face that states
 * a voorzetwand, plus the nodes they share where two leaves meet. Never
 * stored -- see the module comment above.
 */
export interface LeafFloor {
  /** Nodes and walls only, never stored. */
  floor: Floor;
  /** A leaf wall's own id -> the host wall and face it was derived from. */
  hostOf: Map<Id, { wallId: Id; side: "left" | "right" }>;
  /**
   * The leaf derived from one host wall's face, or undefined where that face
   * states no frame. A face stating runs (see FaceBuildUp.runs) can carry
   * more than one leaf -- see leavesOf() -- and this returns the first
   * (lowest t) of them, for a caller reading one leaf per face.
   */
  leafOf(wallId: Id, side: "left" | "right"): Wall | undefined;
  /**
   * Every leaf derived from one host wall's face, in run order: one entry
   * where the face states no runs, or one run: several where a voorzetwand
   * stops either side of a column it is casing separately (see
   * FaceBuildUp.runs and leafclash.ts's proposedRuns()). Empty where that
   * face states no frame.
   */
  leavesOf(wallId: Id, side: "left" | "right"): Wall[];
}

/** The leaf floor and its own resolve, the pair every consumer needs. */
export interface Leaves { leaf: LeafFloor; resolved: Resolved }

/**
 * leafFloor() followed by resolveFloor() on the result. Leaf walls carry no
 * build-up of their own (leafFloor() never sets Wall.buildUp), so that
 * resolve produces no second generation of leaves -- ResolvedWall.frame and
 * .frameLine come back empty/absent for every leaf wall.
 */
export function resolveLeaves(f: Floor, resolved: Resolved): Leaves {
  const leaf = leafFloor(f, resolved);
  return { leaf, resolved: resolveFloor(leaf.floor) };
}

/**
 * The host-wall centerline mm position of world point `p`: on a straight wall
 * (bulge 0) the projection onto the tangent; on an arc, the same fraction of
 * the host's own sweep (see model/doc.ts's bulge convention, invariant 3).
 * Used to place a leaf's own ends -- which may not fall exactly at the host's
 * t = 0 / t = L, since a corner miter can shift them along the tangent --
 * against the host's own centerline parameterisation.
 */
function hostMmAt(A: Vec, B: Vec, bulge: number, hostLen: number, p: Vec): number {
  if (bulge === 0) return dot(sub(p, A), norm(sub(B, A)));
  const info = arcInfo(A, B, bulge);
  if (!info) return dot(sub(p, A), norm(sub(B, A)));
  const sweep = sweepOf(info);
  if (sweep === 0) return 0;
  const TAU = Math.PI * 2;
  let d = (angleOf(sub(p, info.center)) - info.a0) % TAU;
  if (info.ccw) { if (d > 0) d -= TAU; if (d <= -TAU) d += TAU; }
  else { if (d < 0) d += TAU; if (d >= TAU) d -= TAU; }
  return (d / sweep) * hostLen;
}

interface Candidate { id: Id; pos: Vec }

/**
 * The square end of a face's own frame-zone midline at host mm `t`: the
 * plain perpendicular offset of the host centerline, at the frame zone's own
 * mid-depth (half the host thickness plus the mean of gapMm and
 * gapMm + depthMm -- see frameZoneOf()), with no miter.
 *
 * Used for a run boundary that does not coincide with the host wall's own
 * end -- a voorzetwand stopping mid-face because a column is in the way. The
 * true-end case instead takes ResolvedWall.frameLine's mitered point, which
 * is built the same way (the midpoint of the frame zone's inner and outer
 * mitered corners); this is that same construction without a corner to
 * miter against, matching how resolveFloor()'s own degree-1 wall end is a
 * plain perpendicular offset with no miter either (solveCorners()'s
 * `ends.length === 1` branch). The LEAF wall's own square cap at this node
 * -- its end stud -- comes from that same degree-1 branch when
 * resolveLeaves() resolves the synthetic leaf floor; nothing here draws it.
 */
function squareEndAt(hostWall: Wall, rw: ResolvedWall, side: "left" | "right", t: number): Vec {
  const zone = frameZoneOf(hostWall, side)!;
  const depth = hostWall.thickness / 2 + (zone.from + zone.to) / 2;
  const frac = rw.length > 0 ? t / rw.length : 0;
  const p = arcPointAt(rw.a, rw.b, hostWall.bulge, frac);
  const n = perp(arcTangentAt(rw.a, rw.b, hostWall.bulge, frac));
  const sgn = side === "left" ? 1 : -1;
  return add(p, scale(n, sgn * depth));
}

/**
 * Cluster candidate leaf-node positions within 1 mm of each other into one
 * node: processed in ASCENDING id order so the first candidate encountered at
 * a location -- the one whose id sorts lowest -- becomes that cluster's own
 * representative, both for the node's id and its (already rounded) position.
 * Deterministic: the same plan always yields the same leaf floor.
 */
function clusterNodes(candidates: Candidate[]): { nodes: PlanNode[]; mapping: Map<Id, Id> } {
  const sorted = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const clusters: Candidate[] = [];
  const mapping = new Map<Id, Id>();
  for (const c of sorted) {
    const hit = clusters.find(cl => dist(cl.pos, c.pos) <= 1);
    if (hit) mapping.set(c.id, hit.id);
    else { clusters.push(c); mapping.set(c.id, c.id); }
  }
  const nodes = clusters.map(cl => ({ id: cl.id, x: Math.round(cl.pos.x), y: Math.round(cl.pos.y) }));
  return { nodes, mapping };
}

/**
 * The host's openings mapped onto the leaf: `t`/`width` scaled by `ratio` and
 * shifted so the leaf's own centerline starts at `startHostMm` on the host.
 * An opening wholly outside the leaf's span is dropped; one that overlaps it
 * partially is clamped to the span, and dropped instead if that leaves it
 * under 100 mm wide -- the minimum model/ops.ts's clampOpening() enforces.
 */
function mapOpenings(
  hostWall: Wall, side: "left" | "right", startHostMm: number, ratio: number, leafLen: number,
): Opening[] {
  const out: Opening[] = [];
  for (const o of hostWall.openings) {
    const hostFrom = o.t - o.width / 2, hostTo = o.t + o.width / 2;
    const leafFrom = (hostFrom - startHostMm) * ratio;
    const leafTo = (hostTo - startHostMm) * ratio;
    const clampedFrom = Math.max(0, leafFrom);
    const clampedTo = Math.min(leafLen, leafTo);
    if (clampedTo <= clampedFrom) continue; // wholly outside the leaf's span
    const width = Math.round(clampedTo - clampedFrom);
    if (width < 100) continue;
    const t = Math.round((clampedFrom + clampedTo) / 2);
    // The host's own lintel is not this frame's header. `lintel` states a
    // section someone chose for the wall above the opening and
    // `lintelLoadKNm` a floor bearing on that wall; a voorzetwand carries
    // neither, so copying them would let core/checks.ts's lintelCheck() pass
    // the host's section off as a header nobody specified, against a load a
    // stud frame does not take. Dropped, so the check reports incomplete with
    // a proposal instead.
    const { lintel: _lintel, lintelLoadKNm: _lintelLoad, ...rest } = o;
    out.push({ ...rest, id: `${o.id}~${side}`, t, width });
  }
  return out;
}

/**
 * The host's top profile mapped onto the leaf, capped at `frame.heightMm`
 * where one is stated. `wallTopAt()` anchors a WALL's own ends at
 * `wallHeight()` wherever its profile states no point there -- but the
 * leaf's own ends are not the host's, so this states them explicitly, at the
 * host's mapped height there, rather than relying on that anchoring.
 *
 * Where every resulting height comes out equal, no profile is stated and the
 * leaf's `height` carries that one value directly. Otherwise both are
 * stated: `height` falls back to the host's own (capped) wallHeight() as the
 * leaf's nominal figure, the same role Wall.height plays on an ordinary
 * sloped wall relative to its own profile.
 */
function mapProfile(
  hostFloor: Floor, hostWall: Wall, hostLen: number,
  startHostMm: number, endHostMm: number, mapT: (t: number) => number, leafLen: number,
  frame: FaceFrame,
): { profile?: ProfilePoint[]; height: number } {
  const cap = (h: number): number => frame.heightMm !== undefined ? Math.min(h, frame.heightMm) : h;
  const byT = new Map<number, number>();
  byT.set(0, Math.round(cap(wallTopAt(hostFloor, hostWall, startHostMm))));
  const leafEndT = Math.round(leafLen);
  byT.set(leafEndT, Math.round(cap(wallTopAt(hostFloor, hostWall, endHostMm))));
  for (const p of wallTopPolyline(hostFloor, hostWall, hostLen)) {
    if (p.s <= startHostMm || p.s >= endHostMm) continue;
    const t = mapT(p.s);
    if (t <= 0 || t >= leafEndT) continue;
    byT.set(t, Math.round(cap(p.h)));
  }
  const points = [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, height]) => ({ t, height }));
  const heights = points.map(p => p.height);
  if (heights.every(h => h === heights[0])) return { height: heights[0]! };
  return { profile: points, height: cap(wallHeight(hostFloor, hostWall)) };
}

/**
 * One host wall face's leaf: id `${hostWall.id}~${side}` -- the one place in
 * the codebase an id is derived from another instead of minted by newId(). A
 * leaf is addressed by the host wall and face it belongs to, and is
 * regenerated whole on every revision, so it needs a STABLE name rather than
 * a unique one -- two calls on the same document must derive the same id, or
 * every consumer that keys anything (selection, a takeoff row) off it would
 * see a different wall on every redraw.
 *
 * `startHostMm`/`endHostMm`/`ratio` map the host's own centerline mm onto the
 * leaf's: `ratio` is 1 on a straight wall and the radius ratio on an arc
 * (without needing either radius), since a concentric offset covers the same
 * included angle at a different radius -- see hostMmAt() and invariant 3.
 * `postFrom`/`postOffsetMm` are left unset: a leaf's "grid" postLayout is set
 * out from its own `a` end at phase 0, which is exactly what the defaults
 * already give (see Wall.postFrom/postOffsetMm).
 */
function buildLeafWall(
  hostFloor: Floor, hostWall: Wall, side: "left" | "right", frame: FaceFrame,
  rw: ResolvedWall, leafId: Id, aId: Id, bId: Id, aNode: PlanNode, bNode: PlanNode,
): Wall {
  const A = rw.a, B = rw.b, hostLen = rw.length, bulge = hostWall.bulge;
  const aWorld = v(aNode.x, aNode.y), bWorld = v(bNode.x, bNode.y);
  const startHostMm = hostMmAt(A, B, bulge, hostLen, aWorld);
  const endHostMm = hostMmAt(A, B, bulge, hostLen, bWorld);
  // Same bulge as the host (see the module doc comment): a concentric offset
  // of an arc keeps the same included angle, hence the same bulge.
  const leafLen = arcLength(aWorld, bWorld, bulge);
  const hostSpan = endHostMm - startHostMm;
  const ratio = hostSpan !== 0 ? leafLen / hostSpan : 1;
  const mapT = (hostT: number): number => Math.round((hostT - startHostMm) * ratio);

  const openings = mapOpenings(hostWall, side, startHostMm, ratio, leafLen);
  const { profile, height } = mapProfile(hostFloor, hostWall, hostLen, startHostMm, endHostMm, mapT, leafLen, frame);

  return {
    id: leafId, a: aId, b: bId,
    thickness: frame.depthMm,
    bulge,
    openings,
    material: frame.material,
    height,
    ...(profile ? { profile } : {}),
    ...(frame.postMm !== undefined ? { postMm: frame.postMm } : {}),
    ...(frame.postLayout !== undefined ? { postLayout: frame.postLayout } : {}),
    ...(frame.postWidthMm !== undefined ? { postWidthMm: frame.postWidthMm } : {}),
    ...(frame.noggingRows !== undefined ? { noggingRows: frame.noggingRows } : {}),
    ...(frame.insulated !== undefined ? { insulated: frame.insulated } : {}),
  };
}

/**
 * Every voorzetwand on this floor, as walls of their own. `resolved` must be
 * this floor's own resolveFloor() result -- ResolvedWall.frameLine is where
 * a leaf's centerline ends come from, and that field lives only there.
 */
export function leafFloor(f: Floor, resolved: Resolved): LeafFloor {
  interface Pending { hostWall: Wall; side: "left" | "right"; frame: FaceFrame; leafId: Id; aCand: Id; bCand: Id }
  const candidates: Candidate[] = [];
  const pending: Pending[] = [];

  for (const hostWall of f.walls) {
    const rw = resolved.walls.get(hostWall.id);
    if (!rw) continue;
    for (const side of ["left", "right"] as const) {
      const frame = frameOf(hostWall, side);
      const line = rw.frameLine[side];
      if (!frame || !line) continue;

      const rawRuns = faceRunsOf(hostWall, side);
      if (!rawRuns) {
        // Absent runs = the whole face: one leaf, the true wall ends,
        // unchanged from before FaceBuildUp.runs existed.
        const leafId = `${hostWall.id}~${side}`;
        const aCand = `${leafId}:a`, bCand = `${leafId}:b`;
        candidates.push({ id: aCand, pos: v(Math.round(line.a.x), Math.round(line.a.y)) });
        candidates.push({ id: bCand, pos: v(Math.round(line.b.x), Math.round(line.b.y)) });
        pending.push({ hostWall, side, frame, leafId, aCand, bCand });
        continue;
      }

      // Stated runs: one leaf per run -- normalised against the host's own
      // length first, so a stale or overlapping stored value cannot produce
      // overlapping leaves (see normalizeFaceRuns()). A run boundary at the
      // host's own end takes the mitered `line` point; an interior boundary
      // -- a column stopping the voorzetwand mid-face -- gets the square
      // offset instead (see squareEndAt()).
      const runs = normalizeFaceRuns(rawRuns, rw.length);
      runs.forEach((run, i) => {
        const leafId = `${hostWall.id}~${side}~${i}`;
        const aCand = `${leafId}:a`, bCand = `${leafId}:b`;
        const aPos = run.fromMm <= 0.5 ? line.a : squareEndAt(hostWall, rw, side, run.fromMm);
        const bPos = run.toMm >= rw.length - 0.5 ? line.b : squareEndAt(hostWall, rw, side, run.toMm);
        candidates.push({ id: aCand, pos: v(Math.round(aPos.x), Math.round(aPos.y)) });
        candidates.push({ id: bCand, pos: v(Math.round(bPos.x), Math.round(bPos.y)) });
        pending.push({ hostWall, side, frame, leafId, aCand, bCand });
      });
    }
  }

  const { nodes, mapping } = clusterNodes(candidates);
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  const walls: Wall[] = [];
  const hostOf = new Map<Id, { wallId: Id; side: "left" | "right" }>();
  const byKey = new Map<string, Wall[]>();

  for (const p of pending) {
    const rw = resolved.walls.get(p.hostWall.id)!;
    const aId = mapping.get(p.aCand)!, bId = mapping.get(p.bCand)!;
    // A host wall (or run) short enough that its own two ends cluster into
    // one node. That is a self-loop, which the half-edge walk and
    // computeBacking() both read as a wall meeting itself; there is no
    // voorzetwand to draw at that length anyway.
    if (aId === bId) continue;
    const aNode = nodeById.get(aId)!, bNode = nodeById.get(bId)!;
    const wall = buildLeafWall(f, p.hostWall, p.side, p.frame, rw, p.leafId, aId, bId, aNode, bNode);
    walls.push(wall);
    hostOf.set(wall.id, { wallId: p.hostWall.id, side: p.side });
    const key = `${p.hostWall.id}~${p.side}`;
    const arr = byKey.get(key);
    if (arr) arr.push(wall); else byKey.set(key, [wall]);
  }

  const floor: Floor = {
    id: `${f.id}~leaf`,
    name: `${f.name} (leaves)`,
    nodes, walls, symbols: [],
    height: floorHeight(f),
  };

  return {
    floor, hostOf,
    leafOf: (wallId, side) => byKey.get(`${wallId}~${side}`)?.[0],
    leavesOf: (wallId, side) => byKey.get(`${wallId}~${side}`) ?? [],
  };
}
