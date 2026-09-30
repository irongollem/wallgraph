// The whole-building triangle mesh: every storey's derived solids placed at
// its elevation and extruded into flat-shaded prisms for a 3D renderer.
//
// Conventions follow core/solids.ts: x/y stay document space (mm, y down) and
// z is height above Peil (mm, positive up); a renderer maps axes itself. Pure
// and uncached like the rest of the derived geometry — callers cache against
// the store revision.
import { PlanDoc, Floor, Id, floorElevation, floorHeight, stairsOf, furnishingsOf, decksOf, structureOf, type Wall, type DoorLeafMaterial } from "../model/doc";
import { roofPlanesOf } from "../model/roof";
import { floorSolids, FloorSolids, roofSlabSolids, glazedLeafParts, type BuildUpPrism } from "../core/solids";
import { structureSolids, columnCasingPieces, columnHeight } from "../core/structure";
import { resolveFloor } from "../core/resolve";
import { deckSolids } from "../core/deck";
import { deckJoistLayout } from "../core/trimmer";
import { stairSteps, StairStep } from "../core/stair3d";
import { furnishingSolids } from "../core/furnishing3d";
import {
  PATTERN_IDS, TEXTURE_LIMIT, texturesOf, type Texture, defaultAppearance, resolveAppearance, parseHexColor, type Appearance, type AppearanceOverride, type PatternId,
} from "../model/appearance";
import { INKS } from "../render/draw";
import { Vec, v, dist, polygonArea, mid, norm, add, sub, scale } from "../geometry/vec";
import { triangulatePolygon, triangulateWithHoles } from "./triangulate";

export interface Bounds3 { min: [number, number, number]; max: [number, number, number] }

/**
 * The part of the building a vertex belongs to, indexed by `Mesh3D.parts` and
 * `Mesh3D.glassParts`. The part names the element, not the soup it lands in:
 * a glass wall's body, junction and opening bands keep "wall"/"junction"
 * although they are drawn in the glass soup, while window panes and
 * glazed-leaf panes are "glass". Door leaves and a glazed leaf's rim are "door".
 */
export const MESH_PARTS = [
  "wall", "post", "junction", "facade", "board", "frame", "casing", "slab", "terrace", "roof",
  "stair", "deck", "structure", "fitout", "door", "glass",
] as const;
export type MeshPart = typeof MESH_PARTS[number];
const PART_INDEX = Object.fromEntries(MESH_PARTS.map((n, i) => [n, i])) as Record<MeshPart, number>;

export interface Mesh3D {
  /** Triangle soup: xyz per vertex, mm. x/y are document space (y down), z is height above Peil, positive up. */
  positions: Float32Array;
  /** Per-vertex face normals, unit length, same convention. Flat shading: vertices are not shared across faces. */
  normals: Float32Array;
  /** Per-vertex rgb, each channel 0..1. */
  colors: Float32Array;
  /** Per-vertex index into MESH_PARTS, one entry per vertex of `positions`. */
  parts: Uint8Array;
  /**
   * Per-vertex surface, vec4: x roughness 0..1, y index into PATTERN_IDS,
   * z reserved (0), w layer in `textures` (-1, none).
   */
  surfaces: Float32Array;
  /** Outline segments for GL_LINES rendering: consecutive xyz vertex pairs, mm. */
  edges: Float32Array;
  /**
   * The glass: window panes and glazed wall bodies, as a second soup the
   * renderer draws translucent after the opaque pass. Same layout as
   * positions/normals/colors; their outline segments stay in `edges`.
   */
  glassPositions: Float32Array;
  glassNormals: Float32Array;
  glassColors: Float32Array;
  /** Per-vertex index into MESH_PARTS, one entry per vertex of `glassPositions`. */
  glassParts: Uint8Array;
  /** Same layout as `surfaces`, one vec4 per vertex of `glassPositions`. */
  glassSurfaces: Float32Array;
  /** The plan textures the surface layers index, in layer order: at most
   *  TEXTURE_LIMIT, each with a valid size. The renderer uploads these. */
  textures: readonly Texture[];
  /** Null when the document yields no geometry. */
  bounds: Bounds3 | null;
}

export {
  WALL_COLOR, SLAB_COLOR, ROOF_COLOR, STAIR_COLOR, DOOR_COLOR, GLASS_COLOR, PANEL_COLOR, BOARD_COLOR,
  FRAME_COLOR, FACADE_COLOR, STEEL_COLOR, CASEWORK_COLOR, WORKTOP_COLOR, APPLIANCE_COLOR,
  SANITARY_COLOR, SOFT_COLOR,
} from "../model/appearance";

const PATTERN_INDEX = Object.fromEntries(PATTERN_IDS.map((n, i) => [n, i])) as Record<PatternId, number>;

/** Door leaf thickness, mm. */
const DOOR_LEAF_MM = 40;
/** Window pane thickness, mm. */
const GLASS_MM = 30;

/**
 * How far a top that would land exactly on the plate above is pulled down, mm.
 * A lower storey's walls end at floor-to-floor height, coplanar with the top
 * of the slab or terrace plate resting on them — two faces at one depth
 * z-fight. The seat is invisible at building scale and only applies where a
 * visible storey above actually carries a plate. Exported for the tests, which
 * verify seated volumes.
 */
export const PLATE_SEAT_MM = 10;

