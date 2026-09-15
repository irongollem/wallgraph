// One framed wall's members placed in the wall's own plane. The takeoff
// (core/materials.ts) counts this layout and the elevation (render/frame.ts)
// draws it, so the drawing and the order cannot disagree.
import type { Floor, Id, Wall } from "../model/doc";
import {
  isFramedMaterial, openingHeight, openingSill, wallHeight, wallPostMm, wallPostWidthMm,
} from "../model/doc";
import type { MemberName } from "./materials";
import { postBays, type ResolvedWall } from "./resolve";
import { arcTangentAt } from "../geometry/arc";
import { dot, scale, v, type Vec } from "../geometry/vec";

export interface PlacedMember {
  name: MemberName;
  /** Rectangle in the wall's own plane, mm: x along the frame from the a end, y up from the floor. */
  x: number; y: number; w: number; h: number;
  sectionMm: { w: number; d: number };
  /** Cut length, mm: the rectangle's long side. */
  lengthMm: number;
  /** Pieces this rectangle stands for: 2 for a header, 1 otherwise. */
  count: number;
  spliceable: boolean;
}

export interface FrameLayout {
  lengthMm: number; heightMm: number;
  members: PlacedMember[];
  /** Openings as holes in the plane: x from the a end, y the sill, w the width, h the opening height. */
  openings: { openingId: Id; x: number; y: number; w: number; h: number }[];
}

/**
 * A framed wall's share of the backing stud(s) standing at each of its own
 * ends -- see computeBacking(). Split by end rather than carried as a single
 * total because the same wall can be the claiming wall at BOTH its ends (an
 * L at one end, a T at the other), and a placed member has to stand beside
 * the right end stud.
 */
export interface WallBacking { a: number; b: number }

const EMPTY_BACKING: WallBacking = { a: 0, b: 0 };

/** ~5 degrees either side of exactly opposite, in cosine terms -- the
 *  tolerance below treats two collinear wall-ends as a straight pass-through
 *  rather than a corner. */
const STRAIGHT_COS = -Math.cos(5 * Math.PI / 180);

/**
 * The backing stud(s) hidden in a corner or T/cross, per node, assigned to
 * exactly one of the framed walls that meet there -- the one with the lowest
 * `id`, so per-wall figures sum to the storey figure without double
 * counting -- and to whichever of ITS OWN ends touches that node, so a
 * placed member can stand beside the right end stud. Only walls stating both
 * a framed material and a post width count toward a node's degree; a block
 * wall meeting a framed one triggers nothing and is not counted.
 *
 * Degree 2: one backing stud (the three-stud corner) unless the two walls'
 * outgoing tangents at the node are within ~5 degrees of exactly opposite --
 * a straight run split into two walls, which resolveFloor() itself treats as
 * a plain pass-through (see its "parallel" miter case) and which needs no
 * extra stud. Degree 3+ (T or cross): two backing studs, no angle check --
 * every branch needs something to nail into regardless of the angle it
 * meets at.
 */
export function computeBacking(f: Floor): Map<Id, WallBacking> {
  const nodePos = new Map<Id, Vec>();
  for (const n of f.nodes) nodePos.set(n.id, v(n.x, n.y));

  const byNode = new Map<Id, { wall: Wall; out: Vec }[]>();
  const addEnd = (nodeId: Id, e: { wall: Wall; out: Vec }): void => {
    const arr = byNode.get(nodeId);
    if (arr) arr.push(e); else byNode.set(nodeId, [e]);
  };
  for (const w of f.walls) {
    if (!isFramedMaterial(w.material) || wallPostWidthMm(w) === undefined) continue;
    const A = nodePos.get(w.a), B = nodePos.get(w.b);
    if (!A || !B) continue;
    addEnd(w.a, { wall: w, out: arcTangentAt(A, B, w.bulge, 0) });
    addEnd(w.b, { wall: w, out: scale(arcTangentAt(A, B, w.bulge, 1), -1) });
  }

  const result = new Map<Id, WallBacking>();
  for (const [nodeId, ends] of byNode) {
    if (ends.length < 2) continue;
    if (ends.length === 2 && dot(ends[0]!.out, ends[1]!.out) <= STRAIGHT_COS) continue;
    const count = ends.length === 2 ? 1 : 2;
    const chosen = ends.reduce((min, e) => (e.wall.id < min.wall.id ? e : min), ends[0]!);
    const end: "a" | "b" = chosen.wall.a === nodeId ? "a" : "b";
    const cur = result.get(chosen.wall.id) ?? { a: 0, b: 0 };
    cur[end] += count;
    result.set(chosen.wall.id, cur);
  }
  return result;
}

/**
 * The equal-bay division of one opening's own span, the same way postBays()
 * divides a run of wall body: `ceil(width / spacing)` bays, rounded before
 * the ceiling so an exact division does not tip into an extra bay. Cripples
 * stand at the interior division points, one fewer than the bay count.
 */
