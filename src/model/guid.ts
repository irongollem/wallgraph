// IFC GlobalId derivation and document GUID seeding. See PlanDoc.guid in doc.ts:
// an IFC GlobalId is derived from that seed plus each element's own id, so a
// re-export keeps every element's identity and two documents' ids cannot collide.

/**
 * IFC's base-64 alphabet for GlobalId compression, per the IFC spec (ISO
 * 10303-21 style encoding, not standard base64): digits, then uppercase, then
 * lowercase, then '_' and '$'. 64 characters, so each carries exactly 6 bits.
 */
const IFC_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

const FNV_PRIME = 0x01000193;

/**
 * Four distinct 32-bit constants used as FNV-1a offset bases, one per pass.
 * Independent passes over the same input decorrelate their outputs; any four
 * well-mixed 32-bit constants work; these are the standard FNV offset basis
 * plus three widely used hash-mixing constants (golden-ratio and murmur3
 * finalizer multipliers), reused here only for their bit distribution.
 */
const OFFSET_BASES: readonly number[] = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];

/** One FNV-1a 32-bit pass over `input`, seeded with `offsetBasis`. */
function fnv1a32(input: string, offsetBasis: number): number {
  let h = offsetBasis >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/**
 * A deterministic 22-character IFC GlobalId for `${seed}:${id}`.
 *
 * This is an identity hash, not cryptography: it exists so the same element
 * gets the same GlobalId on every re-export, and so two unrelated documents
 * (different `seed`) practically never collide, not to resist a deliberate
 * attempt to produce a collision. Four independent 32-bit FNV-1a passes give
 * 128 bits, encoded in IFC's base-64 alphabet: the first character carries
 * only the top 2 bits (so it is always '0'..'3', as the IFC spec requires),
 * and the remaining 126 bits fill 21 six-bit characters.
 */
export function ifcGuid(seed: string, id: string): string {
  const input = `${seed}:${id}`;
  const words = OFFSET_BASES.map(basis => BigInt(fnv1a32(input, basis)));
  let bits = 0n;
  for (const w of words) bits = (bits << 32n) | w;

  const chars: string[] = [IFC_ALPHABET[Number((bits >> 126n) & 0x3n)]!];
  for (let i = 0; i < 21; i++) {
    const shift = BigInt(120 - i * 6);
    chars.push(IFC_ALPHABET[Number((bits >> shift) & 0x3fn)]!);
  }
  return chars.join("");
}

/**
 * A fresh 32-character hex seed for `PlanDoc.guid`.
 *
 * `Math.random` is enough here: the seed only has to distinguish one
 * document's IFC GlobalIds from another's, not resist prediction, and the
 * browser tsconfig carries no node types (see tsconfig.json) so there is no
 * `crypto` module to reach for even if this needed to be unpredictable.
 */
export function newDocGuid(): string {
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}
