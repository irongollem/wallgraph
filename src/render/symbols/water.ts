import { SymbolDef, withCtx } from "./defs";

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

const mixerTap: SymbolDef = {
  type: "mixer-tap",
  label: "Mixer tap",
  category: "water",
  wallMounted: true,
  width: 340,
  depth: 260,
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
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-300, 0, 600, 600);
      ctx.moveTo(200, 330);
      ctx.arc(0, 330, 200, 0, Math.PI * 2);
      ctx.stroke();
      // small filled dot at the drum centre
      ctx.beginPath();
      ctx.arc(0, 330, 12, 0, Math.PI * 2);
      ctx.fill();
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
      // Square footprint plus two concentric drum circles.
      ctx.rect(-300, 0, 600, 600);
      ctx.moveTo(200, 330);
      ctx.arc(0, 330, 200, 0, Math.PI * 2);
      ctx.moveTo(120, 330);
      ctx.arc(0, 330, 120, 0, Math.PI * 2);
      ctx.stroke();
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
  draw(ctx) {
    withCtx(ctx, () => {
      ctx.rect(-300, 0, 600, 600);
      ctx.moveTo(-300, 0);
      ctx.lineTo(300, 600);
      ctx.moveTo(-100, 300);
      ctx.lineTo(100, 300);
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

export const SYMBOLS_WATER: SymbolDef[] = [
  waterPoint,
  waterPointHot,
  mixerTap,
  washingMachine,
  dryer,
  dishwasher,
  boiler,
  waterMeter,
  floorDrain,
];