/**
 * Shadow gap between a wall top and the underside of a step crossing over it,
 * mm. A wall a flight passes over yields ONLY within the crossing interval —
 * the rest keeps its height — and the cut is per step, so the lowered top
 * rakes with the flight like a trapwang, a gap under each tread rather than
 * one flat cut.
 */
export const STAIR_CLEAR_MM = 50;
/** A cut that would leave less wall than this on the floor is omitted: a
 *  toe-high stub under the first treads is noise, not a wall. */
const WALL_STUB_MM = 100;

/** Height differences (mm) under which a prism is not emitted. */
const H_EPS = 1e-6;
/** Distance (mm) under which two ring vertices are one point. */
const RING_EPS = 1e-6;
/** Footprint areas (mm²) under which a prism is not emitted. */
const AREA_EPS = 1e-6;
/**
 * A vertical outline edge is drawn where the footprint turns by more than 30°
 * (incoming/outgoing direction cosine below this). Arcs are flattened into
 * many small turns, so an unthresholded edge per vertex would render a curved
 * wall as hatching.
 */
const EDGE_TURN_COS = Math.cos(Math.PI / 6);

/** Fraction each pen colour is blended toward white in phase mode, so flat shading stays readable. */
export const PHASE_LIGHTEN = 0.35;
/** An element stating no pen, or the default ink, in phase mode: light neutral grey. */
export const PHASE_EXISTING_COLOR: readonly [number, number, number] = [0.8, 0.8, 0.8];
/** The "remove" ink in phase mode. Not lightened: it is drawn at the glass alpha, which already pales it. */
export const PHASE_REMOVE_COLOR: readonly [number, number, number] = [1.0, 0.45, 0.0];

const PHASE_HEX = /^#[0-9a-fA-F]{6}$/;
const INK_HEX = (id: string): string => (INKS.find(i => i.id === id)?.hex ?? "").toLowerCase();

/**
 * The phase-mode look of one pen: the pen colour lightened by PHASE_LIGHTEN, no
 * pattern. `remove` marks the "remove" ink, whose geometry is emitted into the
 * translucent glass soup (drawn at the renderer's fixed glass alpha) and takes
 * PHASE_REMOVE_COLOR instead of the lightened pen.
 * Absent, invalid or default pens read as existing.
 */
export function phasePen(hex: string | undefined): { look: Appearance; remove: boolean } {
  const flat = (color: readonly [number, number, number]): Appearance => ({ color, roughness: 0.9, pattern: "none" });
  const rgb = hex && PHASE_HEX.test(hex) ? parseHexColor(hex) : null;
  if (!hex || !rgb) return { look: flat(PHASE_EXISTING_COLOR), remove: false };
  if (hex.toLowerCase() === INK_HEX("remove")) return { look: flat(PHASE_REMOVE_COLOR), remove: true };
  const k = PHASE_LIGHTEN;
  const light: [number, number, number] = [rgb[0] + (1 - rgb[0]) * k, rgb[1] + (1 - rgb[1]) * k, rgb[2] + (1 - rgb[2]) * k];
  return { look: flat(light), remove: false };
}

interface MeshAcc {
  positions: number[]; normals: number[]; colors: number[]; edges: number[];
  glassPositions: number[]; glassNormals: number[]; glassColors: number[];
  parts: number[]; glassParts: number[];
  surfaces: number[]; glassSurfaces: number[];
  /** Texture id to its layer in `Mesh3D.textures`. */
  layers: Map<Id, number>;
}

/**
 * The building as one triangle soup: per storey, wall prisms (with the bands a
 * window's borstwering and an opening's lintel put back) and the junction
 * wedges between them, door leaves and window panes in the voids, the slab and
 * terrace plate with their holes, each stair as the steps core/stair3d.ts
 * derives from its parameters, and the inrichting as the parts
 * core/furnishing3d.ts derives per form. A wall a flight crosses is cut to a
 * shadow gap under the steps within the crossing interval (STAIR_CLEAR_MM).
 * Spaces are room volumes, not built fabric, and are not rendered.
 *
 * `hiddenFloors` drops whole storeys by floor id — the 3D view's per-storey
 * toggle. A hidden storey also withholds its plate, so the storey below is
 * shown unseated (see PLATE_SEAT_MM) and open from above.
 */
