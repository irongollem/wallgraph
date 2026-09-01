// Which authoring pane owns the property area.
//
// Two places ask: the toolbar, deciding which palette to show, and renderProps,
// deciding whose rows to draw. They disagreed. `Tools.symbolType` is STICKY —
// it starts on a socket and keeps whatever was last placed — so testing it
// without also testing that the symbol tool is armed answers "services" for
// the whole session. The toolbar guarded on the tool; renderProps did not, and
// handed the property area to the route pane for every selection in the
// document: picking a wall showed "nieuwe leiding" and the wall's own rows
// were unreachable.
//
// So the question is asked once, here, where it can be tested without a DOM.
import { SECTION_OF, getSymbol, type SymbolSection } from "../render/symbols";
import type { ToolName } from "../input/tools";

/**
 * The section the armed SYMBOL belongs to, or null when a symbol is not what
 * is armed. Null is the whole point: a sticky type says nothing about what the
 * editor is doing once the tool has moved on.
 */
export function armedSection(tool: ToolName, symbolType: string): SymbolSection | null {
  if (tool !== "symbol") return null;
  const def = getSymbol(symbolType);
  return def ? SECTION_OF[def.category] : null;
}

/** The services pane owns the property area: the route tool, or its palette. */
export function servicesPaneActive(tool: ToolName, symbolType: string): boolean {
  return tool === "route" || armedSection(tool, symbolType) === "services";
}

/** The fit-out pane owns it: the furnishing tool, or the safety palette with it. */
export function fitoutPaneActive(tool: ToolName, symbolType: string): boolean {
  return tool === "furnishing" || armedSection(tool, symbolType) === "fitout";
}
