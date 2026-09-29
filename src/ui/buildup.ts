// The per-face board build-up editor: a preset select plus an editable board
// list, shared by the single-wall pane, the bulk pane and the wall pen (see
// ui/panel.ts, ui/walls.ts) so the three cannot end up with different fields
// or wording for the same fact.
import {
  BOARD_KINDS, BOARD_PRESETS, MAX_BOARDS, boardPresetOf, clampBoardMm,
  FRAME_PRESETS, FLOOR_HEIGHT_DEFAULT, clampFrameGapMm, clampFrameDepthMm, clampFrameHeightMm,
  clampNoggingRows, framePresetOf,
  type Board, type BoardKind, type FaceBuildUp, type FaceFrame, type Wall,
} from "../model/doc";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/** Whether a wall carries a build-up on either face -- a board stack, a
 *  voorzetwand, or both -- the flag renderWallSurface()/renderStoreySurface()
 *  take to say a face area is measured to the structure rather than to a
 *  finished board face. */
export function wallHasBuildUp(w: Wall): boolean {
  return w.buildUp?.left !== undefined || w.buildUp?.right !== undefined;
}

/** "links van a→b" / "rechts van a→b" -- the one place this wording is
 *  written, reused everywhere a wall's face is named by its side rather than
 *  by the room it looks into (that is ui/walls.ts's own faceLabel(), a
 *  different question). Shared by the facade-side picker, the per-face
 *  build-up heading and the voorzetwand rows in ui/materials.ts and
 *  ui/frame.ts, so the wording cannot drift between them. */
export function faceLabel(side: "left" | "right"): string {
  return side === "left" ? t("panel.facadeLeft") : t("panel.facadeRight");
}

/**
 * One face's editor: a heading (the same left/right wording the facade-side
 * control uses, since both name a side of the same wall), the voorzetwand
 * (a preset select, "none" included, and -- once a frame stands -- its own
 * fields), then the board stack on top of it the same way -- a preset select
 * plus one row per board with its kind, its thickness and a remove button,
 * plus an add-board row while under MAX_BOARDS. The frame comes first: it is
 * what the boards are hung on, between the structural face and the room.
 *
 * `onChange` is handed the face's next state as a whole (`undefined` meaning
 * "no build-up here"); the caller decides how to write it -- a single
 * store.mutate() for one wall, a mutAll() across a bulk selection, or the
 * wall pen's own patch. `opts.mixed` renders both preset selects
 * indeterminate and stops there, the way every other bulk field with
 * disagreeing members does -- neither a frame's fields nor a per-board list
 * has anything to show when the selection does not even agree on what stands
 * on this face.
 *
 * `opts.standOff`/`opts.ownPosts` are the single-wall pane's own report of
 * what core/leafclash.ts finds for THIS face -- the bulk pane and the wall
 * pen pass neither, since a proposal is about one wall's own columns and the
 * pen has no wall yet to check.
 */