export function buildSceneMesh(doc: PlanDoc, hiddenFloors?: ReadonlySet<Id>, opts?: { phase?: boolean }): Mesh3D {
  const phase = opts?.phase === true;
  // Phase mode: colour by pen instead of appearance. `sty` swaps in the pen's
  // look and moves a "remove" element into the glass soup; parts stay truthful.
  const sty = (look: Appearance, glass: boolean, pen: string | undefined): [Appearance, boolean] => {
    if (!phase) return [look, glass];
    const p = phasePen(pen);
    return [p.look, glass || p.remove];
  };
  const noPen = (look: Appearance): Appearance => (phase ? phasePen(undefined).look : look);
  const textures = texturesOf(doc)
    .filter(x => Number.isInteger(x.widthMm) && x.widthMm > 0 && Number.isInteger(x.heightMm) && x.heightMm > 0)
    .slice(0, TEXTURE_LIMIT);
  const acc: MeshAcc = {
    positions: [], normals: [], colors: [], edges: [],
    glassPositions: [], glassNormals: [], glassColors: [],
    parts: [], glassParts: [],
    surfaces: [], glassSurfaces: [],
    layers: new Map(textures.map((x, i) => [x.id, i] as const)),
  };
  const solids: (FloorSolids | null)[] = doc.floors.map((_, i) => floorSolids(doc, i));

  for (let i = 0; i < doc.floors.length; i++) {
    const fs = solids[i];
    const f = doc.floors[i]!;
    if (hiddenFloors?.has(f.id)) continue;
    const elev = floorElevation(doc, i);

    // A visible storey above with a plate at this storey's ceiling rests on
    // everything that reaches floor-to-floor height; seat those tops so the
    // coplanar faces cannot z-fight. Deliberately taller walls still pierce.
    const fh = floorHeight(f);
    const aboveFloor = doc.floors[i + 1];
    const above = aboveFloor && !hiddenFloors?.has(aboveFloor.id) ? solids[i + 1] : null;
    const covered = above !== null && above !== undefined && (above.slab !== null || above.terrace !== null);
    const seat = (t: number): number =>
      covered && t > fh - PLATE_SEAT_MM && t <= fh + 0.5 ? fh - PLATE_SEAT_MM : t;

    // Structure stands on its own: a column under a vide or a beam across an
    // open hall needs no wall on the storey, so it is emitted before the
    // wall-and-slab geometry that floorSolids() gates on walls.
    const structure = structureOf(f);
    for (const [si, s] of structureSolids(f).entries()) {
      const look = resolveAppearance({ part: "wall", ...(s.material ? { material: s.material } : {}) }, structure[si]?.appearance);
      emitPrism(acc, s.poly, [], elev + s.z0, elev + seat(s.z1), sty(look, false, structure[si]?.color)[0], "structure", sty(look, false, structure[si]?.color)[1]);
    }

    // A column's casing (Column.casing), the same flat massing style as
    // everything else here: one prism per band per EXPOSED sub-segment
    // (core/structure.ts's columnCasingPieces(), wall-clipped the same way
    // the takeoff's columnExposedPerimeterMm() is -- a face buried in a wall
    // gets no casing prism), coloured like a wall's own build-up -- the
    // voorzetwand zone as FRAME_COLOR, a board as BOARD_COLOR regardless of
    // kind, since 3D massing does not distinguish board kinds the way the
    // plan's own fills do.
    const casingWalls = [...resolveFloor(f).walls.values()];
    for (const el of structure) {
      if (el.kind !== "column" || !el.casing) continue;
      const z1 = columnHeight(f, el);
      for (const piece of columnCasingPieces(el, casingWalls)) {
        const look = piece.kind === "frame"
          ? defaultAppearance({ part: "frame", material: el.casing.frame?.material ?? "timber" })
          : defaultAppearance({ part: "board", kind: piece.kind });
        emitPrism(acc, piece.poly, [], elev, elev + seat(z1), sty(look, false, el.color)[0], "casing", sty(look, false, el.color)[1]);
      }
    }

    // A deck stands on its own for the same reason: a vliering is built into a
    // storey whether or not its walls are drawn. Timber, like a door leaf.
    for (const dk of decksOf(f)) {
      const look = resolveAppearance({ part: "deck" }, dk.appearance);
      for (const s of deckSolids(dk, deckJoistLayout(f, dk))) emitPrism(acc, s.poly, [], elev + s.z0, elev + s.z1, sty(look, false, dk.color)[0], "deck", sty(look, false, dk.color)[1]);
    }

    // The inrichting stands on its own for the same reason: each piece as the
    // parts its own form stands as, on a storey with or without walls. Nothing
    // cuts a piece against the fabric, so a unit drawn through a wall renders
    // through it.
    for (const fn of furnishingsOf(f)) {
      for (const part of furnishingSolids(fn)) {
        emitPrism(acc, part.poly, part.holes ?? [], elev + part.z0, elev + part.z1,
          sty(resolveAppearance({ part: "fitout", material: part.material }, fn.appearance), false, fn.color)[0], "fitout", sty(resolveAppearance({ part: "fitout", material: part.material }, fn.appearance), false, fn.color)[1]);
      }
    }
    // Roof planes stand on their own for the same reason as structure and
    // decks: authored independently of the wall graph (model/roof.ts), a
    // plane can cover a storey with no walls at all.
    const planes = new Map(roofPlanesOf(f).map(pl => [pl.id, pl] as const));
    for (const rs of roofSlabSolids(f)) {
      const look = resolveAppearance({ part: "roof" }, planes.get(rs.planeId)?.appearance);
      emitRoofSlab(acc, rs.poly, rs.bottom.map(h => elev + h), rs.top.map(h => elev + h), noPen(look), "roof");
    }
    if (!fs) continue;

    // Steps are derived once per stair: the stairs are drawn from them, and
    // the walls they cross are cut against them.
    const stepLists = stairsOf(f).map(st => stairSteps(f, st));
    const axes = wallAxes(f);
    const cuts = stairCuts(axes, stepLists);

    const wallById = new Map(f.walls.map(wl => [wl.id, wl] as const));
    for (const w of fs.walls) {
      const ax = axes.get(w.wallId);
      const spans = cuts.get(w.wallId);
      // An infill wall keeps its 2D reading: a glazed body is glass and drawn
      // translucent, a sandwich body the warm panel band; the posts carrying
      // either are solid frame.
      const wallRec = wallById.get(w.wallId);
      const mat = wallRec?.material;
      const [bodyLook, glass] = sty(
        resolveAppearance({ part: "wall", ...(mat ? { material: mat } : {}) }, wallRec?.appearance),
        mat === "glass", wallRec?.color);
      const [postLook] = sty(defaultAppearance({ part: "post" }), false, wallRec?.color);
      const skinGlass = phase && phasePen(wallRec?.color).remove;
      for (const p of w.body) {
        // A sloped piece is seated per vertex: only the vertices that would
        // actually meet a plate above are pulled down, so a gable that only
        // touches the roof near its peak keeps its eaves at their own height.
        const top = p.top?.map(seat);
        const z1 = top ? Math.max(...top) : seat(p.z1);
        emitWallPrism(acc, p.poly, elev, p.z0, z1, ax, spans, bodyLook, "wall", glass, top);
      }
      for (const p of w.posts) emitWallPrism(acc, p.poly, elev, p.z0, seat(p.z1), ax, spans, postLook, "post", skinGlass);
      // A face's board stack and its voorzetwand's own frame zone: massing
      // outside the structural body, cut by the same stair shadow and seated
      // against the same plate above, one flat colour per part (no per-board
      // texture, no individual studs — see core/solids.ts's buildUpPrisms()).
      for (const p of w.buildUp) {
        const top = p.top?.map(seat);
        const z1 = top ? Math.max(...top) : seat(p.z1);
        emitWallPrism(acc, p.poly, elev, p.z0, z1, ax, spans, sty(buildUpLook(wallRec, p), false, wallRec?.color)[0], p.part === "frame" ? "frame" : "board", skinGlass, top);
      }
      // The cladding: same cut and seat as the build-up, one flat colour.
      for (const p of w.facade) {
        const top = p.top?.map(seat);
        const z1 = top ? Math.max(...top) : seat(p.z1);
        emitWallPrism(acc, p.poly, elev, p.z0, z1, ax, spans, sty(resolveAppearance({ part: "facade" }, wallRec?.facadeAppearance), false, wallRec?.color)[0], "facade", skinGlass, top);
      }
      // The resolved pieces are the solid intervals BETWEEN openings, cut at
      // full wall height. The band below a sill and the band above a head put
      // that material back, so a wall with a window is exact without CSG.
      // On a sloped wall the band above a head is `o.above`, built by
      // core/solids.ts to follow the profile.
      const h = seat(Math.max(
        0, ...w.body.map(p => p.top ? Math.max(...p.top) : p.z1), ...w.voids.map(o => o.z1),
      ));
      for (const o of w.voids) {
        // A cut over the opening lowers its bands and shortens its filler the
        // same way it lowers the wall around them.
        const lid = ax && spans ? spanTopAt(spans, midT(ax, o.poly)) : Infinity;
        const sillTop = Math.min(o.z0, lid);
        if (sillTop > H_EPS) emitPrism(acc, o.poly, [], elev, elev + sillTop, bodyLook, "wall", glass);
        if (o.above) {
          for (const p of o.above) {
            const top = p.top?.map(z => seat(Math.min(z, lid)));
            const z1 = top ? Math.max(...top) : seat(Math.min(p.z1, lid));
            if (z1 > o.z1 + H_EPS) emitWallPrism(acc, p.poly, elev, o.z1, z1, ax, spans, bodyLook, "wall", glass, top);
          }
        } else if (o.z1 < h - H_EPS && lid > o.z1) {
          emitPrism(acc, o.poly, [], elev + o.z1, elev + Math.min(h, lid), bodyLook, "wall", glass);
        }
        // What fills the hole: a leaf for a door, a pane for a window,
        // nothing for a passage. A thin slice on the centerline, so it reads
        // through the opening from both sides.
        if (o.kind !== "passage") {
          const openingLook = wallRec?.openings.find(op => op.id === o.openingId)?.appearance;
          const slice = fillerQuad(o.poly, o.kind === "door" ? DOOR_LEAF_MM : GLASS_MM);
          const fillTop = Math.min(o.z1, lid);
          if (o.glazedLeaves) {
            const pane = fillerQuad(o.poly, GLASS_MM);
            if (slice && pane && fillTop > o.z0 + H_EPS) {
              emitGlazedLeaves(acc, slice, pane, o.glazedLeaves, elev + o.z0, elev + fillTop,
                sty(leafLook(o.leafMaterial, openingLook), false, wallRec?.color)[0]);
            }
          } else if (slice && fillTop > o.z0 + H_EPS) {
            const leaf = o.kind === "door";
            emitPrism(acc, slice, [], elev + o.z0, elev + fillTop,
              leaf ? sty(leafLook(o.leafMaterial, openingLook), false, wallRec?.color)[0] : defaultAppearance({ part: "glass" }),
              leaf ? "door" : "glass", o.kind === "window" || (leaf && skinGlass));
          }
        }
      }
    }
    const junctionWalls = phase ? resolveFloor(f).junctions : [];
    for (const [ji, j] of fs.junctions.entries()) {
      // A junction belongs to no wall: it takes the pen its meeting walls share, else none.
      const pens = new Set((junctionWalls[ji]?.walls ?? []).map(id => wallById.get(id)?.color?.toLowerCase() ?? ""));
      const jPen = pens.size === 1 ? [...pens][0] || undefined : undefined;
      const look0 = j.material === "glass" || j.material === "sandwich"
        ? defaultAppearance({ part: "wall", material: j.material })
        : defaultAppearance({ part: "junction" });
      const [look, jGlass] = sty(look0, j.material === "glass", jPen);
      emitPrism(acc, j.poly, [], elev + j.z0, elev + seat(j.z1), look, "junction", jGlass);
    }

    if (fs.slab) {
      emitPrism(acc, fs.slab.outline, fs.slab.holes, elev + fs.slab.z0, elev + fs.slab.z1, noPen(defaultAppearance({ part: "slab" })), "slab");
    }
    if (fs.terrace) {
      emitPrism(acc, fs.terrace.outline, fs.terrace.holes, elev + fs.terrace.z0, elev + fs.terrace.z1, noPen(defaultAppearance({ part: "terrace" })), "terrace");
    }

    for (const [si, steps] of stepLists.entries()) {
      const look = resolveAppearance({ part: "stair" }, stairsOf(f)[si]?.appearance);
      for (const step of steps) {
        emitPrism(acc, step.poly, [], elev + step.z0, elev + seat(step.z1), sty(look, false, stairsOf(f)[si]?.color)[0], "stair", sty(look, false, stairsOf(f)[si]?.color)[1]);
      }
    }
  }

  return {
    positions: new Float32Array(acc.positions),
    normals: new Float32Array(acc.normals),
    colors: new Float32Array(acc.colors),
    edges: new Float32Array(acc.edges),
    glassPositions: new Float32Array(acc.glassPositions),
    glassNormals: new Float32Array(acc.glassNormals),
    glassColors: new Float32Array(acc.glassColors),
    parts: new Uint8Array(acc.parts),
    glassParts: new Uint8Array(acc.glassParts),
    surfaces: new Float32Array(acc.surfaces),
    glassSurfaces: new Float32Array(acc.glassSurfaces),
    textures,
    bounds: boundsOf(acc.positions, acc.glassPositions),
  };
}

