// The geometry one stair contributes to an export, as plain primitives.
//
// A stair draws itself against the same contract the symbol library uses, so
// the recorder that replays a symbol replays a stair unchanged — no second,
// hand-kept outline per kind, and a DXF and an SVG of the same plan cannot
// disagree about what a bordestrap looks like.
import { ResolvedStair } from "../model/stair";
import { getStair } from "../render/stairs";
import { stairNote, stairNoteAt, NOTE_SIZE } from "../core/stair";
import { recordSymbol, Prim } from "./record";

/**
 * The floor the stair occupies, for the wash an export paints behind it. Empty
 * for a kind that has no region of its own; the caller falls back to the box.
 */
export function stairRegionPrims(s: ResolvedStair): Prim[] {
  const def = getStair(s.kind);
  const region = def?.region;
  if (!region) return [];
  return recordSymbol(
    { draw: ctx => region(ctx, s) }, s.x, s.y, s.rotation, s.mirrored === true);
}

export function stairPrims(s: ResolvedStair): Prim[] {
  const def = getStair(s.kind);
  if (!def) return [];
  const out = recordSymbol(
    { draw: ctx => def.draw(ctx, s) }, s.x, s.y, s.rotation, s.mirrored === true);
  // The annotation is the caller's, not the drawing's: it is placed upright in
  // world space, so it cannot be recorded from inside the stair's own frame.
  const note = stairNote(s);
  if (note) out.push({ kind: "text", at: stairNoteAt(s), size: NOTE_SIZE, text: note });
  return out;
}
