import { SymbolDef, withCtx, applianceBox, asterisk, circle, dot, wave } from "./defs";

// ---------------------------------------------------------------------------
// Kitchen. The appliances follow the standard's "toestel" form: the footprint
// box with a connection stub on the wall edge, plus the mark that names the
// appliance. See applianceBox() in ./defs.ts.
// ---------------------------------------------------------------------------

const appliance: SymbolDef = {
  type: "appliance",
  label: "Fixed appliance",
  category: "kitchen",
  wallMounted: true,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // Toestel, vast, algemeen: the box and its stub, with no mark.
      applianceBox(ctx, 600, 600);
      ctx.stroke();
    });
  },
};

const cooktop: SymbolDef = {
  type: "cooktop",
  label: "Cooktop",
  category: "kitchen",
  wallMounted: true,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // Fornuis: three filled burner marks, one back, two front.
      applianceBox(ctx, 600, 600);
      ctx.stroke();
      dot(ctx, 120, 210, 65);
      dot(ctx, -120, 400, 65);
      dot(ctx, 120, 400, 65);
    });
  },
};

const oven: SymbolDef = {
  type: "oven",
  label: "Oven",
  category: "kitchen",
  wallMounted: true,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // Oven (elektrisch): the box divided off along the wall edge, one filled
      // mark in the cavity.
      applianceBox(ctx, 600, 600);
      ctx.moveTo(-300, 180);
      ctx.lineTo(300, 180);
      ctx.stroke();
      dot(ctx, 0, 390, 75);
    });
  },
};

const microwave: SymbolDef = {
  type: "microwave",
  label: "Microwave",
  category: "kitchen",
  wallMounted: true,
  width: 550,
  depth: 400,
  draw(ctx) {
    withCtx(ctx, () => {
      // Magnetron: two waves.
      applianceBox(ctx, 550, 400);
      wave(ctx, 0, 160, 300, 2, 55);
      wave(ctx, 0, 260, 300, 2, 55);
      ctx.stroke();
    });
  },
};

const fridge: SymbolDef = {
  type: "fridge",
  label: "Fridge",
  category: "kitchen",
  wallMounted: true,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // Koelkast: one asterisk.
      applianceBox(ctx, 600, 600);
      asterisk(ctx, 0, 300, 120);
      ctx.stroke();
    });
  },
};

const freezer: SymbolDef = {
  type: "freezer",
  label: "Freezer",
  category: "kitchen",
  wallMounted: true,
  width: 600,
  depth: 600,
  draw(ctx) {
    withCtx(ctx, () => {
      // Vriezer: three asterisks. The count is what separates it from the
      // fridge, so the row is drawn small enough to stay three marks.
      applianceBox(ctx, 600, 600);
      for (const x of [-170, 0, 170]) asterisk(ctx, x, 300, 75);
      ctx.stroke();
    });
  },
};

const kitchenSink: SymbolDef = {
  type: "kitchen-sink",
  label: "Kitchen sink",
  category: "kitchen",
  wallMounted: true,
  width: 800,
  depth: 500,
  draw(ctx) {
    withCtx(ctx, () => {
      // Aanrecht: basin with its drain, plus the drainer grooves.
      ctx.rect(-400, 0, 800, 500);
      ctx.rect(-320, 80, 320, 340);
      for (const x of [110, 165, 220, 275, 330]) {
        ctx.moveTo(x, 120);
        ctx.lineTo(x, 380);
      }
      ctx.stroke();
      dot(ctx, -160, 250, 30);
    });
  },
};

const extractorHood: SymbolDef = {
  type: "extractor-hood",
  label: "Extractor hood",
  category: "kitchen",
  wallMounted: true,
  width: 600,
  depth: 500,
  draw(ctx) {
    withCtx(ctx, () => {
      // Afzuigkap: the outline with the extract point marked.
      ctx.rect(-300, 0, 600, 500);
      circle(ctx, 0, 250, 140);
      ctx.moveTo(-99, 151);
      ctx.lineTo(99, 349);
      ctx.moveTo(99, 151);
      ctx.lineTo(-99, 349);
      ctx.stroke();
    });
  },
};

export const SYMBOLS_KITCHEN: SymbolDef[] = [
  appliance,
  cooktop,
  oven,
  microwave,
  fridge,
  freezer,
  kitchenSink,
  extractorHood,
];