/**
 * One extruded footprint: caps triangulated (holes bridged into the outer
 * ring), one quad per boundary edge including hole loops, vertices duplicated
 * per face for flat shading.
 *
 * `top`, parallel to `footprint`, gives the outer ring's roof a height per
 * vertex instead of one flat `z1` -- a sloped wall piece (core/solids.ts's
 * `Prism.top`). Never combined with holes: every caller that carries a `top`
 * passes none. `z1` still gates emission and still bounds the bottom cap.
 *
 * Orientation invariant: rings are normalized by shoelace sign (outer
 * positive, holes negative, in raw x/y terms), and faces are wound so the
 * closed prism's signed volume Σ dot(a, cross(b, c))/6 over its triangles is
 * positive and equals footprint area × height -- unaffected by a sloped roof,
 * since the flat-topped case (`top` absent) is exactly the prior code path.
 */
function emitPrism(
  acc: MeshAcc, footprint: Vec[], holes: Vec[][], z0: number, z1: number, look: Appearance, part: MeshPart, glass = false,
  top?: number[],
): void {
  if (!(z1 - z0 > H_EPS)) return;
  const { ring: outer, top: outerTopIn } = cleanRingWithTop(footprint, top);
  if (outer.length < 3 || Math.abs(polygonArea(outer)) <= AREA_EPS) return;
  let outerTop = outerTopIn;
  if (polygonArea(outer) < 0) { outer.reverse(); outerTop?.reverse(); }

  const rings: Vec[][] = [outer];
  for (const h of holes) {
    const r = cleanRing(h);
    if (r.length < 3 || Math.abs(polygonArea(r)) <= AREA_EPS) continue;
    if (polygonArea(r) > 0) r.reverse();
    rings.push(r);
  }
  const holeRings = rings.slice(1);
  // A ring whose vertices were cleaned or reordered no longer indexes into
  // `top` at all; only the no-holes path (the only one a `top` caller uses)
  // keeps cap.verts === outer, so a hole ring's cap stays flat at z1.
  const ringsTop: (number[] | undefined)[] = [outerTop, ...holeRings.map(() => undefined)];

  // Caps. Triangles come back in the outer ring's (positive) winding, which
  // faces +z; the bottom cap reverses them to face -z.
  const cap = holeRings.length > 0
    ? triangulateWithHoles(outer, holeRings)
    : { verts: outer, tris: triangulatePolygon(outer) };
  for (let i = 0; i + 2 < cap.tris.length; i += 3) {
    const ia = cap.tris[i]!, ib = cap.tris[i + 1]!, ic = cap.tris[i + 2]!;
    const a = cap.verts[ia]!, b = cap.verts[ib]!, c = cap.verts[ic]!;
    const za = outerTop && holeRings.length === 0 ? outerTop[ia]! : z1;
    const zb = outerTop && holeRings.length === 0 ? outerTop[ib]! : z1;
    const zc = outerTop && holeRings.length === 0 ? outerTop[ic]! : z1;
    pushTri(acc, a.x, a.y, za, b.x, b.y, zb, c.x, c.y, zc, look, part, glass);
    pushTri(acc, a.x, a.y, z0, c.x, c.y, z0, b.x, b.y, z0, look, part, glass);
  }

  // Sides and outline edges. With the outer ring positive and hole rings
  // negative, material lies left of travel on every ring, so the quad winding
  // and the outward normal are one rule for both.
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri]!;
    const rTop = ringsTop[ri];
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p = ring[i]!, q = ring[(i + 1) % n]!;
      const zp = rTop ? rTop[i]! : z1, zq = rTop ? rTop[(i + 1) % n]! : z1;
      pushTri(acc, p.x, p.y, z0, q.x, q.y, z0, q.x, q.y, zq, look, part, glass);
      pushTri(acc, p.x, p.y, z0, q.x, q.y, zq, p.x, p.y, zp, look, part, glass);
      acc.edges.push(p.x, p.y, z0, q.x, q.y, z0);
      acc.edges.push(p.x, p.y, zp, q.x, q.y, zq);
    }
    for (let i = 0; i < n; i++) {
      const prev = ring[(i + n - 1) % n]!, cur = ring[i]!, next = ring[(i + 1) % n]!;
      if (turnCos(prev, cur, next) < EDGE_TURN_COS) {
        acc.edges.push(cur.x, cur.y, z0, cur.x, cur.y, rTop ? rTop[i]! : z1);
      }
    }
  }
}

