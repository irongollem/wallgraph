import { SymbolDef, withCtx } from "./defs";

// ---------------------------------------------------------------------------
// Sanitary
// ---------------------------------------------------------------------------

const toilet: SymbolDef = {
  type: "toilet",
  label: "Toilet",
  category: "sanitary",
  wallMounted: true,
  width: 400,
  depth: 650,
  draw(ctx) {
    withCtx(ctx, () => {
      // cistern against the wall
      ctx.rect(-200, 0, 400, 200);
      // bowl: ellipse centred at (0, 420), slightly narrower at the far end
      ctx.moveTo(180, 420);
      ctx.ellipse(0, 420, 180, 210, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const urinal: SymbolDef = {
  type: "urinal",
  label: "Urinal",
  category: "sanitary",
  wallMounted: true,
  width: 350,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      // outer bowl ellipse (300 wide x 220 tall) plus a smaller inner ellipse,
      // both centred at (0, 150).
      ctx.moveTo(150, 150);
      ctx.ellipse(0, 150, 150, 110, 0, 0, Math.PI * 2);
      ctx.moveTo(80, 150);
      ctx.ellipse(0, 150, 80, 55, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const bidet: SymbolDef = {
  type: "bidet",
  label: "Bidet",
  category: "sanitary",
  wallMounted: true,
  width: 360,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // flat rectangle against the wall, like a toilet without the cistern
      // shape, plus a bowl ellipse.
      ctx.rect(-180, 0, 360, 120);
      ctx.moveTo(160, 320);
      ctx.ellipse(0, 320, 160, 210, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const sink: SymbolDef = {
  type: "sink",
  label: "Sink",
  category: "sanitary",
  wallMounted: true,
  width: 500,
  depth: 450,
  draw(ctx) {
    withCtx(ctx, () => {
      // counter
      ctx.rect(-250, 0, 500, 450);
      // inner basin ellipse
      ctx.moveTo(190 + 0, 230);
      ctx.ellipse(0, 230, 190, 150, 0, 0, Math.PI * 2);
      // tap: two tiny circles near the wall edge and a short line
      ctx.moveTo(-25 + 12, 40);
      ctx.arc(-25, 40, 12, 0, Math.PI * 2);
      ctx.moveTo(25 + 12, 40);
      ctx.arc(25, 40, 12, 0, Math.PI * 2);
      ctx.moveTo(0, 40);
      ctx.lineTo(0, 90);
      ctx.stroke();
    });
  },
};

const sinkDouble: SymbolDef = {
  type: "sink-double",
  label: "Double sink",
  category: "sanitary",
  wallMounted: true,
  width: 900,
  depth: 450,
  draw(ctx) {
    withCtx(ctx, () => {
      // counter
      ctx.rect(-450, 0, 900, 450);
      // two inner basin ellipses
      ctx.moveTo(-220 + 170, 230);
      ctx.ellipse(-220, 230, 170, 140, 0, 0, Math.PI * 2);
      ctx.moveTo(220 + 170, 230);
      ctx.ellipse(220, 230, 170, 140, 0, 0, Math.PI * 2);
      ctx.stroke();
      // small filled tap position dots near the wall
      ctx.beginPath();
      ctx.arc(-220, 60, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(220, 60, 12, 0, Math.PI * 2);
      ctx.fill();
    });
  },
};

const handBasin: SymbolDef = {
  type: "hand-basin",
  label: "Hand basin",
  category: "sanitary",
  wallMounted: true,
  width: 350,
  depth: 300,
  draw(ctx) {
    withCtx(ctx, () => {
      // small counter with a single inner basin ellipse
      ctx.rect(-175, 0, 350, 300);
      ctx.moveTo(130, 160);
      ctx.ellipse(0, 160, 130, 100, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const bath: SymbolDef = {
  type: "bath",
  label: "Bathtub",
  category: "sanitary",
  wallMounted: true,
  width: 1700,
  depth: 750,
  draw(ctx) {
    withCtx(ctx, () => {
      // outer rectangle
      ctx.rect(-850, 0, 1700, 750);
      // inner rounded rectangle, inset 80mm, corner radius ~150
      const x0 = -850 + 80;
      const y0 = 0 + 80;
      const x1 = 850 - 80;
      const y1 = 750 - 80;
      const r = 150;
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(x1 - r, y0);
      ctx.arcTo(x1, y0, x1, y0 + r, r);
      ctx.lineTo(x1, y1 - r);
      ctx.arcTo(x1, y1, x1 - r, y1, r);
      ctx.lineTo(x0 + r, y1);
      ctx.arcTo(x0, y1, x0, y1 - r, r);
      ctx.lineTo(x0, y0 + r);
      ctx.arcTo(x0, y0, x0 + r, y0, r);
      ctx.closePath();
      // drain circle near one end
      ctx.moveTo(0 + 30, 150);
      ctx.arc(0, 150, 30, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const shower: SymbolDef = {
  type: "shower",
  label: "Shower",
  category: "sanitary",
  wallMounted: true,
  width: 900,
  depth: 900,
  draw(ctx) {
    withCtx(ctx, () => {
      // square footprint, anchor at wall midpoint so square spans y in [0, 900]
      ctx.rect(-450, 0, 900, 900);
      // both diagonals corner-to-corner
      ctx.moveTo(-450, 0);
      ctx.lineTo(450, 900);
      ctx.moveTo(450, 0);
      ctx.lineTo(-450, 900);
      // drain circle at centre
      ctx.moveTo(0 + 40, 450);
      ctx.arc(0, 450, 40, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

const showerTray: SymbolDef = {
  type: "shower-tray",
  label: "Shower tray 90×90",
  category: "sanitary",
  wallMounted: true,
  width: 900,
  depth: 900,
  draw(ctx) {
    withCtx(ctx, () => {
      // outer square
      ctx.rect(-450, 0, 900, 900);
      // inner rounded square, inset 60mm, corner radius 100
      const x0 = -450 + 60;
      const y0 = 0 + 60;
      const x1 = 450 - 60;
      const y1 = 900 - 60;
      const r = 100;
      ctx.moveTo(x0 + r, y0);
      ctx.lineTo(x1 - r, y0);
      ctx.arcTo(x1, y0, x1, y0 + r, r);
      ctx.lineTo(x1, y1 - r);
      ctx.arcTo(x1, y1, x1 - r, y1, r);
      ctx.lineTo(x0 + r, y1);
      ctx.arcTo(x0, y1, x0, y1 - r, r);
      ctx.lineTo(x0, y0 + r);
      ctx.arcTo(x0, y0, x0 + r, y0, r);
      ctx.closePath();
      // drain circle at centre
      ctx.moveTo(0 + 40, 450);
      ctx.arc(0, 450, 40, 0, Math.PI * 2);
      ctx.stroke();
    });
  },
};

export const SYMBOLS_SANITARY: SymbolDef[] = [
  toilet,
  urinal,
  bidet,
  sink,
  sinkDouble,
  handBasin,
  bath,
  shower,
  showerTray,
];
