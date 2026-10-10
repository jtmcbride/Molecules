/** Upper-case element symbols, matching Mol*'s ElementSymbol normalization ("Zn" → "ZN"). */
export function normalizeElement(symbol: string): string {
  return symbol.trim().toUpperCase();
}
const HYDROGEN_ISOTOPES = new Set(["H", "D", "T"]);
/** Hydrogen, deuterium or tritium by element symbol, independent of letter case. */
export function isHydrogenElement(symbol: string): boolean {
  return HYDROGEN_ISOTOPES.has(normalizeElement(symbol));
}
