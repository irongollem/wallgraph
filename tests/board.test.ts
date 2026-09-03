// The groepenkast: what it distributes, and where a circuit hooks onto it.
//
// The point of declaring groepen is that a run's groep stops being a string the
// drawing hopes agrees with another string. A run ANCHORED to a groep is on
// that groep; renaming the groep in the kast renames it on every run hanging
// off it, and the takeoff groups by the kast's own label.
import { emptyDoc, type SymbolInstance } from "../src/model/doc";
import {
  boardOf, boardGroups, nextGroup, clampBoardName, groupLocalPoint, GROUP_PITCH_MM,
} from "../src/model/board";
import {
  BOARD_TYPE, boardsOn, resolveBoard, resolveBoards, groupById,
  routeGroupOf, routeGroup, routeBoard, groupNames, groupLoad,
} from "../src/core/board";
import { resolveRoutePoints, routeGroupSummaries } from "../src/core/route";
import { planSchema, validate } from "../scripts/site/schema";
import type { Route } from "../src/model/route";
import { servicesPaneActive, fitoutPaneActive } from "../src/ui/panes";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

function kast(groups: string[], over: Partial<SymbolInstance> = {}): SymbolInstance {
  return {
    id: "mk", type: BOARD_TYPE, x: 0, y: 0, rotation: 0,
    board: { name: "MK", groups: groups.map((name, i) => ({ id: `g${i}`, name })) },
    ...over,
  };
}

/* ── the data a kast carries ── */

{
  const bare: SymbolInstance = { id: "b", type: BOARD_TYPE, x: 0, y: 0, rotation: 0 };
  check("a kast that carries nothing is empty, not missing",
    boardOf(bare).groups.length === 0 && boardGroups(bare).length === 0);
  check("a kast reports what it declares", boardGroups(kast(["1", "2"])).length === 2);

  check("a new groep takes the first free number",
    nextGroup([]).name === "1"
    && nextGroup([{ id: "a", name: "1" }, { id: "b", name: "2" }]).name === "3");
  // Numbering is a convenience, not a rule: a hand-named kast keeps its labels.
  check("and steps over names already used",
    nextGroup([{ id: "a", name: "1" }, { id: "b", name: "3" }]).name === "2");
  check("names are trimmed and bounded",
    clampBoardName("  K1  ") === "K1" && clampBoardName("x".repeat(40)).length === 16);
}

/* ── where a circuit hooks on ── */

{
  const one = resolveBoard(kast(["1"]));
  check("one groep sits on the kast's centreline", Math.abs(one[0]!.at.x) < 1e-6);
  const three = resolveBoard(kast(["1", "2", "3"]));
  check("three fan out about the centre either side",
    three[0]!.at.x < 0 && Math.abs(three[1]!.at.x) < 1e-6 && three[2]!.at.x > 0,
    three.map(g => g.at.x).join(","));
  check("all of them stand off the kast's front edge",
    three.every(g => g.at.y > 0));
  check("at the ordinary pitch while there is room",
    Math.abs((three[1]!.at.x - three[0]!.at.x) - GROUP_PITCH_MM) < 1e-6);
  // A kast of many groepen tightens rather than overlapping.
  const many = groupLocalPoint(1, 60, 250).x - groupLocalPoint(0, 60, 250).x;
  check("a crowded kast tightens the pitch instead of overlapping",
    many > 0 && many < GROUP_PITCH_MM, String(many));

  // The points follow the kast, because they are derived from its placement.
  const moved = resolveBoard(kast(["1"], { x: 5000, y: 2000 }));
  check("moving the kast moves every connection point",
    Math.abs(moved[0]!.at.x - 5000) < 1e-6);
  const turned = resolveBoard(kast(["1", "2"], { rotation: Math.PI / 2 }));
  check("and turning it turns them", Math.abs(turned[0]!.at.y - turned[1]!.at.y) > 1);
}

{
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push(kast(["1", "2"]), { id: "s", type: "socket-single", x: 0, y: 0, rotation: 0 });
  check("only board symbols are kasten", boardsOn(f).length === 1);
  check("every groep on the floor is reachable", resolveBoards(f).length === 2);
  check("and each by its own id", groupById(f, "g1")?.group.name === "2");
  check("something that is not a groep resolves to nothing", groupById(f, "s") === undefined);
}

/* ── a run connected to a groep ── */

function wired(): { doc: ReturnType<typeof emptyDoc>; route: Route } {
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push(kast(["1", "2", "3"]));
  const route: Route = {
    id: "r", discipline: "electrical",
    points: [{ id: "a", x: 0, y: 0, anchor: "g1" }, { id: "b", x: 4000, y: 0 }],
    segments: [{ id: "s", a: "a", b: "b" }],
  };
  f.routes = [route];
  return { doc, route };
}

{
  const { doc, route } = wired();
  const f = doc.floors[0]!;
  check("the run knows which groep it is on", routeGroupOf(f, route)?.group.name === "2");
  check("and reports it as its groep", routeGroup(f, route) === "2");
  check("and the kast it comes from", routeBoard(f, route) === "MK");

  // The end of the run resolves to the groep's own point, so moving the kast
  // takes the circuit with it.
  const end = resolveRoutePoints(f, route)[0]!;
  check("the run ends at the groep's connection point",
    Math.abs(end.x - resolveBoards(f)[1]!.at.x) < 1e-6 && end.y > 0);
  f.symbols[0]!.x = 3000;
  check("and follows the kast when it moves",
    Math.abs(resolveRoutePoints(f, route)[0]!.x - 3000) < 1e-6);
}

