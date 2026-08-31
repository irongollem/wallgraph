// Compact-layout tests. The touch gestures themselves need a canvas and live
// pointers, so what is checked here is the part that is decidable without a
// browser: the breakpoint, the sheet's detent arithmetic, and the fact that
// every hint the touch UI asks for actually exists in both languages.
import { readFileSync } from "node:fs";
import { layoutFor, COMPACT_MAX_PX, SHORT_MAX_PX, COMPACT_QUERY, watchLayout, isTouchPrimary } from "../src/ui/layout";
import { DETENTS, nearestDetent, nextDetent, type Detent } from "../src/ui/sheet";
import { resources } from "../src/i18n";

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) { failures++; console.error(`FAIL ${name} ${detail}`); }
  else console.log(`ok   ${name}`);
}

// --- the breakpoint ---
{
  check("a phone is compact", layoutFor(390, 844) === "compact");
  check("the width breakpoint itself is compact", layoutFor(COMPACT_MAX_PX, 900) === "compact");
  check("one pixel wider is not", layoutFor(COMPACT_MAX_PX + 1, 900) === "wide");
  check("a tablet is wide", layoutFor(820, 1180) === "wide");
  check("a desktop window is wide", layoutFor(1440, 900) === "wide");

  // A landscape phone is wide enough for the sidebar and far too short for it:
  // eight tools, three modes and undo/redo need more rail than 390 px of height.
  check("a landscape phone is compact by height", layoutFor(844, 390) === "compact");
  check("the height breakpoint itself is compact", layoutFor(1440, SHORT_MAX_PX) === "compact");
  check("one pixel taller is not", layoutFor(1440, SHORT_MAX_PX + 1) === "wide");

  // The stylesheet cannot import the constants, so the two are written twice and
  // have to be checked against each other: a silent disagreement would dress the
  // compact DOM in the sidebar's clothes.
  const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  check("the stylesheet carries the compact rules", css.includes(".side.is-compact"));
  // The key badges on the rail are the captions' opposite number: a finger has
  // no key to press and no title to hover, so every shell that shows a caption
  // has to drop them, or the two labels collide on one 52 px tool.
  check("the compact shell drops the key badges",
    css.includes(".side.is-compact .rail-key"));
  check("a coarse pointer drops the key badges",
    css.includes(".rail-key, .btn-key { display: none; }"));
  check("the stylesheet agrees on the short breakpoint",
    css.includes(`max-height: ${SHORT_MAX_PX}px`), COMPACT_QUERY);
  check("the compact query names both limits",
    COMPACT_QUERY.includes(`${COMPACT_MAX_PX}px`) && COMPACT_QUERY.includes(`${SHORT_MAX_PX}px`), COMPACT_QUERY);

  // Without a DOM there is no media query to read; both must answer rather than
  // throw, since the build script and these tests import the module in node.
  check("layout falls back to wide off the browser", watchLayout(() => {}) === "wide");
  check("touch is not assumed off the browser", isTouchPrimary() === false);
}

// --- sheet detents ---
{
  const all: Detent[] = ["peek", "half", "full"];
  check("three detents", all.every(d => typeof DETENTS[d] === "number"));
  check("detents rise", DETENTS.peek < DETENTS.half && DETENTS.half < DETENTS.full);
  check("detents stay on screen", all.every(d => DETENTS[d] > 0 && DETENTS[d] <= 1));
  // Full stops short of the top: the plan never disappears behind the sheet.
  check("full leaves the plan visible", DETENTS.full < 1);

  for (const d of all) {
    check(`${d} snaps to itself`, nearestDetent(DETENTS[d]) === d);
  }
  check("a drag below peek still snaps to peek", nearestDetent(0.05) === "peek");
  check("a drag above full still snaps to full", nearestDetent(1) === "full");
  const between = (DETENTS.peek + DETENTS.half) / 2;
  check("halfway between two detents picks one of them",
    nearestDetent(between - 0.01) === "peek" && nearestDetent(between + 0.01) === "half");

  check("tapping cycles up", nextDetent("peek") === "half" && nextDetent("half") === "full");
  check("tapping wraps back to peek", nextDetent("full") === "peek");
}

// --- hints have a touch twin ---
{
  // Tools.hintKey() turns each of these into hint.touch<Base> when the editor is
  // laid out for touch. i18n falls back to the key itself, so a missing twin
  // shows the visitor "hint.touchWallChain" rather than an instruction.
  const bases = [
    "select", "selectWall", "selectWallTyped", "selectCabinet",
    "wallStart", "wallChain", "wallTyped",
    "wallRect", "wallRectTo", "wallCircle", "wallCircleTo", "wallPolygon", "wallPolygonTo",
    "door", "window", "passage", "symbol", "stair", "vide",
    "cabinet", "zoom",
  ];
  const touchKey = (base: string): string => `touch${base[0]!.toUpperCase()}${base.slice(1)}`;

  for (const lang of ["nl", "en"] as const) {
    const hints = resources[lang].translation.hint as Record<string, string | undefined>;
    const missingPlain = bases.filter(b => typeof hints[b] !== "string");
    const missingTouch = bases.filter(b => typeof hints[touchKey(b)] !== "string");
    check(`${lang} has every desktop hint`, missingPlain.length === 0, missingPlain.join(","));
    check(`${lang} has every touch hint`, missingTouch.length === 0, missingTouch.join(","));
  }

  // The touch wording must not name a key or a mouse button; that is the whole
  // reason the second set exists.
  const mouseWords = /\b(klik|click|rechtermuis|right-click|Del\b|Esc\b|Enter\b)/i;
  for (const lang of ["nl", "en"] as const) {
    const hints = resources[lang].translation.hint as Record<string, string | undefined>;
    const offenders = bases
      .map(touchKey)
      .filter(k => mouseWords.test(hints[k] ?? ""));
    check(`${lang} touch hints name no keys or buttons`, offenders.length === 0, offenders.join(","));
  }
}

// --- short tool names ---
{
  // Every tool and mode button carries a caption on touch, where there is no
  // title to hover. A missing one renders as its own key under the icon.
  const names = [
    "shortSelect", "shortWall", "shortDoor", "shortWindow", "shortPassage",
    "shortStair", "shortVide", "shortSymbol",
    "shortCabinet", "shortZoom",
    "shortGridSnap", "shortAngleSnap", "shortMeasurements",
  ];
  for (const lang of ["nl", "en"] as const) {
    const tool = resources[lang].translation.tool as Record<string, string | undefined>;
    const missing = names.filter(n => typeof tool[n] !== "string");
    check(`${lang} names every button`, missing.length === 0, missing.join(","));
    // 46px of tool bar at 9.5px type is about twelve characters.
    const tooLong = names.filter(n => (tool[n] ?? "").length > 12);
    check(`${lang} captions fit the tool bar`, tooLong.length === 0, tooLong.join(","));
  }
}

console.log(failures === 0 ? "ALL MOBILE TESTS PASSED" : `${failures} MOBILE TEST FAILURES`);
process.exit(failures === 0 ? 0 : 1);
