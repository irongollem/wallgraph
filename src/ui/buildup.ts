// The per-face board build-up editor: a preset select plus an editable board
// list, shared by the single-wall pane, the bulk pane and the wall pen (see
// ui/panel.ts, ui/walls.ts) so the three cannot end up with different fields
// or wording for the same fact.
import {
  BOARD_KINDS, BOARD_PRESETS, MAX_BOARDS, boardPresetOf, clampBoardMm,
  type Board, type BoardKind, type FaceBuildUp, type Wall,
} from "../model/doc";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/** Whether a wall carries a board build-up on either face -- the flag
 *  renderWallSurface()/renderStoreySurface() take to say a face area is
 *  measured to the structure rather than to a finished board face. */
export function wallHasBuildUp(w: Wall): boolean {
  return w.buildUp?.left !== undefined || w.buildUp?.right !== undefined;
}

/**
 * One face's editor: a heading (the same left/right wording the facade-side
 * control uses, since both name a side of the same wall), a preset select
 * (including "none"), and -- unless the face carries the facade instead --
 * one row per board with its kind, its thickness and a remove button, plus
 * an add-board row while under MAX_BOARDS.
 *
 * `onChange` is handed the face's next state as a whole (`undefined` meaning
 * "no build-up here"); the caller decides how to write it -- a single
 * store.mutate() for one wall, a mutAll() across a bulk selection, or the
 * wall pen's own patch. `opts.mixed` renders the preset select indeterminate
 * and stops there, the way every other bulk field with disagreeing members
 * does -- a per-board list has nothing to show when the selection does not
 * even agree on how many boards there are.
 */
export function renderFaceBuildUp(
  rows: PaneRows,
  label: string,
  facadeHere: boolean,
  fu: FaceBuildUp | undefined,
  onChange: (fu: FaceBuildUp | undefined) => void,
  opts: { mixed?: boolean } = {},
): void {
  rows.secHead(label, { later: true });
  if (facadeHere) {
    rows.noteRow(t("panel.buildUpFacadeNote"));
    return;
  }
  const boards = fu?.boards ?? [];
  const presetId = boards.length === 0 ? "none" : boardPresetOf(boards);
  const options: Array<[string, string]> = [
    ["none", t("board.preset.none")],
    ...BOARD_PRESETS.map(p => [p.id, t("board.preset." + p.id)] as [string, string]),
  ];
  if (presetId === "custom") options.push(["custom", t("board.preset.custom")]);
  rows.selRow(t("panel.buildUpPreset"), presetId, options, value => {
    if (value === "custom") return; // reached only by editing the stack directly, not by picking it
    if (value === "none") { onChange(undefined); return; }
    const preset = BOARD_PRESETS.find(p => p.id === value);
    if (preset) onChange({ boards: preset.boards.map(b => ({ ...b })) });
  }, { mixed: opts.mixed });
  if (opts.mixed) return;

  boards.forEach((board, index) => {
    const setBoard = (patch: Partial<Board>): void =>
      onChange({ boards: boards.map((b, i) => (i === index ? { ...b, ...patch } : b)) });
    rows.selRow(t("panel.buildUpBoardKind"), board.kind,
      BOARD_KINDS.map(k => [k, t("board.kind." + k)] as [string, string]),
      kind => setBoard({ kind: kind as BoardKind }));
    rows.numRow(t("panel.buildUpBoardMm"), board.mm, n => setBoard({ mm: clampBoardMm(n) }), 1);
    rows.btnRow(t("panel.buildUpBoardRemove"), () => {
      const next = boards.filter((_, i) => i !== index);
      onChange(next.length > 0 ? { boards: next } : undefined);
    });
  });
  if (boards.length > 0) rows.noteRow(t("panel.buildUpHelp"));
  // New boards land at the end -- the outer, room-facing side of the stack,
  // since `boards` runs from the wall outward into the room (Wall.buildUp).
  if (boards.length < MAX_BOARDS) {
    rows.btnRow(t("panel.buildUpAdd"), () => onChange({ boards: [...boards, { kind: "gypsum", mm: 12 }] }));
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
  if (fu && fu.boards.length > 0) next[side] = fu; else delete next[side];
  return next.left === undefined && next.right === undefined ? null : next;
}
