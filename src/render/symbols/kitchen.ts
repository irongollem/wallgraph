import { SymbolDef, withCtx } from "./defs";

export const SYMBOLS_KITCHEN: SymbolDef[] = [
  {
    type: "cooktop",
    label: "Cooktop",
    category: "kitchen",
    wallMounted: true,
    width: 600,
    depth: 600,
    draw(ctx) {
      withCtx(ctx, () => {
        // Outer square
        ctx.rect(-300, 0, 600, 600);
        ctx.stroke();

        // Four burner circles at r=90
        const burners: [number, number][] = [
          [-150, 150],
          [150, 150],
          [-150, 450],
          [150, 450],
        ];
        for (const [x, y] of burners) {
          ctx.beginPath();
          ctx.arc(x, y, 90, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    },
  },
  {
    type: "oven",
    label: "Oven",
    category: "kitchen",
    wallMounted: true,
    width: 600,
    depth: 600,
    draw(ctx) {
      withCtx(ctx, () => {
        // Outer square
        ctx.rect(-300, 0, 600, 600);
        ctx.stroke();

        // Inner rectangle (inset 70 on all sides)
        ctx.rect(-230, 70, 460, 460);
        ctx.stroke();

        // Handle line (200mm horizontal at y=140, centered)
        ctx.beginPath();
        ctx.moveTo(-100, 140);
        ctx.lineTo(100, 140);
        ctx.stroke();
      });
    },
  },
  {
    type: "fridge",
    label: "Fridge",
    category: "kitchen",
    wallMounted: true,
    width: 600,
    depth: 600,
    draw(ctx) {
      withCtx(ctx, () => {
        // Outer square
        ctx.rect(-300, 0, 600, 600);
        ctx.stroke();

        // One diagonal
        ctx.beginPath();
        ctx.moveTo(-300, 0);
        ctx.lineTo(300, 600);
        ctx.stroke();
      });
    },
  },
  {
    type: "freezer",
    label: "Freezer",
    category: "kitchen",
    wallMounted: true,
    width: 600,
    depth: 600,
    draw(ctx) {
      withCtx(ctx, () => {
        // Outer square
        ctx.rect(-300, 0, 600, 600);
        ctx.stroke();

        // Both diagonals (X)
        ctx.beginPath();
        ctx.moveTo(-300, 0);
        ctx.lineTo(300, 600);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(300, 0);
        ctx.lineTo(-300, 600);
        ctx.stroke();
      });
    },
  },
  {
    type: "kitchen-sink",
    label: "Kitchen sink",
    category: "kitchen",
    wallMounted: true,
    width: 800,
    depth: 500,
    draw(ctx) {
      withCtx(ctx, () => {
        // Outer rectangle
        ctx.rect(-400, 0, 800, 500);
        ctx.stroke();

        // Inner basin rectangle (320×340 centered at (-160, 250))
        ctx.rect(-320, 80, 320, 340);
        ctx.stroke();

        // Drainer: 5 short vertical lines on right half
        // Centered around x=220, spacing 55, length 260
        const drainerX = [110, 165, 220, 275, 330];
        for (const x of drainerX) {
          ctx.beginPath();
          ctx.moveTo(x, 120);
          ctx.lineTo(x, 380);
          ctx.stroke();
        }
      });
    },
  },
  {
    type: "extractor-hood",
    label: "Extractor hood",
    category: "kitchen",
    wallMounted: true,
    width: 600,
    depth: 500,
    draw(ctx) {
      withCtx(ctx, () => {
        // Outer rectangle
        ctx.rect(-300, 0, 600, 500);
        ctx.stroke();

        // Inner circle r=140 at (0, 250)
        ctx.beginPath();
        ctx.arc(0, 250, 140, 0, Math.PI * 2);
        ctx.stroke();

        // X inside circle (45° and 135° diagonals)
        // At 45°: from (-99, 151) to (99, 349)
        ctx.beginPath();
        ctx.moveTo(-99, 151);
        ctx.lineTo(99, 349);
        ctx.stroke();

        // At 135°: from (99, 151) to (-99, 349)
        ctx.beginPath();
        ctx.moveTo(99, 151);
        ctx.lineTo(-99, 349);
        ctx.stroke();
      });
    },
  },
];
