// Services in the IFC export (issue #30).
//
// A 2D plan-space run stated in a model that expects 3D products. What these
// check is that the statement is honest about what it is: the true geometry
// rather than the canvas's legibility fan, a nominal cross-section at the
// plane the run says it is installed in, the service metadata as properties,
// and one distribution system per groep so a receiving model can select a
// circuit. No fittings, no risers, no connectivity -- the document holds none.
import { emptyDoc, type PlanDoc } from "../src/model/doc";
import { toIfc } from "../src/io/ifc";
import type { Route } from "../src/model/route";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

function docWith(...routes: Route[]): PlanDoc {
  const doc = emptyDoc();
  doc.guid = "test-seed";
  doc.floors[0]!.routes = routes;
  return doc;
}

const straight = (id: string, over: Partial<Route> = {}): Route => ({
  id, discipline: "electrical",
  points: [{ id: `${id}a`, x: 0, y: 0 }, { id: `${id}b`, x: 3000, y: 0 }],
  segments: [{ id: `${id}s`, a: `${id}a`, b: `${id}b` }],
  ...over,
});

/** Entity lines of one type, as they appear in the STEP data section. */
function entities(text: string, entity: string): string[] {
  return text.split("\n").filter(line => line.includes(`=${entity}(`));
}

/* ── the occurrence class per discipline ── */

{
  const text = toIfc(docWith(
    straight("e"),
    straight("w", { discipline: "water" }),
    straight("g", { discipline: "gas" }),
    straight("v", { discipline: "vent" }),
  ));
  check("an electrical run is a cable carrier segment",
    entities(text, "IFCCABLECARRIERSEGMENT").length === 1);
  check("a vent run is a duct segment", entities(text, "IFCDUCTSEGMENT").length === 1);
  // Gas runs in pipe, like water.
  check("water and gas are both pipe segments",
    entities(text, "IFCPIPESEGMENT").length === 2);
}

{
  const doc = emptyDoc();
  doc.guid = "test-seed";
  check("a plan with no services declares no MEP elements at all",
    !toIfc(doc).includes("IFCPIPESEGMENT") && !toIfc(doc).includes("IFCDISTRIBUTIONSYSTEM"));
}

/* ── one segment per leg ── */

{
  const bent: Route = {
    id: "r", discipline: "water",
    points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 2000, y: 0 }, { id: "c", x: 2000, y: 2000 }],
    segments: [{ id: "s0", a: "a", b: "b" }, { id: "s1", a: "b", b: "c" }],
  };
  check("a run of two legs writes two segments",
    entities(toIfc(docWith(bent)), "IFCPIPESEGMENT").length === 2);

  // A bowed leg becomes the straight legs it flattens to.
  const bowed: Route = {
    id: "r", discipline: "water",
    points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 2000, y: 0 }],
    segments: [{ id: "s0", a: "a", b: "b", bulge: 0.5 }],
  };
  check("a bowed leg writes the straight legs it flattens to",
    entities(toIfc(docWith(bowed)), "IFCPIPESEGMENT").length > 1);

  // A leg with nothing to draw contributes nothing rather than a zero-depth
  // solid the schema would reject.
  const degenerate: Route = {
    id: "r", discipline: "water",
    points: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 0, y: 0 }],
    segments: [{ id: "s0", a: "a", b: "b" }],
  };
  check("a zero-length leg writes nothing",
    entities(toIfc(docWith(degenerate)), "IFCPIPESEGMENT").length === 0);
}

/* ── placement: the true run, at the plane it says it is installed in ── */

{
  // Two parallel runs in one corridor. The canvas fans them into side-by-side
  // lanes so both stay readable; the model must state where they ARE.
  const a = straight("a", { group: "1" });
  const b: Route = {
    id: "b", discipline: "electrical", group: "2",
    points: [{ id: "ba", x: 0, y: 20 }, { id: "bb", x: 3000, y: 20 }],
    segments: [{ id: "bs", a: "ba", b: "bb" }],
  };
  const text = toIfc(docWith(a, b));
  // The fan offsets by 60 mm either side of centre; the extruded quads are
  // half of the 50 mm cable-carrier section from the stored y instead.
  check("the export states the run where it is, not where the canvas fans it",
    text.includes("(0.,-25.)") && text.includes("(0.,5.)"),
    entities(text, "IFCCARTESIANPOINT").slice(0, 4).join(" "));
}

{
  // The extrusion sits at the plane the route states. A ceiling run is at the
  // storey height, not on the floor.
  const overhead = straight("r", { discipline: "vent", installation: "ceiling" });
  const text = toIfc(docWith(overhead));
  // 2800 storey, 125 duct: the extrusion base sits at 2800 - 62.5.
  check("a ceiling run is extruded at the storey height",
    text.includes("IFCCARTESIANPOINT((0.,0.,2737.5))"),
    entities(text, "IFCCARTESIANPOINT").filter(l => l.includes("0.,0.,")).join(" "));
  const floorRun = toIfc(docWith(straight("r", { discipline: "vent", installation: "floor" })));
  check("a floor run is extruded from the slab, never below it",
    floorRun.includes("IFCCARTESIANPOINT((0.,0.,0.))")
    && !floorRun.includes("IFCCARTESIANPOINT((0.,0.,-62.5))"),
    entities(floorRun, "IFCCARTESIANPOINT").filter(l => l.includes("0.,0.,")).join(" "));
}

