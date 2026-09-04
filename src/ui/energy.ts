// The Energie fold-out: BENG geometry assumptions and the read-only takeoff
// they feed. Mirrors the permit section in panel.ts -- assumptions are cheap
// (they only read/write PlanDoc.energy) and render on every rebuild, while
// the takeoff itself resolves every storey (core/energy.ts's envelopeTakeoff)
// and so is computed by the caller only while the section is open; this
// module only lays out rows over whatever it is handed.
import { Store } from "../model/store";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";
import { sqm } from "./walls";
import type { AreaMode } from "../model/doc";
import {
  INSULATION_CLASSES, GLAZING_TYPES, insulationClassOf, glazingTypeOf,
  applyInsulationClass, applyGlazingType, thermalValue, HEATING_DEGREE_DAYS,
  type EnergyAssumptions, type InsulationClassId, type GlazingTypeId,
} from "../model/energy";
import { transmissionEstimate, ORIENTATIONS, type EnvelopeTakeoff } from "../core/energy";

/** Cubic metres, the same convention sqm() uses for square metres. */
function m3(mm3: number): string {
  return (mm3 / 1e9).toFixed(1) + " m³";
}

function areaModeWord(mode: AreaMode): string {
  switch (mode) {
    case "net": return t("panel.areaNet");
    case "centerline": return t("panel.areaCenterline");
    case "bvo": return t("panel.areaBvo");
  }
}

/**
 * Isolatie/beglazing presets and the Rc/U figures they set. "" clears the
 * three Rc fields (or the two U fields) and drops `d.energy` once it is
 * empty; "custom" is a display-only option offered when the document states
 * figures that match no listed preset, and commits nothing on its own.
 */
export function renderEnergyAssumptions(
  rows: Pick<PaneRows, "numRow" | "selRow">,
  store: Store,
): void {
  const e = store.doc.energy;

  const insulationId = insulationClassOf(e)
    ?? (e && (e.wallRc !== undefined || e.roofRc !== undefined || e.floorRc !== undefined) ? "custom" : "");
  const insulationOptions: Array<[string, string]> = [
    ["", t("energy.notStated")],
    ...INSULATION_CLASSES.map(c => [c.id, t("energy.insulation_" + c.id)] as [string, string]),
  ];
  if (insulationId === "custom") insulationOptions.push(["custom", t("energy.custom")]);
  rows.selRow(t("energy.insulation"), insulationId, insulationOptions, id => {
    store.mutate(d => {
      if (id === "custom") return;
      if (id === "") {
        if (!d.energy) return;
        delete d.energy.wallRc; delete d.energy.roofRc; delete d.energy.floorRc;
        if (Object.keys(d.energy).length === 0) delete d.energy;
        return;
      }
      d.energy ??= {};
      applyInsulationClass(d.energy, id as InsulationClassId);
    });
  });

  const glazingId = glazingTypeOf(e)
    ?? (e && (e.windowU !== undefined || e.doorU !== undefined) ? "custom" : "");
  const glazingOptions: Array<[string, string]> = [
    ["", t("energy.notStated")],
    ...GLAZING_TYPES.map(g => [g.id, t("energy.glazing_" + g.id)] as [string, string]),
  ];
  if (glazingId === "custom") glazingOptions.push(["custom", t("energy.custom")]);
  rows.selRow(t("energy.glazing"), glazingId, glazingOptions, id => {
    store.mutate(d => {
      if (id === "custom") return;
      if (id === "") {
        if (!d.energy) return;
        delete d.energy.windowU; delete d.energy.doorU;
        if (Object.keys(d.energy).length === 0) delete d.energy;
        return;
      }
      d.energy ??= {};
      applyGlazingType(d.energy, id as GlazingTypeId);
    });
  });

  const setField = (key: keyof EnergyAssumptions, value: number | undefined): void => {
    store.mutate(d => {
      if (!d.energy) return;
      if (value === undefined) delete d.energy[key]; else d.energy[key] = value;
      if (Object.keys(d.energy).length === 0) delete d.energy;
    });
  };
  if (e?.wallRc !== undefined) {
    rows.numRow(t("energy.rcWall"), e.wallRc, n => setField("wallRc", thermalValue(n)), 0.1);
  }
  if (e?.roofRc !== undefined) {
    rows.numRow(t("energy.rcRoof"), e.roofRc, n => setField("roofRc", thermalValue(n)), 0.1);
  }
  if (e?.floorRc !== undefined) {
    rows.numRow(t("energy.rcFloor"), e.floorRc, n => setField("floorRc", thermalValue(n)), 0.1);
  }
  if (e?.windowU !== undefined) {
    rows.numRow(t("energy.uWindow"), e.windowU, n => setField("windowU", thermalValue(n)), 0.1);
  }
  if (e?.doorU !== undefined) {
    rows.numRow(t("energy.uDoor"), e.doorU, n => setField("doorU", thermalValue(n)), 0.1);
  }
}

