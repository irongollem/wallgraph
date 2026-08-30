// The opening pane, for the door/window/passage tools: what the NEXT opening is
// placed with.
//
// This exists because everything about an opening used to be decided after it
// was placed. The tool put down one fixed width with one fixed hinge, and every
// deviation was a trip to the property pane — eight doors meant eight trips. A
// wall has had `lastThickness` for exactly this reason; an opening now has the
// same, plus the properties that belong to a plan rather than to one leaf: which
// way the doors hang, and whether they are fire-rated.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import {
  OpeningKind, FIRE_KINDS, FIRE_MINUTES, FIRE_MINUTES_DEFAULT, widthsFor,
  DOOR_WIDTHS_DOUBLE,
} from "../model/doc";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

/** The size and swing the next opening of this kind is placed with. */
export function renderOpeningTool(
  store: Store, tools: Tools, rows: PaneRows, kind: OpeningKind,
): void {
  rows.secHead(t("panel.newOpening" + kind[0]!.toUpperCase() + kind.slice(1)));

  rows.numRow(t("panel.width"), tools.openingWidth[kind],
    n => setWidth(tools, kind, n), 10);
  // The dagmaten a door is actually ordered at. See DOOR_WIDTHS.
  rows.chipRow(t("panel.width"), widthsFor(kind), tools.openingWidth[kind],
    n => setWidth(tools, kind, n));
  if (kind === "door") {
    rows.chipRow(t("panel.widthDouble"), DOOR_WIDTHS_DOUBLE, tools.openingWidth[kind],
      n => setWidth(tools, kind, n));
  }

  if (kind === "door") {
    swingRows(tools, rows);
    fireRows(tools, rows);
  }
  rows.noteRow(t("panel.newOpeningNote"));
  void store;
}

function setWidth(tools: Tools, kind: OpeningKind, mm: number): void {
  tools.openingWidth[kind] = Math.max(50, Math.round(mm));
  tools.refresh();
}

/**
 * Draairichting as one choice rather than two.
 *
 * The document stores which jamb hangs the leaf ("a" or "b", in the wall's own
 * node order) and which way it opens. Neither is visible on the drawing, and a
 * builder does not think in either: the word is linksdraaiend or rechtsdraaiend,
 * naar binnen or naar buiten. So the four combinations are offered as the two
 * questions actually asked, and the wall's node order stays an implementation
 * detail of the graph.
 */
function swingRows(tools: Tools, rows: PaneRows): void {
  rows.selRow(t("panel.doorHand"), tools.doorHinge,
    [["a", t("panel.doorHandLeft")], ["b", t("panel.doorHandRight")]],
    value => { tools.doorHinge = value === "b" ? "b" : "a"; tools.refresh(); });
  rows.selRow(t("panel.swing"), tools.doorOutward ? "out" : "in",
    [["in", t("panel.swingIn")], ["out", t("panel.swingOut")]],
    value => { tools.doorOutward = value === "out"; tools.refresh(); });
}

/** Fire rating, offered at the ratings doors are specified at. */
function fireRows(tools: Tools, rows: PaneRows): void {
  rows.selRow(t("panel.fireRating"), tools.doorFire?.kind ?? "",
    [["", t("panel.fireNone")],
      ...FIRE_KINDS.map(k => [k, t("panel.fire_" + k)] as [string, string])],
    value => {
      tools.doorFire = value
        ? { kind: value as typeof FIRE_KINDS[number], minutes: tools.doorFire?.minutes ?? FIRE_MINUTES_DEFAULT }
        : null;
      tools.refresh();
    });
  if (tools.doorFire) {
    rows.noteRow(t("panel.fireHelp"));
    rows.chipRow(t("panel.fireMinutes"), FIRE_MINUTES, tools.doorFire.minutes, n => {
      if (tools.doorFire) tools.doorFire.minutes = n;
      tools.refresh();
    });
    // A fire door has to close itself to be one, so it is offered right here
    // rather than three rows down among the unrelated flags.
    rows.checkRow(t("panel.selfClosing"), tools.doorSelfClosing, b => {
      tools.doorSelfClosing = b;
      tools.refresh();
    });
  }
}