function crippleCount(width: number, spacing: number): number {
  const bays = Math.max(1, Math.ceil(Number((width / spacing).toFixed(6))));
  return bays - 1;
}

/**
 * One framed wall's members, placed in the wall's own plane (x along the
 * frame from the a end, y up from the floor), plus its openings as holes in
 * that plane. Null unless the wall is framed with a stated post width --
 * a frame at these centres exists, but its member sizes do not.
 *
 * `x`/`y` positions use the centerline distances the document stores (t for
 * an opening, the bay divisions of postBays() for a stud) directly against
 * the frame length `lengthMm` (the mean of the two mitered faces, same as
 * core/materials.ts's own WallTakeoff.lengthMm) -- the two differ only where
 * a mitered face runs long or short at the wall's ends, which is exactly
 * where every rectangle here is clamped back into [0, lengthMm].
 *
 * The bottom plate is drawn as one continuous rectangle even under a
 * sill-less door: a real bottom plate stands first and is cut away for the
 * threshold afterwards, so the takeoff counts the continuous piece rather
 * than two short ones either side of the doorway.
 */
export function frameLayout(f: Floor, w: Wall, rw: ResolvedWall): FrameLayout | null {
  return layoutWithBacking(f, w, rw, computeBacking(f).get(w.id) ?? EMPTY_BACKING);
}

/**
 * Same as frameLayout(), but takes the floor's backing already computed --
 * for a caller (core/materials.ts) building every wall's layout in one pass,
 * so computeBacking() -- itself O(walls) -- runs once per floor rather than
 * once per wall.
 */
export function frameLayoutOf(
  f: Floor, w: Wall, rw: ResolvedWall, backing: ReadonlyMap<Id, WallBacking>,
): FrameLayout | null {
  return layoutWithBacking(f, w, rw, backing.get(w.id) ?? EMPTY_BACKING);
}

