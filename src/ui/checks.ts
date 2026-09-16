// The "Constructie" head shared by the deck, beam and opening panes: the
// read-only report of a core/checks.ts CheckResult, plus the button that
// writes its proposed section into the object. One renderer for all three
// checks because they report the same shape (CheckResult/SpanCheck) -- only
// the missing-key wording and the section label differ, and both are handed
// in by the caller, which is where a deck's joist, a beam's width/depth or an
// opening's lintel each already know how to name themselves.
import { t } from "../i18n";
import type { PaneRows } from "./stairs";
import type { CheckResult } from "../core/checks";

/** Utilisation as a whole-number percentage; a non-finite figure (a zero
 *  section, division by zero) reads as an em dash rather than "Infinity%". */
function pct(u: number): string {
  return isFinite(u) ? `${Math.round(u * 100)}%` : "—";
}

function knm(n: number): string {
  return `${n.toFixed(2)} kN/m`;
}

/** Appends the governing marker to a criterion's label when it is the one
 *  that decides pass/fail. */
function crit(label: string, isGoverning: boolean): string {
  return isGoverning ? `${label} (${t("checks.governing")})` : label;
}

/**
 * Renders the whole "Constructie" section for one check: the load make-up,
 * span, section, utilisation per criterion with the governing one marked,
 * deflection against its limit, pass/fail, the incomplete list (worded per
 * `missingLabel`), and the proposal button (or a note that nothing passes).
 *
 * `sectionLabel` is supplied by the caller rather than read off `result.input`
 * because a steel beam's SteelSpanInput carries no w×d of its own -- the
 * caller already has the section's own name (a joist's w×d, a beam's
 * width/depth or profile label, a lintel's w×d) from the rows above this one.
 */
export function renderCheckResult(
  rows: Pick<PaneRows, "secHead" | "infoRow" | "noteRow" | "warnRow" | "btnRow">,
  result: CheckResult,
  missingLabel: (key: string) => string,
  sectionLabel: string | undefined,
  onApply: (w: number, d: number) => void,
): void {
  rows.secHead(t("checks.title"), { later: true });

  const load = result.loadBreakdown;
  if (load) {
    if (load.wallLineKNm !== undefined) {
      rows.infoRow(t("checks.loadWall"), knm(load.wallLineKNm));
      const extra = load.gLineKNm - load.wallLineKNm;
      if (extra > 0) rows.infoRow(t("checks.loadExtra"), knm(extra));
    } else {
      rows.infoRow(t("checks.loadG"), knm(load.gLineKNm));
    }
    if (load.qLineKNm > 0) rows.infoRow(t("checks.loadQ"), knm(load.qLineKNm));
  }

  if (result.status === "incomplete") {
    for (const key of result.missing) rows.warnRow(t("checks.missingRow", { row: missingLabel(key) }));
    if (result.proposal !== undefined) {
      if (result.proposal) rows.noteRow(t("checks.proposalHint", { w: result.proposal.w, d: result.proposal.d }));
      else rows.noteRow(t("checks.noSectionPasses"));
    }
    rows.noteRow(t("checks.resultNote"));
    return;
  }

  const { check, material } = result;
  if (!check) return;

  rows.infoRow(t("checks.span"), `${Math.round(result.input!.spanMm)} mm`);
  if (sectionLabel) rows.infoRow(t("checks.section"), sectionLabel);
  rows.infoRow(crit(t("checks.bending"), check.governing === "bending"), pct(check.bending));
  // Steel is checked for bending and deflection only -- shear is reported by
  // checkSteelSpan() as 0 and never governs, so showing it here would read as
  // a criterion that was actually checked rather than one that was not.
  if (material === "timber") {
    rows.infoRow(crit(t("checks.shear"), check.governing === "shear"), pct(check.shear));
  }
  rows.infoRow(crit(t("checks.deflection"), check.governing === "deflection"), pct(check.deflection));
  rows.infoRow(t("checks.deflectionValue"), `${check.deflectionMm.toFixed(1)} / ${check.limitMm.toFixed(0)} mm`);
  rows.infoRow(t("checks.result"), check.passes ? t("checks.pass") : t("checks.fail"));

  if (!check.passes) {
    if (result.proposal) {
      const { w, d } = result.proposal;
      rows.btnRow(t("checks.applyProposal", { w, d }), () => onApply(w, d));
    } else if (result.proposal === null) {
      rows.noteRow(t("checks.noSectionPasses"));
    }
  }
  rows.noteRow(t("checks.resultNote"));
}
