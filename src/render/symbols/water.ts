import { SymbolDef, withCtx, applianceBox, circle, code, dot } from "./defs";

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

const waterPoint: SymbolDef = {
  type: "water-point",
  label: "Cold tap",
  category: "water",
  wallMounted: true,
  width: 240,
  depth: 240,
  ports: [{ key: "water:koud", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      // Stem from the wall, then an open equilateral triangle (side 150)
      // pointing away from the wall.
      const stemEnd = 110;
      const side = 150;
      const half = side / 2;
      const h = (side * Math.sqrt(3)) / 2; // equilateral triangle height
      ctx.moveTo(0, 0);
      ctx.lineTo(0, stemEnd);
      ctx.moveTo(-half, stemEnd);
      ctx.lineTo(half, stemEnd);
      ctx.lineTo(0, stemEnd + h);
      ctx.closePath();
      ctx.stroke();
    });
  },
};

const waterPointHot: SymbolDef = {
  type: "water-point-hot",
  label: "Hot tap",
  category: "water",
  wallMounted: true,
  width: 240,
  depth: 260,
  ports: [{ key: "water:warm", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      // Same stem + open triangle as water-point, with a second, smaller
      // concentric triangle (side 70) sharing the same base line, nested
      // inside the big one.
      const stemEnd = 110;
      const outerSide = 150;
      const outerHalf = outerSide / 2;
      const outerH = (outerSide * Math.sqrt(3)) / 2;
      ctx.moveTo(0, 0);
      ctx.lineTo(0, stemEnd);
      ctx.moveTo(-outerHalf, stemEnd);
      ctx.lineTo(outerHalf, stemEnd);
      ctx.lineTo(0, stemEnd + outerH);
      ctx.closePath();

      const innerSide = 70;
      const innerHalf = innerSide / 2;
      const innerH = (innerSide * Math.sqrt(3)) / 2;
      ctx.moveTo(-innerHalf, stemEnd);
      ctx.lineTo(innerHalf, stemEnd);
      ctx.lineTo(0, stemEnd + innerH);
      ctx.closePath();
      ctx.stroke();
    });
  },
};

// Vloeraansluitpunt: the wall-mounted tap-point form re-centred inside a round
// floor box, the way socket-floor relates to socket-single.
const BOX_R = 150;      // floor box radius
const TRI_BASE = -10;   // triangle base line, from the box centre
const TRI_SIDE = 150;
const TRI_H = (TRI_SIDE * Math.sqrt(3)) / 2;

function floorWaterPath(ctx: CanvasRenderingContext2D, hot: boolean): void {
  ctx.moveTo(0, -BOX_R);
  ctx.lineTo(0, TRI_BASE); // stem, from the box outline to the triangle base
  const half = TRI_SIDE / 2;
  ctx.moveTo(-half, TRI_BASE);
  ctx.lineTo(half, TRI_BASE);
  ctx.lineTo(0, TRI_BASE + TRI_H);
  ctx.closePath();
  if (hot) {
    const innerSide = 70;
    const innerHalf = innerSide / 2;
    ctx.moveTo(-innerHalf, TRI_BASE);
    ctx.lineTo(innerHalf, TRI_BASE);
    ctx.lineTo(0, TRI_BASE + (innerSide * Math.sqrt(3)) / 2);
    ctx.closePath();
  }
  ctx.moveTo(BOX_R, 0);
  ctx.arc(0, 0, BOX_R, 0, Math.PI * 2);
  ctx.stroke();
}

const waterPointFloor: SymbolDef = {
  type: "water-point-floor",
  label: "Cold tap (floor)",
  category: "water",
  wallMounted: false,
  width: BOX_R * 2 + 20,
  depth: BOX_R * 2 + 20,
  ports: [{ key: "water:koud", required: true }],
  mountHeight: 0,
  draw(ctx) {
    withCtx(ctx, () => floorWaterPath(ctx, false));
  },
};

const waterPointFloorHot: SymbolDef = {
  type: "water-point-floor-hot",
  label: "Hot tap (floor)",
  category: "water",
  wallMounted: false,
  width: BOX_R * 2 + 20,
  depth: BOX_R * 2 + 20,
  ports: [{ key: "water:warm", required: true }],
  mountHeight: 0,
  draw(ctx) {
    withCtx(ctx, () => floorWaterPath(ctx, true));
  },
};

const mixerTap: SymbolDef = {
  type: "mixer-tap",
  label: "Mixer tap",
  category: "water",
  wallMounted: true,
  width: 340,
  depth: 260,
  ports: [{ key: "water:koud", required: true }, { key: "water:warm", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      // One stem from the wall, then two open triangles (side 130) side by
      // side below it, bases at the stem end, centred at x = -80 and x = +80.
      const stemEnd = 110;
      ctx.moveTo(0, 0);
      ctx.lineTo(0, stemEnd);

      const side = 130;
      const half = side / 2;
      const h = (side * Math.sqrt(3)) / 2;
      for (const cx of [-80, 80]) {
        ctx.moveTo(cx - half, stemEnd);
        ctx.lineTo(cx + half, stemEnd);
        ctx.lineTo(cx, stemEnd + h);
        ctx.closePath();
      }
      ctx.stroke();
    });
  },
};

