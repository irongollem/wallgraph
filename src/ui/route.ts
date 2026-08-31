// The route pane: the discipline the next run is drawn in, and the
// properties of a placed one. The manual-routing core (issue #25) kept this
// deliberately minimal; this is the electrical vocabulary over that core
// (issue #26) -- one Route type, richer optional fields read only when
// discipline is "electrical", not a parallel system.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { Floor, routesOf } from "../model/doc";
import {
  Route, Discipline, DISCIPLINES, RouteKind, ROUTE_KINDS, ROUTE_VEINS_DEFAULT,
  routeKind, routeVeins, clampRouteVeins,
} from "../model/route";
import { routeLength, routeGroupSummaries, routeKindSummaries } from "../core/route";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

export type RouteRows = PaneRows;

// Computed per call, not hoisted: t() follows the language the visitor has
// live, and a module-scope constant would freeze it at the first import.
function disciplineOptions(): Array<[string, string]> {
  return DISCIPLINES.map(d => [d, t("panel.discipline" + d[0]!.toUpperCase() + d.slice(1))]);
}

function kindOptions(): Array<[string, string]> {
  return ROUTE_KINDS.map(k => [k, t("panel.routeKind" + k[0]!.toUpperCase() + k.slice(1))]);
}

/** The chip row's ordinary options; a typed value reaches further (see
 *  Tools.setRouteVeins / the schema's own maximum). */
const VEINS_CHIPS: readonly number[] = [2, 3, 4, 5];

/**
 * Distinct groep values already used on the floor's electrical runs, most
 * recently placed first, capped at six -- wiring one circuit is repeated
 * clicks on the same groep, not repeated typing of it.
 */
function recentGroups(floor: Floor): string[] {
  const routes = routesOf(floor);
  const seen: string[] = [];
  for (let i = routes.length - 1; i >= 0 && seen.length < 6; i--) {
    const g = routes[i]!.group;
    if (g && !seen.includes(g)) seen.push(g);
  }
  return seen;
}

interface ElectricalFields {
  kind: RouteKind;
  veins: number;
  group: string;
  spec: string;
}

/**
 * The electrical-only rows, shared by the tool pane (arming the next run) and
 * the property pane (editing a placed one): kind, then either veins + groep
 * for a power run or a cable spec for a data run. `commit` receives only the
 * field that changed.
 */
function electricalRows(
  rows: RouteRows, floor: Floor, fields: ElectricalFields,
  commit: (patch: Partial<ElectricalFields>) => void,
): void {
  rows.selRow(t("panel.routeKind"), fields.kind, kindOptions(), v => commit({ kind: v as RouteKind }));
  if (fields.kind === "power") {
    rows.numRow(t("panel.routeVeins"), fields.veins, n => commit({ veins: n }), 1);
    rows.chipRow(t("panel.routeVeins"), VEINS_CHIPS, fields.veins, n => commit({ veins: n }));
    rows.textRow(t("panel.routeGroup"), fields.group, s => commit({ group: s.trim() }));
    const recent = recentGroups(floor);
    if (recent.length > 0) {
      rows.chipRow(t("panel.routeGroup"), recent, fields.group, g => commit({ group: g }));
    }
  } else {
    rows.textRow(t("panel.routeSpec"), fields.spec, s => commit({ spec: s.trim() }));
  }
}

/**
 * The floor's electrical runs, reported as a materials list: total length and
 * anchored-device count per groep, total cable length per kind (and, for
 * power, per aders count). Purely a read-out of what is drawn -- never
 * validated against what the meterkast actually carries. Renders nothing
 * when the floor has no electrical routes.
 */
function materialsRows(rows: RouteRows, floor: Floor): void {
  const groups = routeGroupSummaries(floor);
  const kinds = routeKindSummaries(floor);
  if (groups.length === 0 && kinds.length === 0) return;
  rows.noteRow(t("panel.routeMaterialsNote"));
  for (const g of groups) {
    rows.infoRow(t("panel.routeMaterialsGroup", { group: g.group }),
      t("panel.routeMaterialsGroupValue", { length: Math.round(g.lengthMm), n: g.devices }));
  }
  for (const k of kinds) {
    const kindLabel = t("panel.routeKind" + k.kind[0]!.toUpperCase() + k.kind.slice(1));
    const label = k.veins !== undefined
      ? t("panel.routeMaterialsKindVeins", { kind: kindLabel, veins: k.veins })
      : kindLabel;
    rows.infoRow(label, `${Math.round(k.lengthMm)} mm`);
  }
}

/** The discipline the next run will be drawn in, plus its armed properties. */
export function renderRouteTool(store: Store, tools: Tools, rows: RouteRows): void {
  rows.secHead(t("panel.newRoute"));
  rows.selRow(t("panel.routeDiscipline"), tools.routeDiscipline, disciplineOptions(),
    d => tools.setRouteDiscipline(d as Discipline));
  if (tools.routeDiscipline === "electrical") {
    electricalRows(rows, store.floor, {
      kind: tools.routeKind, veins: tools.routeVeins, group: tools.routeGroup, spec: tools.routeSpec,
    }, patch => {
      if (patch.kind !== undefined) tools.setRouteKind(patch.kind);
      if (patch.veins !== undefined) tools.setRouteVeins(patch.veins);
      if (patch.group !== undefined) tools.setRouteGroup(patch.group);
      if (patch.spec !== undefined) tools.setRouteSpec(patch.spec);
    });
  }
  rows.noteRow(t("panel.routeNote"));
  materialsRows(rows, store.floor);
}

/** Properties of the selected route. */
export function renderRouteProps(store: Store, tools: Tools, rows: RouteRows, id: string): void {
  const route = routesOf(store.floor).find(x => x.id === id);
  if (!route) return;

  const mut = (fn: (r: Route) => void): void => {
    store.mutate(d => {
      const r2 = routesOf(store.floorOf(d)).find(x => x.id === id);
      if (r2) fn(r2);
    });
  };

  rows.secHead(t("panel.route"), { sel: true });
  rows.selRow(t("panel.routeDiscipline"), route.discipline, disciplineOptions(),
    d => mut(r => {
      r.discipline = d as Discipline;
      // The electrical vocabulary means nothing on a water or vent run --
      // dropped on the way out, the way a cabinet preset swap rewrites every
      // field the old preset wrote.
      if (r.discipline !== "electrical") { delete r.kind; delete r.veins; delete r.group; delete r.spec; }
    }));
  if (route.discipline === "electrical") {
    electricalRows(rows, store.floor, {
      kind: routeKind(route), veins: routeVeins(route), group: route.group ?? "", spec: route.spec ?? "",
    }, patch => mut(r => {
      if (patch.kind !== undefined) {
        if (patch.kind === "power") delete r.kind; else r.kind = patch.kind;
      }
      if (patch.veins !== undefined) {
        const v = clampRouteVeins(patch.veins);
        if (v === ROUTE_VEINS_DEFAULT) delete r.veins; else r.veins = v;
      }
      if (patch.group !== undefined) {
        if (patch.group) r.group = patch.group; else delete r.group;
      }
      if (patch.spec !== undefined) {
        if (patch.spec) r.spec = patch.spec; else delete r.spec;
      }
    }));
  }
  rows.infoRow(t("panel.routeLength"), `${Math.round(routeLength(store.floor, route))} mm`);
  rows.noteRow(t("panel.routePoints", { n: route.points.length }));
  materialsRows(rows, store.floor);
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}
