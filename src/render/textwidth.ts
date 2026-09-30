// Text metrics for the PDF core fonts (Helvetica), shared by the PDF writer and any
// layout that has to size text before it is drawn.

/**
 * Advances per 1000 units for codes 32..126, from the core Helvetica metrics.
 * A PDF reader supplies the glyphs; the writer only has to know how wide they
 * are, because PDF has no text anchoring -- centring a string means placing
 * its origin half a width back.
 */
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/**
 * An accented Latin letter carries its base letter's advance in these faces:
 * the glyph is that letter plus a mark, and the mark adds no width.
 */
const ACCENTED = "ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ";
const ACCENT_BASE = "AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy";

/** The punctuation a plan actually prints, regular and bold. */
const EXTRA: Record<string, [number, number]> = {
  "¹": [333, 333], "²": [333, 333], "³": [333, 333], "·": [278, 278], "°": [400, 400],
  "–": [556, 556], "—": [1000, 1000], "‘": [222, 238], "’": [222, 238],
  "“": [333, 500], "”": [333, 500], "•": [350, 350], "…": [1000, 1000], "€": [556, 556],
  "ß": [556, 611], "æ": [889, 889], "Æ": [1000, 1000], "ø": [611, 611], "Ø": [778, 778],
};

/** The commonest advance in both faces, for anything outside the tables. */
const W_DEFAULT = 556;

function advance(ch: string, bold: boolean): number {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REGULAR)[code - 32]!;
  const extra = EXTRA[ch];
  if (extra) return extra[bold ? 1 : 0];
  const i = ACCENTED.indexOf(ch);
  if (i >= 0) return advance(ACCENT_BASE[i]!, bold);
  return W_DEFAULT;
}

/**
 * The core fonts' WinAnsi encoding has no Greek letters, and the structural
 * figures are written with them (γ_M, k_def against σ). A letter the page
 * cannot draw is spelled out rather than printed as "?", which on a sheet an
 * engineer reads would lose which factor a figure is. Applied before a string
 * is measured and before it is written, so a wrapped line still fits.
 */
const GREEK: Record<string, string> = {
  "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon", "η": "eta",
  "θ": "theta", "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho",
  "σ": "sigma", "τ": "tau", "φ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
  "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Σ": "Sigma", "Φ": "Phi",
  "Ψ": "Psi", "Ω": "Omega",
};

export function pdfText(s: string): string {
  let out = "";
  for (const ch of s) out += GREEK[ch] ?? ch;
  return out;
}

/** Width of a string in em, so a caller multiplies by the font size. */
export function textWidth(s: string, bold: boolean): number {
  let w = 0;
  for (const ch of pdfText(s)) w += advance(ch, bold);
  return w / 1000;
}