function layoutWithBacking(f: Floor, w: Wall, rw: ResolvedWall, backing: WallBacking): FrameLayout | null {
  if (!isFramedMaterial(w.material) || wallPostMm(w) === undefined) return null;
  const pw = wallPostWidthMm(w);
  if (pw === undefined) return null;

  const T = w.thickness;
  const H = wallHeight(f, w);
  const Lf = Math.round((rw.faces.left + rw.faces.right) / 2);
  const steel = w.material === "steel";
  const plateName: MemberName = steel ? "rail" : "plate";
  const section = { w: pw, d: T };
  const studLen = H - 2 * pw; // plates laid flat, top and bottom

  const members: PlacedMember[] = [];
  const clampX = (x: number, width: number): number => Math.max(0, Math.min(Lf - width, x));
  // A full-height member (stud/king/backing); x is the rectangle's left edge.
  const full = (name: MemberName, x: number): PlacedMember => ({
    name, x: clampX(x, pw), y: pw, w: pw, h: studLen,
    sectionMm: section, lengthMm: studLen, count: 1, spliceable: false,
  });

  // A stud at each drawn post position (postBays()/postsFor()'s own
  // division, so the order and the plan cannot disagree) plus one at each
  // wall end -- unless an opening's jamb sits within one post width of that
  // end, i.e. no run of body stands between the jamb and the node, in which
  // case the king stud below already occupies it.
  if (studLen > 0) {
    for (const bay of postBays(w, rw.intervals)) {
      for (let i = 1; i < bay.bays; i++) {
        members.push(full("stud", bay.from + bay.widthMm * i - pw / 2));
      }
    }
    const nearA = w.openings.length > 0 ? Math.min(...w.openings.map(o => o.t - o.width / 2)) : Infinity;
    const nearB = w.openings.length > 0 ? Math.min(...w.openings.map(o => rw.length - (o.t + o.width / 2))) : Infinity;
    if (nearA > pw) members.push(full("stud", 0));
    if (nearB > pw) members.push(full("stud", Lf - pw));
  }

  // Plates (rails for steel), top and bottom -- laid flat across the whole
  // frame length, including under a doorway (see the doc comment above).
  if (Lf > 0) {
    members.push({
      name: plateName, x: 0, y: 0, w: Lf, h: pw,
      sectionMm: section, lengthMm: Lf, count: 1, spliceable: true,
    });
    members.push({
      name: plateName, x: 0, y: H - pw, w: Lf, h: pw,
      sectionMm: section, lengthMm: Lf, count: 1, spliceable: true,
    });
  }

  // King studs stand full height beside every opening's jambs, timber and
  // steel alike -- a metal-stud opening is trimmed the same way a timber one
  // is, even though its header is someone else's trade (see below). Timber
  // stands them outside the jack stud; steel, with no jack, stands them
  // directly against the jamb.
  if (w.openings.length > 0 && studLen > 0) {
    for (const o of w.openings) {
      const jambL = o.t - o.width / 2, jambR = o.t + o.width / 2;
      if (steel) {
        members.push(full("king", jambL - pw), full("king", jambR));
      } else {
        members.push(full("king", jambL - 2 * pw), full("king", jambR + pw));
      }
    }
  }

  // Backing at this wall's share of its corners and junctions -- see
  // computeBacking(). Also shared by both systems: a corner needs a nailing
  // face whether the frame is timber or steel. Stands beside the end stud at
  // the end it was assigned to.
  if (studLen > 0) {
    for (let k = 0; k < backing.a; k++) members.push(full("backing", pw + k * pw));
    for (let k = 0; k < backing.b; k++) members.push(full("backing", Lf - 2 * pw - k * pw));
  }

  const openings: FrameLayout["openings"] = w.openings.map(o => ({
    openingId: o.id, x: o.t - o.width / 2, y: openingSill(o), w: o.width, h: openingHeight(o),
  }));

  if (steel) return { lengthMm: Lf, heightMm: H, members, openings }; // no noggings, headers or jacks; a door frame is its own trade

  // Jack (trimmer) studs carry the header, one pair per opening.
  for (const o of w.openings) {
    const jambL = o.t - o.width / 2, jambR = o.t + o.width / 2;
    const head = openingSill(o) + openingHeight(o);
    const jackLen = head - pw; // stands on the bottom plate
    if (jackLen > 0) {
      const jack = (x: number): PlacedMember => ({
        name: "jack", x: clampX(x, pw), y: pw, w: pw, h: jackLen,
        sectionMm: section, lengthMm: jackLen, count: 1, spliceable: false,
      });
      members.push(jack(jambL - pw), jack(jambR));
    }
  }

  const spacing = wallPostMm(w)!; // defined: the guard at the top would not have gotten here otherwise
  if (w.noggingRows && w.noggingRows > 0) {
    for (const bay of postBays(w, rw.intervals)) {
      for (let j = 0; j < bay.bays; j++) {
        const cellStart = bay.from + bay.widthMm * j;
        // The takeoff's own cut length: at an interior cell this sits flush
        // between the two bounding studs; at a run's own end it overlaps the
        // end/king stud there by half a post, because the cell itself runs
        // to the wall end while the nogging is inset by half a post on both
        // sides regardless.
        const cutW = Math.round(bay.widthMm - pw);
        if (cutW <= 0) continue;
        for (let r = 1; r <= w.noggingRows; r++) {
          const centerY = pw + r * (H - 2 * pw) / (w.noggingRows + 1);
          members.push({
            name: "nogging", x: clampX(cellStart + pw / 2, cutW), y: centerY - pw / 2, w: cutW, h: pw,
            sectionMm: section, lengthMm: cutW, count: 1, spliceable: false,
          });
        }
      }
    }
  }

  for (const o of w.openings) {
    const jambL = o.t - o.width / 2;
    const sill = openingSill(o), oh = openingHeight(o);
    const head = sill + oh;
    const headerLen = o.width + 2 * pw;
    if (headerLen > 0) {
      members.push({
        name: "header", x: clampX(jambL - pw, headerLen), y: head, w: headerLen, h: T,
        sectionMm: section, lengthMm: headerLen, count: 2, spliceable: false,
      });
    }
    if (sill > 0 && headerLen > 0) {
      members.push({
        name: "sill", x: clampX(jambL - pw, headerLen), y: sill - pw, w: headerLen, h: pw,
        sectionMm: section, lengthMm: headerLen, count: 1, spliceable: false,
      });
    }

    const cripples = crippleCount(o.width, spacing);
    if (cripples > 0) {
      const bays = cripples + 1;
      // Above the header: storey height less the top plate (laid flat, one
      // post width), the header's own depth (on edge, so the frame's
      // thickness) and the head height.
      const above = H - pw - T - head;
      if (above > 0) {
        for (let i = 1; i <= cripples; i++) {
          const cx = jambL + i * (o.width / bays);
          members.push({
            name: "cripple", x: clampX(cx - pw / 2, pw), y: head + T, w: pw, h: above,
            sectionMm: section, lengthMm: above, count: 1, spliceable: false,
          });
        }
      }
      // Below the sill: the sill height less the bottom plate and the sill
      // piece itself.
      const below = sill - 2 * pw;
      if (sill > 0 && below > 0) {
        for (let i = 1; i <= cripples; i++) {
          const cx = jambL + i * (o.width / bays);
          members.push({
            name: "cripple", x: clampX(cx - pw / 2, pw), y: pw, w: pw, h: below,
            sectionMm: section, lengthMm: below, count: 1, spliceable: false,
          });
        }
      }
    }
  }

  return { lengthMm: Lf, heightMm: H, members, openings };
}
