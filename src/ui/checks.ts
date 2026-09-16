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

/** Within this of 1.0, utilisation reads to one decimal rather than a whole
 *  percentage -- a 1.004 reads "100.4%" beside "voldoet niet" rather than a
 *  rounded "100%" that reads as passing. */
const PCT_DECIMAL_BAND = 0.05;

/** Utilisation as a percentage; a non-finite figure (a zero section, division
 *  by zero) reads as an em dash rather than "Infinity%". */
function pct(u: number): string {
  if (!isFinite(u)) return "—";
  return Math.abs(u - 1) <= PCT_DECIMAL_BAND ? `${(u * 100).toFixed(1)}%` : `${Math.round(u * 100)}%`;
}

function knm(n: number): string {
  return `${n.toFixed(2)} kN/m`;
}

/** Appends the governing marker to a criterion's label when it is the one
 *  that decides pass/fail. */
function crit(label: string, isGoverning: boolean): string {
  return isGoverning ? `${label} (${t("checks.governing")})` : label;
}

/** The `missing` keys that name an absent SECTION rather than an absent load
 *  or span -- the joist and lintel checks are the only two with an optional
 *  section of their own, and only there does "incomplete" still mean "here
 *  is what would pass". */
const SECTION_MISSING_KEYS = new Set(["joistSection", "lintelSection"]);

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
      // For a lintel, gLineKNm is the wall's self-weight alone (wallLineKNm);
      // any authored lintelLoadKNm is a variable load and so lives in
      // qLineKNm instead of being folded into g -- see lintelCheck().
      rows.infoRow(t("checks.loadWall"), knm(load.wallLineKNm));
      if (load.qLineKNm > 0) rows.infoRow(t("checks.loadExtra"), knm(load.qLineKNm));
    } else {
      rows.infoRow(t("checks.loadG"), knm(load.gLineKNm));
      if (load.qLineKNm > 0) rows.infoRow(t("checks.loadQ"), knm(load.qLineKNm));
    }
  }

  const onlyMissingSection = result.missing.length === 1 && SECTION_MISSING_KEYS.has(result.missing[0]!);

  if (result.status === "incomplete") {
    for (const key of result.missing) rows.warnRow(t("checks.missingRow", { row: missingLabel(key) }));
    if (result.proposal !== undefined) {
      if (result.proposal) {
        const { w, d } = result.proposal;
        if (onlyMissingSection) rows.btnRow(t("checks.applyProposal", { w, d }), () => onApply(w, d));
        else rows.noteRow(t("checks.proposalHint", { w, d }));
      } else {
        rows.noteRow(t("checks.noSectionPasses"));
      }
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