/**
 * A roof plane slab: bottom and top are BOTH per-vertex (core/solids.ts's
 * RoofSlabSolid), unlike emitPrism()'s flat z0 with an optional sloped top --
 * a roof plane has no flat face at all, top and bottom being the same
 * outline offset a constant vertical amount apart. Caps triangulated once and
 * read at both heights (reversed winding for the bottom, which faces -z);
 * sides and outline edges follow the same per-edge shape emitPrism() uses.
 */
function emitRoofSlab(acc: MeshAcc, footprint: Vec[], bottomIn: number[], topIn: number[], look: Appearance, part: MeshPart): void {
  const ring: Vec[] = [], bottom: number[] = [], top: number[] = [];
  for (let i = 0; i < footprint.length; i++) {
    const p = footprint[i]!;
    const last = ring[ring.length - 1];
    if (!last || dist(last, p) > RING_EPS) { ring.push(p); bottom.push(bottomIn[i]!); top.push(topIn[i]!); }
  }
  while (ring.length > 1 && dist(ring[0]!, ring[ring.length - 1]!) <= RING_EPS) { ring.pop(); bottom.pop(); top.pop(); }
  if (ring.length < 3 || Math.abs(polygonArea(ring)) <= AREA_EPS) return;
  if (polygonArea(ring) < 0) { ring.reverse(); bottom.reverse(); top.reverse(); }

  const tris = triangulatePolygon(ring);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const ia = tris[i]!, ib = tris[i + 1]!, ic = tris[i + 2]!;
    const a = ring[ia]!, b = ring[ib]!, c = ring[ic]!;
    pushTri(acc, a.x, a.y, top[ia]!, b.x, b.y, top[ib]!, c.x, c.y, top[ic]!, look, part);
    pushTri(acc, a.x, a.y, bottom[ia]!, c.x, c.y, bottom[ic]!, b.x, b.y, bottom[ib]!, look, part);
  }

  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p = ring[i]!, q = ring[(i + 1) % n]!;
    const pb = bottom[i]!, qb = bottom[(i + 1) % n]!, pt = top[i]!, qt = top[(i + 1) % n]!;
    pushTri(acc, p.x, p.y, pb, q.x, q.y, qb, q.x, q.y, qt, look, part);
    pushTri(acc, p.x, p.y, pb, q.x, q.y, qt, p.x, p.y, pt, look, part);
    acc.edges.push(p.x, p.y, pb, q.x, q.y, qb);
    acc.edges.push(p.x, p.y, pt, q.x, q.y, qt);
  }
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n]!, cur = ring[i]!, next = ring[(i + 1) % n]!;
    if (turnCos(prev, cur, next) < EDGE_TURN_COS) {
      acc.edges.push(cur.x, cur.y, bottom[i]!, cur.x, cur.y, top[i]!);
    }
  }
}

