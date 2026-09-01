import { SymbolDef, withCtx, arrowHead, code, circle } from "./defs";
import { socketPath, switchMark } from "./electrical";

// ---------------------------------------------------------------------------
// Ventilation
//
// The reference sheet gives several marks for some of these meanings. Where it
// separates them with "of:", the mark before it is the primary one and that is
// the one drawn here. Where it lists marks as equals, the choice is the mark
// that survives export: the recorder replays fill() as an outline (see
// src/io/record.ts) and the SVG symbol group is fill="none", so a mark whose
// identity is a solid disc with a cut-out shape reaches DXF and SVG as an empty
// circle. The stroke-only marks carry the same meaning at every output.
//
// "MV" and "mv" are on the sheet's own marks for the mechanical-ventilation
// socket and switch, so they are drawn with code(); see the text rule in
// ./defs.ts.
// ---------------------------------------------------------------------------

/** Circle with a cross inscribed rim to rim: the body of an air terminal. */
function terminal(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  circle(ctx, cx, cy, r);
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
}

const mvSocket: SymbolDef = {
  type: "mv-socket",
  label: "Ventilation socket",
  category: "ventilation",
  wallMounted: true,
  width: 280,
  depth: 440,
  ports: [{ key: "electrical:power", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      socketPath(ctx, 1, false);
      code(ctx, "MV", 0, 350, 120);
    });
  },
};

const mvSwitch: SymbolDef = {
  type: "mv-switch",
  label: "Ventilation switch",
  category: "ventilation",
  wallMounted: true,
  width: 280,
  depth: 400,
  ports: [{ key: "electrical:power", required: true }],
  mountHeight: 1050,
  draw(ctx) {
    withCtx(ctx, () => {
      switchMark(ctx);
      ctx.stroke();
      code(ctx, "mv", 0, 310, 120);
    });
  },
};

const ventExhaustCeiling: SymbolDef = {
  type: "vent-exhaust-ceiling",
  label: "Ceiling exhaust point",
  category: "ventilation",
  wallMounted: false,
  width: 340,
  depth: 340,
  ports: [{ key: "vent:afvoer", required: true }],
  mountHeight: "ceiling",
  draw(ctx) {
    withCtx(ctx, () => {
      // The terminal, with the duct leaving it for the ceiling above.
      const cx = -50, cy = 50, r = 85;
      const dx = Math.SQRT1_2, dy = -Math.SQRT1_2;
      terminal(ctx, cx, cy, r);
      ctx.moveTo(cx + dx * r, cy + dy * r);
      const tipX = cx + dx * 250, tipY = cy + dy * 250;
      ctx.lineTo(tipX, tipY);
      arrowHead(ctx, tipX, tipY, -45, 55);
      ctx.stroke();
    });
  },
};

const ventExhaustWall: SymbolDef = {
  type: "vent-exhaust-wall",
  label: "Wall exhaust point",
  category: "ventilation",
  wallMounted: true,
  width: 300,
  depth: 320,
  ports: [{ key: "vent:afvoer", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      // Grille across the wall face, with the air reaching it from the room.
      ctx.moveTo(-130, 60);
      ctx.lineTo(130, 60);
      ctx.moveTo(140, 260);
      ctx.lineTo(-20, 100);
      arrowHead(ctx, -20, 100, -135, 55);
      ctx.stroke();
    });
  },
};

// Extract and supply are the same terminal; the arrow is the whole difference.
// It reads from the room's side: extract draws air out of the room, so the
// arrow points at the terminal, and supply pushes air into it, so it points
// away.
const ventExtract: SymbolDef = {
  type: "vent-extract",
  label: "Extract point",
  category: "ventilation",
  wallMounted: false,
  width: 280,
  depth: 440,
  ports: [{ key: "vent:afvoer", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      terminal(ctx, 0, -60, 100);
      ctx.moveTo(0, 220);
      ctx.lineTo(0, 70);
      arrowHead(ctx, 0, 70, -90, 55);
      ctx.stroke();
    });
  },
};

const ventSupply: SymbolDef = {
  type: "vent-supply",
  label: "Supply point",
  category: "ventilation",
  wallMounted: false,
  width: 280,
  depth: 440,
  ports: [{ key: "vent:toevoer", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      terminal(ctx, 0, -60, 100);
      ctx.moveTo(0, 70);
      ctx.lineTo(0, 220);
      arrowHead(ctx, 0, 220, 90, 55);
      ctx.stroke();
    });
  },
};

const ventValve: SymbolDef = {
  type: "vent-valve",
  label: "Vent valve",
  category: "ventilation",
  wallMounted: false,
  width: 240,
  depth: 240,
  ports: [{ key: "vent", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.moveTo(100, 0);
      ctx.arc(0, 0, 100, 0, Math.PI * 2);
      ctx.moveTo(-120, 0);
      ctx.lineTo(120, 0);
      ctx.moveTo(0, -120);
      ctx.lineTo(0, 120);
      ctx.stroke();
      // small filled centre dot
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const ventUnit: SymbolDef = {
  type: "vent-unit",
  label: "Ventilation unit",
  category: "ventilation",
  wallMounted: true,
  width: 600,
  depth: 400,
  ports: [{ key: "vent", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-300, 0, 600, 400);
      for (const x of [-150, 150]) {
        circle(ctx, x, 200, 90);
        ctx.moveTo(x - 90, 200);
        ctx.lineTo(x + 90, 200);
        ctx.moveTo(x, 110);
        ctx.lineTo(x, 290);
      }
      ctx.stroke();
    });
  },
};

const wtwUnit: SymbolDef = {
  type: "wtw-unit",
  label: "Heat recovery unit",
  category: "ventilation",
  wallMounted: true,
  width: 600,
  depth: 600,
  ports: [{ key: "vent", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-300, 0, 600, 600);
      // full X of both diagonals
      ctx.moveTo(-300, 0);
      ctx.lineTo(300, 600);
      ctx.moveTo(300, 0);
      ctx.lineTo(-300, 600);
      // arrowheads on the two right-side diagonal ends (air in/out)
      arrowHead(ctx, 300, 600, 45);
      arrowHead(ctx, 300, 0, -45);
      ctx.stroke();
    });
  },
};

const fan: SymbolDef = {
  type: "fan",
  label: "Fan",
  category: "ventilation",
  wallMounted: true,
  width: 500,
  depth: 300,
  ports: [{ key: "vent", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-250, 0, 500, 300);
      circle(ctx, -80, 150, 80);
      circle(ctx, 80, 150, 80);
      ctx.stroke();
    });
  },
};

export const SYMBOLS_VENTILATION: SymbolDef[] = [
  mvSocket,
  mvSwitch,
  ventExhaustCeiling,
  ventExhaustWall,
  ventExtract,
  ventSupply,
  ventValve,
  ventUnit,
  wtwUnit,
  fan,
];
