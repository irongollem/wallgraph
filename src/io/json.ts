// Persistence: guarded browser-storage autosave + JSON export/import.
// File downloads are sandboxed away in some hosted contexts, so clipboard
// copy/paste of the document JSON is always offered as a fallback.
import { PlanDoc } from "../model/doc";

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

// In the hosted-artifact runtime the page saves through the platform's
// downloads capability (viewer sees a confirmation); elsewhere a plain
// download link works. Clipboard copy is the universal fallback.
type ClaudeUse = { use(name: string): Promise<{ save(r: { filename: string; data: string }): Promise<unknown> } | null> };

export async function exportJson(doc: PlanDoc): Promise<void> {
  const json = JSON.stringify(doc, null, 2);
  const claude = (window as unknown as { claude?: ClaudeUse }).claude;
  if (claude?.use) {
    try {
      const downloads = await claude.use("downloads");
      if (downloads) {
        await downloads.save({ filename: "floorplan.json", data: json });
        return;
      }
    } catch { /* declined or unavailable -> fall through */ }
  }
  try {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "floorplan.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch { /* fall through to clipboard */ }
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