/** One triangle with its face normal; a degenerate triangle is skipped. */
function pushTri(
  acc: MeshAcc,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  look: Appearance, part: MeshPart, glass = false,
): void {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l <= AREA_EPS) return;
  const pos = glass ? acc.glassPositions : acc.positions;
  const nrm = glass ? acc.glassNormals : acc.normals;
  const col = glass ? acc.glassColors : acc.colors;
  const srf = glass ? acc.glassSurfaces : acc.surfaces;
  const prt = glass ? acc.glassParts : acc.parts;
  // A held texture replaces pattern and colour: the image is the albedo.
  const layer = look.texture === undefined ? undefined : acc.layers.get(look.texture);
  pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  for (let k = 0; k < 3; k++) {
    prt.push(PART_INDEX[part]);
    nrm.push(nx / l, ny / l, nz / l);
    if (layer === undefined) {
      col.push(look.color[0], look.color[1], look.color[2]);
      srf.push(look.roughness, PATTERN_INDEX[look.pattern], 0, -1);
    } else {
      col.push(1, 1, 1);
      srf.push(look.roughness, PATTERN_INDEX.none, 0, layer);
    }
  }
}

/**
 * The thin slice a door leaf or window pane occupies: the void quad collapsed
 * to the wall centerline and re-thickened to `t`. The void quad is built as
 * [start+n·half, end+n·half, end−n·half, start−n·half], so opposite corners
 * pair across the wall. Null for a degenerate quad.
 */
function fillerQuad(poly: Vec[], t: number): Vec[] | null {
  const [v0, v1, v2, v3] = poly;
  if (poly.length !== 4 || !v0 || !v1 || !v2 || !v3) return null;
  const c0 = mid(v0, v3), c1 = mid(v1, v2);
  if (dist(c0, c1) <= RING_EPS) return null;
  const d0 = norm(sub(v0, v3)), d1 = norm(sub(v1, v2));
  return [
    add(c0, scale(d0, t / 2)), add(c1, scale(d1, t / 2)),
    sub(c1, scale(d1, t / 2)), sub(c0, scale(d0, t / 2)),
  ];
}