export function renderFaceBuildUp(
  rows: PaneRows,
  label: string,
  facadeHere: boolean,
  fu: FaceBuildUp | undefined,
  onChange: (fu: FaceBuildUp | undefined) => void,
  opts: {
    mixed?: boolean;
    /** The stand-off this face's columns need, and the button that writes it.
     *  Absent where nothing protrudes. */
    standOff?: { gapMm: number; column: string; apply: () => void };
    /** The wall states its own posts. They lie within its thickness by
     *  definition, so they are never why a stand-off is proposed. */
    ownPosts?: boolean;
    /**
     * The other way to deal with a column in this face: stop the build-up
     * either side of it. `apply` writes the proposed runs, `clear` puts the
     * face back to its whole length. Absent where nothing protrudes.
     */
    runs?: { count: number; apply: () => void; clear: () => void };
  } = {},
): void {
  rows.secHead(label, { later: true });
  if (facadeHere) {
    rows.noteRow(t("panel.buildUpFacadeNote"));
    return;
  }
  const boards = fu?.boards ?? [];
  const frame = fu?.frame;

  // The voorzetwand: a preset writes a whole FaceFrame plus its own board
  // stack in one go, since a set-out and what is hung on it are chosen
  // together in practice. "none" removes the frame and leaves whatever
  // boards are already stacked exactly where they are -- a voorzetwand taken
  // down does not take the finish with it in this editor; the finish is a
  // separate choice below.
  const framePresetId = frame ? framePresetOf({ frame, boards }) : "none";
  const frameOptions: Array<[string, string]> = [
    ["none", t("frame.preset.none")],
    ...FRAME_PRESETS.map(p => [p.id, t("frame.preset." + p.id)] as [string, string]),
  ];
  if (framePresetId === "custom") frameOptions.push(["custom", t("frame.preset.custom")]);
  rows.selRow(t("panel.buildUpFramePreset"), framePresetId, frameOptions, value => {
    if (value === "custom") return; // reached only by editing the frame directly, not by picking it
    if (value === "none") { if (frame) onChange(boards.length > 0 ? { boards } : undefined); return; }
    const preset = FRAME_PRESETS.find(p => p.id === value);
    if (preset) onChange({ frame: { ...preset.frame }, boards: preset.boards.map(b => ({ ...b })) });
  }, { mixed: opts.mixed });
  if (opts.mixed) return;

  if (frame) {
    const withFrame = (next: FaceFrame): void => onChange({ frame: next, boards });
    rows.numRow(t("panel.buildUpFrameGap"), frame.gapMm,
      n => withFrame({ ...frame, gapMm: clampFrameGapMm(n) }), 10);
    rows.numRow(t("panel.buildUpFrameDepth"), frame.depthMm,
      n => withFrame({ ...frame, depthMm: clampFrameDepthMm(n) }), 5);
    rows.selRow(t("panel.buildUpFrameMaterial"), frame.material,
      [["timber", t("panel.material_timber")], ["steel", t("panel.material_steel")]],
      v => withFrame({ ...frame, material: v === "steel" ? "steel" : "timber" }));
    rows.numRow(t("panel.buildUpFramePostMm"), frame.postMm ?? 600,
      n => withFrame({ ...frame, postMm: Math.max(100, Math.round(n)) }), 25);
    rows.selRow(t("panel.buildUpFramePostLayout"), frame.postLayout ?? "grid",
      [["even", t("panel.postLayout_even")], ["grid", t("panel.postLayout_grid")]],
      v => withFrame({ ...frame, postLayout: v === "even" ? "even" : "grid" }));
    rows.numRow(t("panel.buildUpFramePostWidth"), frame.postWidthMm ?? frame.depthMm,
      n => withFrame({ ...frame, postWidthMm: Math.max(10, Math.round(n)) }), 5);
    // A metal stud frame carries no noggings (core/frame.ts).
    if (frame.material === "timber") {
      rows.numRow(t("panel.buildUpFrameNoggings"), frame.noggingRows ?? 0, n => {
        const rowsCount = clampNoggingRows(n);
        const next = { ...frame };
        if (rowsCount > 0) next.noggingRows = rowsCount; else delete next.noggingRows;
        withFrame(next);
      }, 1);
    }
    rows.checkRow(t("panel.buildUpFrameInsulated"), frame.insulated === true, on => {
      const next = { ...frame };
      if (on) next.insulated = true; else delete next.insulated;
      withFrame(next);
    });
    // Absent means the frame stands to the host wall's own top -- a real
    // answer, not a height of zero, so it is set/unset the way the wall's
    // own height is (panel.wallOwnHeight) rather than defaulted to a number.
    // Absent means the frame stands to the host wall's own top, so turning a
    // height on starts at the storey default rather than at zero.
    rows.checkRow(t("panel.wallOwnHeight"), frame.heightMm !== undefined, on => {
      const next = { ...frame };
      if (on) next.heightMm = clampFrameHeightMm(FLOOR_HEIGHT_DEFAULT); else delete next.heightMm;
      withFrame(next);
    });
    if (frame.heightMm !== undefined) {
      rows.numRow(t("panel.buildUpFrameHeight"), frame.heightMm,
        n => withFrame({ ...frame, heightMm: clampFrameHeightMm(n) }), 50);
    }
    rows.noteRow(t("panel.buildUpFrameHelp"));

    // What this face covers. A build-up over part of a wall is the second way
    // of dealing with a column standing in it -- the first being the stand-off
    // above -- and also covers a finish that simply is not full length.
    const runs = fu?.runs;
    if (runs && runs.length > 0) {
      rows.noteRow(t("panel.buildUpRunsNote", { n: runs.length }));
    }
    if (opts.runs) {
      if (!runs || runs.length === 0) {
        rows.btnRow(t("panel.buildUpRunsApply", { n: opts.runs.count }), opts.runs.apply);
      } else {
        rows.btnRow(t("panel.buildUpRunsClear"), opts.runs.clear);
      }
    }
    // What this face's own columns say about the stand-off just chosen --
    // proposed, never written except through the button itself (see
    // core/leafclash.ts's own "proposes, never owns" stance).
    if (opts.standOff) {
      rows.noteRow(t("panel.buildUpStandOffNote", { column: opts.standOff.column, gap: opts.standOff.gapMm }));
      rows.btnRow(t("panel.buildUpStandOffApply", { gap: opts.standOff.gapMm }), opts.standOff.apply);
    } else if (opts.ownPosts) {
      rows.noteRow(t("panel.buildUpOwnPostsNote"));
    }
  }

  // A frame standing on this face survives every board edit below, including
  // one that empties the stack -- a voorzetwand with nothing hung on it yet
  // is a legitimate state (see FaceBuildUp), not "no build-up here".
  const withBoards = (next: Board[]): FaceBuildUp | undefined =>
    frame ? { frame, boards: next } : next.length > 0 ? { boards: next } : undefined;

  const presetId = boards.length === 0 ? "none" : boardPresetOf(boards);
  const options: Array<[string, string]> = [
    ["none", t("board.preset.none")],
    ...BOARD_PRESETS.map(p => [p.id, t("board.preset." + p.id)] as [string, string]),
  ];
  if (presetId === "custom") options.push(["custom", t("board.preset.custom")]);
  rows.selRow(t("panel.buildUpPreset"), presetId, options, value => {
    if (value === "custom") return; // reached only by editing the stack directly, not by picking it
    if (value === "none") { onChange(withBoards([])); return; }
    const preset = BOARD_PRESETS.find(p => p.id === value);
    if (preset) onChange(withBoards(preset.boards.map(b => ({ ...b }))));
  }, { mixed: opts.mixed });
  if (opts.mixed) return;

  boards.forEach((board, index) => {
    const setBoard = (patch: Partial<Board>): void =>
      onChange(withBoards(boards.map((b, i) => (i === index ? { ...b, ...patch } : b))));
    rows.selRow(t("panel.buildUpBoardKind"), board.kind,
      BOARD_KINDS.map(k => [k, t("board.kind." + k)] as [string, string]),
      kind => setBoard({ kind: kind as BoardKind }));
    rows.numRow(t("panel.buildUpBoardMm"), board.mm, n => setBoard({ mm: clampBoardMm(n) }), 1);
    rows.btnRow(t("panel.buildUpBoardRemove"), () => onChange(withBoards(boards.filter((_, i) => i !== index))));
  });
  if (boards.length > 0) rows.noteRow(t("panel.buildUpHelp"));
  // New boards land at the end -- the outer, room-facing side of the stack,
  // since `boards` runs from the wall outward into the room (Wall.buildUp).
  if (boards.length < MAX_BOARDS) {
    rows.btnRow(t("panel.buildUpAdd"), () => onChange(withBoards([...boards, { kind: "gypsum", mm: 12 }])));
  }
}

/**
 * The wall pen's build-up patch for one face, in the pen's own `null`-for-
 * "unset" shape (Tools.wallBuildUp) rather than the document's `undefined`.
 * Mirrors model/doc.ts's setFaceBuildUp() for a value that is not a Wall.
 */
export function withFaceBuildUp(
  buildUp: Wall["buildUp"] | null | undefined,
  side: "left" | "right",
  fu: FaceBuildUp | undefined,
): Wall["buildUp"] | null {
  const next: NonNullable<Wall["buildUp"]> = { ...buildUp };
  if (fu && (fu.boards.length > 0 || fu.frame !== undefined)) next[side] = fu; else delete next[side];
  return next.left === undefined && next.right === undefined ? null : next;
}