{
  // The whole point: the groep is the kast's label, not a copy of it.
  const { doc, route } = wired();
  const f = doc.floors[0]!;
  f.symbols[0]!.board!.groups[1]!.name = "K7";
  check("renaming the groep in the kast renames it on the run",
    routeGroup(f, route) === "K7");
  // A typed groep is not consulted while the run is connected to a real one.
  route.group = "99";
  check("a stale typed groep does not win over the kast",
    routeGroup(f, route) === "K7");
}

{
  // A run that is not on a modelled kast keeps its typed groep — a kast
  // outside the drawing is the ordinary early case.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  const route: Route = {
    id: "r", discipline: "electrical", group: "4", board: "OK1",
    points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1000, y: 0 }],
    segments: [{ id: "s", a: "a", b: "b" }],
  };
  f.routes = [route];
  check("an unconnected run still states its typed groep", routeGroup(f, route) === "4");
  check("and its typed kast", routeBoard(f, route) === "OK1");
  check("blank text is not a groep",
    routeGroup(f, { ...route, group: "   " }) === undefined);
}

/* ── what the kast reports ── */

{
  const { doc } = wired();
  const f = doc.floors[0]!;
  const load = groupLoad(f, f.symbols[0]!);
  check("a groep reports the runs hanging off it", load.get("g1") === 1);
  check("and an empty groep reports none",
    load.get("g0") === 0 && load.get("g2") === 0);
  check("the floor's groep names lead with the ones a kast declares",
    groupNames(f).slice(0, 3).join() === "1,2,3");
}

{
  // The takeoff groups by the derived name, so two runs on one groep are one
  // line however they were labelled.
  const doc = emptyDoc();
  const f = doc.floors[0]!;
  f.symbols.push(kast(["1"]));
  f.routes = [
    { id: "a", discipline: "electrical",
      points: [{ id: "aa", x: 0, y: 0, anchor: "g0" }, { id: "ab", x: 1000, y: 0 }],
      segments: [{ id: "as", a: "aa", b: "ab" }] },
    // Typed to match the kast's label rather than connected to it.
    { id: "b", discipline: "electrical", group: "1",
      points: [{ id: "ba", x: 0, y: 500 }, { id: "bb", x: 1000, y: 500 }],
      segments: [{ id: "bs", a: "ba", b: "bb" }] },
  ];
  const summaries = routeGroupSummaries(f);
  check("a connected run and a typed one on the same groep are one line",
    summaries.length === 1 && summaries[0]!.group === "1", JSON.stringify(summaries));
}

/* ── what the document may store ── */

{
  const doc = emptyDoc();
  doc.floors[0]!.symbols.push(kast(["1", "K2"]));
  const schema = planSchema("");
  check("a kast with groepen validates", validate(schema, doc).length === 0,
    JSON.stringify(validate(schema, doc)));
  check("it survives a JSON round-trip",
    JSON.parse(JSON.stringify(doc)).floors[0].symbols[0].board.groups[1].name === "K2");

  const unnamed = JSON.parse(JSON.stringify(doc));
  delete unnamed.floors[0].symbols[0].board.groups[0].name;
  check("a groep without a name is rejected", validate(schema, unnamed).length > 0);
  const extra = JSON.parse(JSON.stringify(doc));
  extra.floors[0].symbols[0].board.rating = "16A";
  check("a field the kast does not have is rejected", validate(schema, extra).length > 0);
}

/* ── which pane owns the property area ── */

{
  // The regression this predicate exists for: Tools.symbolType is sticky and
  // starts on a socket, so a services pane that tested it alone owned the
  // property area for the whole session -- picking a wall showed "nieuwe
  // leiding" and the wall's own rows were unreachable.
  check("selecting with a socket still armed does not hand the pane to services",
    !servicesPaneActive("select", "socket-single"));
  check("nor to the fit-out pane with a blusser armed",
    !fitoutPaneActive("select", "smoke-detector"));

  check("the route tool owns it", servicesPaneActive("route", "socket-single"));
  // Arming a socket from the Installaties palette must not throw the run's
  // properties away, so the symbol tool keeps the pane its palette belongs to.
  check("and so does the services palette while a symbol is armed",
    servicesPaneActive("symbol", "socket-single"));
  check("but a fit-out mark armed from the symbol tool belongs to fit-out",
    fitoutPaneActive("symbol", "smoke-detector")
    && !servicesPaneActive("symbol", "smoke-detector"));
  check("the furnishing tool owns the fit-out pane",
    fitoutPaneActive("furnishing", "socket-single"));
  check("an unknown type owns nothing",
    !servicesPaneActive("symbol", "not-a-symbol") && !fitoutPaneActive("symbol", "not-a-symbol"));
  // Every other tool keeps its own rows whatever is sticky.
  for (const tool of ["wall", "door", "window", "passage", "stair", "structure", "zoom"] as const) {
    check(`the ${tool} tool keeps the property area`,
      !servicesPaneActive(tool, "socket-single") && !fitoutPaneActive(tool, "socket-single"));
  }
}

/* ── both languages name what the panel shows ── */

{
  const keys = ["board", "boardName", "boardGroup", "boardGroupLabel", "boardGroupRuns",
    "boardGroupRunCount", "boardGroupEmpty", "boardGroupAdd", "boardGroupRemove",
    "boardNote", "routeGroupFromBoard"];
  for (const lang of ["nl", "en"] as const) {
    const panel = resources[lang].translation.panel as Record<string, string>;
    check(`${lang} names every groepenkast field`,
      keys.every(k => typeof panel[k] === "string" && panel[k]!.length > 0),
      keys.filter(k => !panel[k]).join(","));
  }
}

console.log(failures === 0 ? "ALL BOARD TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