/**
 * A door leaf's look: timber by default, steel where the leaf is steel, with the
 * opening's own override applied over either.
 */
function leafLook(material: DoorLeafMaterial | undefined, override: AppearanceOverride | undefined): Appearance {
  return material === "steel"
    ? resolveAppearance({ part: "frame", material: "steel" }, override)
    : resolveAppearance({ part: "door" }, override);
}

/**
 * A wall's build-up piece: the frame zone by its material, a board by its kind.
 * The outermost board of a face also takes that face's authored appearance.
 */
function buildUpLook(w: Wall | undefined, p: BuildUpPrism): Appearance {
  if (p.part === "frame") {
    const side = w?.buildUp?.[p.side];
    return defaultAppearance({ part: "frame", material: side?.frame?.material ?? "timber" });
  }
  const key = { part: "board", kind: p.kind ?? "gypsum" } as const;
  return p.outermost ? resolveAppearance(key, w?.buildUp?.[p.side]?.appearance) : defaultAppearance(key);
}

/** A glazed door's leaves: rim in the leaf colour, glass pane (core/solids.ts). */
function emitGlazedLeaves(
  acc: MeshAcc, leaf: Vec[], pane: Vec[], leaves: ReadonlyArray<{ s0: number; s1: number }>, z0: number, z1: number,
  rimLook: Appearance,
): void {
  const parts = glazedLeafParts(leaf, pane, leaves, z0, z1);
  for (const p of parts.frame) emitPrism(acc, p.poly, [], p.z0, p.z1, rimLook, "door");
  for (const p of parts.glass) emitPrism(acc, p.poly, [], p.z0, p.z1, defaultAppearance({ part: "glass" }), "glass", true);
}

/** A wall's frame for the stair cuts: origin at node a, unit chord direction,
 *  half thickness. An arc wall is projected on its chord — approximate, like
 *  the arc miters, and exact for the straight walls stairs ordinarily cross. */
interface WallAxis { a: Vec; dir: Vec; half: number }

/** One step's claim on a wall: within [t0, t1] along the axis the wall rises
 *  at most to `top` (storey-relative mm). */
interface CutSpan { t0: number; t1: number; top: number }

function wallAxes(f: Floor): Map<Id, WallAxis> {
  const at = new Map(f.nodes.map(n => [n.id, v(n.x, n.y)] as const));
  const out = new Map<Id, WallAxis>();
  for (const w of f.walls) {
    const a = at.get(w.a), b = at.get(w.b);
    if (!a || !b || dist(a, b) <= RING_EPS) continue;
    out.set(w.id, { a, dir: norm(sub(b, a)), half: w.thickness / 2 });
  }
  return out;
}

/** Where the flights cross the walls: one span per step whose footprint
 *  overlaps a wall's band, its top a shadow gap under that step's underside.
 *  Consecutive steps give consecutive spans, so the cut rakes with the
 *  flight. The overlap test uses the footprint's bounds in the wall's frame —
 *  a rotated winder claims slightly more wall than it covers, which errs
 *  toward clearance. */
function stairCuts(axes: Map<Id, WallAxis>, stepLists: StairStep[][]): Map<Id, CutSpan[]> {
  const out = new Map<Id, CutSpan[]>();
  for (const steps of stepLists) {
    for (const st of steps) {
      for (const [id, ax] of axes) {
        let t0 = Infinity, t1 = -Infinity, s0 = Infinity, s1 = -Infinity;
        for (const p of st.poly) {
          const dx = p.x - ax.a.x, dy = p.y - ax.a.y;
          const t = dx * ax.dir.x + dy * ax.dir.y;
          const s = dy * ax.dir.x - dx * ax.dir.y;
          if (t < t0) t0 = t; if (t > t1) t1 = t;
          if (s < s0) s0 = s; if (s > s1) s1 = s;
        }
        if (s0 >= ax.half || s1 <= -ax.half) continue;
        const spans = out.get(id);
        const span = { t0, t1, top: st.z0 - STAIR_CLEAR_MM };
        if (spans) spans.push(span); else out.set(id, [span]);
      }
    }
  }
  return out;
}

/** Midpoint of a void quad, as a position along the wall axis. */
function midT(ax: WallAxis, poly: Vec[]): number {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  x /= poly.length; y /= poly.length;
  return (x - ax.a.x) * ax.dir.x + (y - ax.a.y) * ax.dir.y;
}

/** The lowest cut covering `t`, or Infinity where no step crosses there. */
function spanTopAt(spans: CutSpan[], t: number): number {
  let top = Infinity;
  for (const s of spans) if (t > s.t0 && t < s.t1) top = Math.min(top, s.top);
  return top;
}

/** Positions along the axis where a piece must be sliced, mm. */
const CUT_EPS = 0.01;

/**
 * A wall prism, cut where flights cross it: the piece is sliced at the span
 * boundaries, each slice keeps the lowest top the spans covering it allow,
 * and a slice cut to less than WALL_STUB_MM above the floor is left out. A
 * piece no span touches is emitted whole.
 *
 * `top`, parallel to `poly`, carries a sloped wall piece's per-vertex roof
 * (core/solids.ts's `Prism.top`) through the same slicing: clipHalfPlaneWithTop()
 * lerps the height alongside x/y at every new cut vertex, and a slice's own
 * stair-shadow cap lowers its vertices individually rather than flattening
 * them to one figure.
 */
