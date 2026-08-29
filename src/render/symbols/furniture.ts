import { SymbolDef, withCtx } from "./defs";

// Helper to draw a rounded rectangle
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.stroke();
}

export const SYMBOLS_FURNITURE: SymbolDef[] = [
  {
    type: "bed-single",
    label: "Single bed",
    category: "furniture",
    wallMounted: false,
    width: 900,
    depth: 2000,
    draw(ctx) {
      withCtx(ctx, () => {
        // Main bed rectangle
        ctx.rect(-450, -1000, 900, 2000);
        ctx.stroke();

        // Pillow rectangle (700×350 at y: -940..-590)
        ctx.rect(-350, -940, 700, 350);
        ctx.stroke();

        // Blanket line at y=-400
        ctx.beginPath();
        ctx.moveTo(-450, -400);
        ctx.lineTo(450, -400);
        ctx.stroke();
      });
    },
  },
  {
    type: "bed-double",
    label: "Double bed",
    category: "furniture",
    wallMounted: false,
    width: 1600,
    depth: 2000,
    draw(ctx) {
      withCtx(ctx, () => {
        // Main bed rectangle
        ctx.rect(-800, -1000, 1600, 2000);
        ctx.stroke();

        // Left pillow (640×350 centered at (-390, -765))
        ctx.rect(-710, -940, 640, 350);
        ctx.stroke();

        // Right pillow (640×350 centered at (390, -765))
        ctx.rect(70, -940, 640, 350);
        ctx.stroke();

        // Blanket line at y=-400
        ctx.beginPath();
        ctx.moveTo(-800, -400);
        ctx.lineTo(800, -400);
        ctx.stroke();

        // Center line from y=-400 to y=1000
        ctx.beginPath();
        ctx.moveTo(0, -400);
        ctx.lineTo(0, 1000);
        ctx.stroke();
      });
    },
  },
  {
    type: "sofa",
    label: "Sofa",
    category: "furniture",
    wallMounted: false,
    width: 2000,
    depth: 900,
    draw(ctx) {
      withCtx(ctx, () => {
        // Rounded rectangle (2000×900, radius 120)
        drawRoundedRect(ctx, -1000, -450, 2000, 900, 120);

        // Backrest line at y=-250
        ctx.beginPath();
        ctx.moveTo(-870, -250);
        ctx.lineTo(870, -250);
        ctx.stroke();

        // Armrest lines at x=±800
        ctx.beginPath();
        ctx.moveTo(-800, -250);
        ctx.lineTo(-800, 430);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(800, -250);
        ctx.lineTo(800, 430);
        ctx.stroke();
      });
    },
  },
  {
    type: "armchair",
    label: "Armchair",
    category: "furniture",
    wallMounted: false,
    width: 900,
    depth: 850,
    draw(ctx) {
      withCtx(ctx, () => {
        // Rounded rectangle (900×850, radius 100)
        drawRoundedRect(ctx, -450, -425, 900, 850, 100);

        // Backrest line at y=-220
        ctx.beginPath();
        ctx.moveTo(-370, -220);
        ctx.lineTo(370, -220);
        ctx.stroke();

        // Armrest lines at x=±370
        ctx.beginPath();
        ctx.moveTo(-370, -220);
        ctx.lineTo(-370, 400);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(370, -220);
        ctx.lineTo(370, 400);
        ctx.stroke();
      });
    },
  },
  {
    type: "table-rect",
    label: "Table",
    category: "furniture",
    wallMounted: false,
    width: 1600,
    depth: 900,
    draw(ctx) {
      withCtx(ctx, () => {
        // Rectangle 1600×900
        ctx.rect(-800, -450, 1600, 900);
        ctx.stroke();
      });
    },
  },
  {
    type: "table-round",
    label: "Round table",
    category: "furniture",
    wallMounted: false,
    width: 1200,
    depth: 1200,
    draw(ctx) {
      withCtx(ctx, () => {
        // Circle r=600
        ctx.beginPath();
        ctx.arc(0, 0, 600, 0, Math.PI * 2);
        ctx.stroke();
      });
    },
  },
  {
    type: "wardrobe",
    label: "Wardrobe",
    category: "furniture",
    wallMounted: false,
    width: 1200,
    depth: 600,
    draw(ctx) {
      withCtx(ctx, () => {
        // Rectangle 1200×600
        ctx.rect(-600, -300, 1200, 600);
        ctx.stroke();

        // Center line (door split)
        ctx.beginPath();
        ctx.moveTo(0, -300);
        ctx.lineTo(0, 300);
        ctx.stroke();

        // Handles: 12mm filled dots at (-40, 0) and (40, 0)
        ctx.beginPath();
        ctx.arc(-40, 0, 12, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(40, 0, 12, 0, Math.PI * 2);
        ctx.fill();
      });
    },
  },
  {
    type: "desk",
    label: "Desk",
    category: "furniture",
    wallMounted: false,
    width: 1400,
    depth: 700,
    draw(ctx) {
      withCtx(ctx, () => {
        // Outer rectangle 1400×700
        ctx.rect(-700, -350, 1400, 700);
        ctx.stroke();

        // Inner rectangle (drawer block): 500×400 centered at (300, 0)
        ctx.rect(50, -200, 500, 400);
        ctx.stroke();
      });
    },
  },
];