/* ── the metadata a run states ── */

{
  const text = toIfc(docWith(straight("r", {
    tag: "E-01", board: "MK", group: "3", veins: 5, installation: "surface",
  })));
  check("the pset names the service", text.includes("Pset_WallgraphService"));
  check("it carries the groep", text.includes("'Group'") && text.includes("'3'"));
  check("the board", text.includes("'Board'") && text.includes("'MK'"));
  check("the conductor count", text.includes("'Conductors'") && text.includes("IFCCOUNTMEASURE(5)"));
  check("and the installation", text.includes("'Installation'") && text.includes("'surface'"));
  // One pset for the whole run, not one per leg.
  check("one property set per run", entities(text, "IFCPROPERTYSET")
    .filter(line => line.includes("Pset_WallgraphService")).length === 1);
}

{
  const water = toIfc(docWith(straight("r", { discipline: "water", water: "afvoer", diameter: 110 })));
  check("a drain states its nominal diameter",
    water.includes("'NominalDiameter'") && water.includes("IFCPOSITIVELENGTHMEASURE(110.)"));
  const vent = toIfc(docWith(straight("r", { discipline: "vent", flow: 75 })));
  check("a duct states its design flow when one was entered",
    vent.includes("'DesignFlowRate'") && vent.includes("IFCREAL(75.)"));
  // Absent stays absent: a flow figure is a fact someone designed to.
  check("and states none when nobody entered one",
    !toIfc(docWith(straight("r", { discipline: "vent" }))).includes("DesignFlowRate"));
  check("a run that named no groep says nothing about one",
    !toIfc(docWith(straight("r"))).includes("'Group'"));
}

/* ── distribution systems ── */

{
  const text = toIfc(docWith(
    straight("a", { group: "1" }),
    straight("b", { group: "1" }),
    straight("c", { group: "2" }),
  ));
  const systems = entities(text, "IFCDISTRIBUTIONSYSTEM");
  check("one system per groep, not one per run", systems.length === 2, String(systems.length));
  check("named as the meterkast labels them",
    text.includes("'Groep 1'") && text.includes("'Groep 2'"));
  check("classified as electrical", systems.every(line => line.includes("ELECTRICAL")));
  check("each system names its own segments",
    entities(text, "IFCRELASSIGNSTOGROUP").length === 2);
  check("and is tied to the building it serves",
    entities(text, "IFCRELSERVICESBUILDINGS").length === 2);
}

{
  const text = toIfc(docWith(
    straight("k", { discipline: "water", water: "koud" }),
    straight("w", { discipline: "water", water: "warm" }),
    straight("a", { discipline: "water", water: "afvoer" }),
    straight("v", { discipline: "vent" }),
    straight("g", { discipline: "gas" }),
  ));
  check("supply, hot supply and drainage are separate systems",
    text.includes("DOMESTICCOLDWATER") && text.includes("DOMESTICHOTWATER") && text.includes("DRAINAGE"));
  check("as are ventilation and gas",
    text.includes("VENTILATION") && text.includes(".GAS."));
  check("five services, five systems",
    entities(text, "IFCDISTRIBUTIONSYSTEM").length === 5);
}

{
  // A system is a property of the building, so a groep running up two storeys
  // is ONE system with segments on both.
  const doc = docWith(straight("a", { group: "1" }));
  doc.floors.push({
    id: "f2", name: "1e", nodes: [], walls: [], symbols: [], stairs: [], vides: [],
    furnishings: [], roomNames: [], routes: [straight("b", { group: "1" })],
  });
  const text = toIfc(doc);
  check("a groep spanning two storeys is one system",
    entities(text, "IFCDISTRIBUTIONSYSTEM").length === 1);
  check("with both storeys' segments assigned to it",
    entities(text, "IFCRELASSIGNSTOGROUP").length === 1);
  // Each leg is still contained in the storey it is drawn on.
  check("and each leg still contained in its own storey",
    entities(text, "IFCRELCONTAINEDINSPATIALSTRUCTURE").length === 2);
}

/* ── stable identity ── */

{
  const doc = docWith(straight("r", { discipline: "water" }));
  check("the same document exports byte-identically",
    toIfc(doc, 0) === toIfc(doc, 0));
  const other = docWith(straight("r", { discipline: "water" }));
  other.guid = "another-seed";
  check("a different document seed derives different GlobalIds",
    toIfc(doc, 0) !== toIfc(other, 0));
}

console.log(failures === 0 ? "ALL IFC SERVICE TESTS PASSED" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