function emitWallPrism(
  acc: MeshAcc, poly: Vec[], elev: number, z0: number, z1: number,
  ax: WallAxis | undefined, spans: CutSpan[] | undefined, look: Appearance, part: MeshPart, glass: boolean,
  top?: number[],
): void {
  if (!ax || !spans || spans.length === 0) {
    emitPrism(acc, poly, [], elev + z0, elev + z1, look, part, glass, top?.map(z => elev + z));
    return;
  }
  let p0 = Infinity, p1 = -Infinity;
  for (const p of poly) {
    const t = (p.x - ax.a.x) * ax.dir.x + (p.y - ax.a.y) * ax.dir.y;
    if (t < p0) p0 = t; if (t > p1) p1 = t;
  }
  const bps = [p0, p1];
  for (const s of spans) {
    if (s.t0 > p0 + CUT_EPS && s.t0 < p1 - CUT_EPS) bps.push(s.t0);
    if (s.t1 > p0 + CUT_EPS && s.t1 < p1 - CUT_EPS) bps.push(s.t1);
  }
  bps.sort((m, n) => m - n);
  const fullTop = top ?? poly.map(() => z1);
  for (let i = 0; i + 1 < bps.length; i++) {
    const ta = bps[i]!, tb = bps[i + 1]!;
    if (tb - ta <= CUT_EPS) continue;
    let cap = z1;
    for (const s of spans) if (s.t0 < tb - CUT_EPS && s.t1 > ta + CUT_EPS) cap = Math.min(cap, s.top);
    if (cap - z0 <= H_EPS) continue;
    if (cap < z1 && cap < WALL_STUB_MM && z0 <= H_EPS) continue;
    let piece = poly, partTop = fullTop;
    if (ta > p0 + CUT_EPS) {
      const r = clipHalfPlaneWithTop(piece, partTop, add(ax.a, scale(ax.dir, ta)), ax.dir);
      piece = r.poly; partTop = r.top;
    }
    if (tb < p1 - CUT_EPS) {
      const r = clipHalfPlaneWithTop(piece, partTop, add(ax.a, scale(ax.dir, tb)), scale(ax.dir, -1));
      piece = r.poly; partTop = r.top;
    }
    const cappedTop = partTop.map(h => Math.min(h, cap));
    emitPrism(acc, piece, [], elev + z0, elev + Math.max(z0, ...cappedTop), look, part, glass,
      top ? cappedTop.map(h => elev + h) : undefined);
  }
}

/** Like clipHalfPlane, but carries a parallel per-vertex height through the
 *  same edge interpolation -- a stair-shadow cut through a sloped wall piece
 *  keeps its roof instead of losing it to a flat z1. */
function clipHalfPlaneWithTop(poly: Vec[], top: number[], o: Vec, n: Vec): { poly: Vec[]; top: number[] } {
  const outPoly: Vec[] = [], outTop: number[] = [];
  const len = poly.length;
  for (let i = 0; i < len; i++) {
    const p = poly[i]!, q = poly[(i + 1) % len]!;
    const tp = top[i]!, tq = top[(i + 1) % len]!;
    const dp = (p.x - o.x) * n.x + (p.y - o.y) * n.y;
    const dq = (q.x - o.x) * n.x + (q.y - o.y) * n.y;
    if (dp >= 0) { outPoly.push(p); outTop.push(tp); }
    if ((dp >= 0) !== (dq >= 0)) {
      const t = dp / (dp - dq);
      outPoly.push(v(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t));
      outTop.push(tp + (tq - tp) * t);
    }
  }
  return { poly: outPoly, top: outTop };
}

/** Drop consecutive (and closing) duplicate vertices. */
function cleanRing(poly: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > RING_EPS) out.push(p);
  }
  while (out.length > 1 && dist(out[0]!, out[out.length - 1]!) <= RING_EPS) out.pop();
  return out;
}

/** cleanRing(), carrying a parallel per-vertex height through the same drops
 *  so a sloped prism's roof stays indexed to its own footprint. */
function cleanRingWithTop(poly: Vec[], top: number[] | undefined): { ring: Vec[]; top?: number[] } {
  if (!top) return { ring: cleanRing(poly) };
  const ring: Vec[] = [], t: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const last = ring[ring.length - 1];
    if (!last || dist(last, p) > RING_EPS) { ring.push(p); t.push(top[i]!); }
  }
  while (ring.length > 1 && dist(ring[0]!, ring[ring.length - 1]!) <= RING_EPS) { ring.pop(); t.pop(); }
  return { ring, top: t };
}

/** Cosine of the footprint's turn at `cur`: incoming vs outgoing direction. */
function turnCos(prev: Vec, cur: Vec, next: Vec): number {
  const ix = cur.x - prev.x, iy = cur.y - prev.y;
  const ox = next.x - cur.x, oy = next.y - cur.y;
  const li = Math.hypot(ix, iy) || 1, lo = Math.hypot(ox, oy) || 1;
  return (ix * ox + iy * oy) / (li * lo);
}

function boundsOf(positions: number[], glassPositions: number[]): Bounds3 | null {
  if (positions.length === 0 && glassPositions.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const arr of [positions, glassPositions]) {
    for (let i = 0; i < arr.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const c = arr[i + k]!;
        if (c < min[k]!) min[k] = c;
        if (c > max[k]!) max[k] = c;
      }
    }
  }
  return { min, max };
}
