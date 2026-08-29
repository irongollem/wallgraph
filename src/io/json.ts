// Persistence: guarded browser-storage autosave + JSON export/import.
// File downloads are sandboxed away in some hosted contexts, so clipboard
// copy/paste of the document JSON is always offered as a fallback.
import { PlanDoc } from "../model/doc";
import { saveViaHost, downloadBlob } from "./save";

const KEY = "floorplan-doc-v1";

export function tryLoadAutosave(): PlanDoc | null {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const doc = JSON.parse(s) as PlanDoc;
    if (doc.version !== 1 || !Array.isArray(doc.floors)) return null;
    return doc;
  } catch { return null; }
}

let saveTimer: number | undefined;
export function scheduleAutosave(doc: PlanDoc): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch { /* storage unavailable */ }
  }, 400);
}

export function clearAutosave(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export async function exportJson(doc: PlanDoc): Promise<void> {
  const json = JSON.stringify(doc, null, 2);
  if (await saveViaHost("floorplan.json", () => json)) return;
  downloadBlob("floorplan.json", new Blob([json], { type: "application/json" }));
  // Deliberately unconditional: a sandboxed frame swallows the download click
  // without throwing, and the clipboard is the one channel that always works.
  void copyJson(doc);
}

export async function copyJson(doc: PlanDoc): Promise<boolean> {
  try { await navigator.clipboard.writeText(JSON.stringify(doc)); return true; }
  catch { return false; }
}

export function parseDoc(text: string): PlanDoc | null {
  try {
    const doc = JSON.parse(text) as PlanDoc;
    if (doc.version !== 1 || !Array.isArray(doc.floors) || !doc.floors[0]) return null;
    return doc;
  } catch { return null; }
}

export function importJsonFile(onLoad: (doc: PlanDoc) => void, onError?: () => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then(t => {
      const doc = parseDoc(t);
      if (doc) onLoad(doc);
      else onError?.();
    });
  };
  input.click();
}
