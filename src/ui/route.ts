// The route pane: the discipline the next run is drawn in, and the
// properties of a placed one. Deliberately minimal -- this is the manual-
// routing core (issue #25); per-discipline metadata is follow-up work, so
// there is nothing here to edit beyond discipline, length and point count.
import { Store } from "../model/store";
import { Tools } from "../input/tools";
import { routesOf } from "../model/doc";
import { Route, Discipline, DISCIPLINES } from "../model/route";
import { routeLength } from "../core/route";
import { t } from "../i18n";
import type { PaneRows } from "./stairs";

export type RouteRows = PaneRows;

// Computed per call, not hoisted: t() follows the language the visitor has
// live, and a module-scope constant would freeze it at the first import.
function disciplineOptions(): Array<[string, string]> {
  return DISCIPLINES.map(d => [d, t("panel.discipline" + d[0]!.toUpperCase() + d.slice(1))]);
}

/** The discipline the next run will be drawn in. */
export function renderRouteTool(store: Store, tools: Tools, rows: RouteRows): void {
  rows.secHead(t("panel.newRoute"));
  rows.selRow(t("panel.routeDiscipline"), tools.routeDiscipline, disciplineOptions(),
    d => tools.setRouteDiscipline(d as Discipline));
  rows.noteRow(t("panel.routeNote"));
  void store;
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
    d => mut(r => { r.discipline = d as Discipline; }));
  rows.infoRow(t("panel.routeLength"), `${Math.round(routeLength(store.floor, route))} mm`);
  rows.noteRow(t("panel.routePoints", { n: route.points.length }));
  rows.dangerRow(t("panel.deleteOpening"), () => tools.deleteSelected());
}