/**
 * The read-only takeoff: envelope area and its breakdown, usable area and
 * compactness, volume per storey, glazing by orientation, and -- only where
 * the document states enough to compute one -- an indicative transmission
 * loss. `takeoff` is supplied by the caller (Panel.syncEnergyTakeoff), which
 * is what keeps envelopeTakeoff()'s per-storey resolve off the hot path.
 */
export function renderEnergyTakeoff(
  rows: Pick<PaneRows, "infoRow" | "noteRow" | "warnRow">,
  store: Store,
  takeoff: EnvelopeTakeoff,
): void {
  rows.infoRow(t("energy.envelopeArea"), sqm(takeoff.envelopeMm2));
  rows.infoRow(t("energy.envelopeWalls"), sqm(takeoff.wallsMm2));
  rows.infoRow(t("energy.envelopeGlazing"), sqm(takeoff.glazingMm2));
  rows.infoRow(t("energy.envelopeDoors"), sqm(takeoff.doorsMm2));
  rows.infoRow(t("energy.envelopeRoof"), sqm(takeoff.roofMm2));
  rows.infoRow(t("energy.envelopeGround"), sqm(takeoff.groundMm2));

  rows.infoRow(t("energy.usableArea"), `${sqm(takeoff.usableMm2)} (${areaModeWord(takeoff.areaMode)})`);
  rows.infoRow(t("energy.compactness"), takeoff.compactness === null ? "—" : takeoff.compactness.toFixed(2));

  rows.infoRow(t("energy.volume"), m3(takeoff.volumeMm3));
  if (takeoff.storeys.length > 1) {
    for (const s of takeoff.storeys) rows.infoRow(s.name, m3(s.volumeMm3));
  }

  if (takeoff.glazingByOrientation) {
    const byOrientation = takeoff.glazingByOrientation;
    for (const dir of ORIENTATIONS) {
      const area = byOrientation[dir];
      if (area > 0) rows.infoRow(t("energy.glazingOrientation", { dir }), sqm(area));
    }
  } else {
    rows.noteRow(t("energy.northMissing", { permit: t("panel.permit") }));
  }

  if (takeoff.unstatedExterior > 0) {
    rows.warnRow(t("energy.unstatedExterior", { n: takeoff.unstatedExterior }));
  }
  if (takeoff.inwardFacades > 0) {
    rows.warnRow(t("energy.inwardFacades", { n: takeoff.inwardFacades }));
  }
  if (takeoff.overhang) rows.warnRow(t("energy.overhang"));

  const est = transmissionEstimate(takeoff, store.doc);
  if (est) {
    rows.infoRow(t("energy.heatLossTotal"), est.totalWK.toFixed(1) + " W/K");
    rows.infoRow(t("energy.meanU"), est.meanU.toFixed(2) + " W/m²K");
    rows.infoRow(t("energy.heatYear"), t("energy.kwhYear", { kwh: Math.round(est.heatKWhYear) }));
    rows.infoRow(t("energy.heatYearM2"), est.heatKWhM2Year === null
      ? "—" : t("energy.kwhM2Year", { kwh: Math.round(est.heatKWhM2Year) }));
    if (est.unstated > 0) rows.noteRow(t("energy.unstatedParts", { n: est.unstated }));
    rows.noteRow(t("energy.indicativeNote", { hdd: HEATING_DEGREE_DAYS }));
  }
}