const washingMachine: SymbolDef = {
  type: "washing-machine",
  label: "Washing machine",
  category: "water",
  wallMounted: true,
  width: 600,
  depth: 600,
  ports: [
      { key: "water:koud", required: true },
      { key: "water:afvoer", required: true, v: 0.5 },
    ],
  draw(ctx) {
    withCtx(ctx, () => {
      // Wasmachine: the drum seen through the door, centre marked.
      applianceBox(ctx, 600, 600);
      circle(ctx, 0, 330, 200);
      ctx.stroke();
      dot(ctx, 0, 330, 60);
    });
  },
};

const dryer: SymbolDef = {
  type: "dryer",
  label: "Dryer",
  category: "water",
  wallMounted: true,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // Wasdroger: two small marks over one large one. The sizes carry the
      // distinction from the washing machine, because an export replays fills
      // as outlines (see io/record.ts).
      applianceBox(ctx, 600, 600);
      circle(ctx, -105, 230, 85);
      circle(ctx, 105, 230, 85);
      ctx.stroke();
      dot(ctx, 0, 425, 125);
    });
  },
};

const dishwasher: SymbolDef = {
  type: "dishwasher",
  label: "Dishwasher",
  category: "water",
  wallMounted: true,
  width: 600,
  depth: 600,
  ports: [
      { key: "water:koud", required: true },
      { key: "water:afvoer", required: true, v: 0.5 },
    ],
  draw(ctx) {
    withCtx(ctx, () => {
      // Vaatwasser: both diagonals with the spray arm at their crossing.
      applianceBox(ctx, 600, 600);
      ctx.moveTo(-300, 0);
      ctx.lineTo(300, 600);
      ctx.moveTo(300, 0);
      ctx.lineTo(-300, 600);
      circle(ctx, 0, 300, 130);
      ctx.stroke();
    });
  },
};

const boiler: SymbolDef = {
  type: "boiler",
  label: "Boiler",
  category: "water",
  wallMounted: true,
  width: 500,
  depth: 500,
  ports: [{ key: "water:koud", required: true }, { key: "water:warm" }],
  draw(ctx) {
    withCtx(ctx, () => {
      const cy = 250;
      ctx.moveTo(230, cy);
      ctx.arc(0, cy, 230, 0, Math.PI * 2);
      // small inner triangle, apex up, centred at (0, cy)
      const side = 140;
      const h = (side * Math.sqrt(3)) / 2;
      const half = side / 2;
      const apexY = cy - (2 * h) / 3;
      const baseY = cy + h / 3;
      ctx.moveTo(0, apexY);
      ctx.lineTo(half, baseY);
      ctx.lineTo(-half, baseY);
      ctx.closePath();
      ctx.stroke();
    });
  },
};

const waterMeter: SymbolDef = {
  type: "water-meter",
  label: "Water meter",
  category: "water",
  wallMounted: true,
  width: 300,
  depth: 220,
  ports: [{ key: "water:koud", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-150, 0, 300, 220);
      // inner circle (dial) with a needle line from centre to its edge at 45deg
      ctx.moveTo(80, 110);
      ctx.arc(0, 110, 80, 0, Math.PI * 2);
      const a = Math.PI / 4;
      ctx.moveTo(0, 110);
      ctx.lineTo(80 * Math.cos(a), 110 + 80 * Math.sin(a));
      ctx.stroke();
    });
  },
};

const floorDrain: SymbolDef = {
  type: "floor-drain",
  label: "Floor drain",
  category: "water",
  wallMounted: false,
  width: 240,
  depth: 240,
  ports: [{ key: "water:afvoer", required: true }],
  mountHeight: 0,
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.moveTo(110, 0);
      ctx.arc(0, 0, 110, 0, Math.PI * 2);
      ctx.moveTo(-110, -40);
      ctx.lineTo(110, -40);
      ctx.moveTo(-110, 40);
      ctx.lineTo(110, 40);
      ctx.stroke();
    });
  },
};

const wastePoint: SymbolDef = {
  type: "waste-point",
  label: "Waste connection",
  category: "water",
  wallMounted: false,
  width: 240,
  depth: 240,
  ports: [{ key: "water:afvoer", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      // Afvoeraansluitpunt: the waste stub where it comes up through the
      // floor, drawn as the pipe run terminating in its riser. The nominal
      // diameter is not part of the mark and belongs in the drawing's notes.
      circle(ctx, 0, 0, 90);
      ctx.moveTo(0, 90);
      ctx.lineTo(0, 200);
      ctx.stroke();
    });
  },
};

const gasPoint: SymbolDef = {
  type: "gas-point",
  label: "Gas connection",
  category: "water",
  wallMounted: true,
  width: 260,
  depth: 300,
  ports: [{ key: "gas", required: true }],
  draw(ctx) {
    withCtx(ctx, () => {
      // Gasaansluitpunt: the stem and crossbar of the connection-point family,
      // ending in the circle that carries the service letter.
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 100);
      ctx.moveTo(-120, 100);
      ctx.lineTo(120, 100);
      circle(ctx, 0, 200, 100);
      ctx.stroke();
      code(ctx, "G", 0, 200, 120);
    });
  },
};

export const SYMBOLS_WATER: SymbolDef[] = [
  waterPoint,
  waterPointHot,
  waterPointFloor,
  waterPointFloorHot,
  mixerTap,
  washingMachine,
  dryer,
  dishwasher,
  boiler,
  waterMeter,
  floorDrain,
  wastePoint,
  gasPoint,
];
