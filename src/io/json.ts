// Persistence: guarded browser-storage autosave + JSON export/import.
// File downloads are sandboxed away in some hosted contexts, so clipboard
// copy/paste of the document JSON is always offered as a fallback.
import { PlanDoc } from "../model/doc";
import { saveViaHost, downloadBlob } from "./save";

const KEY = "floorplan-doc-v1";

function readAutosave(s: string | null): PlanDoc | null {
  if (!s) return null;
  try {
    const doc = JSON.parse(s) as PlanDoc;
    if (doc.version !== 1 || !Array.isArray(doc.floors)) return null;
    return doc;
  } catch { return null; }
}

export function tryLoadAutosave(): PlanDoc | null {
  try {
    const s = localStorage.getItem(KEY);
    const doc = readAutosave(s);
    if (doc) lastWritten = s;
    return doc;
  } catch { return null; }
}

let saveTimer: number | undefined;
let pending: PlanDoc | null = null;
/** The stored string as this editor last wrote or read it; an identical write is skipped. */
let lastWritten: string | null = null;

/**
 * Writes the document after a 400 ms quiet period, so a drag does not
 * serialise the plan on every pointer move. `flushAutosave()` writes a pending
 * document at once; `watchAutosave()` calls it when the page is hidden or
 * unloaded, so an edit made just before a reload is not dropped with the timer.
 */
export function scheduleAutosave(doc: PlanDoc): void {
  pending = doc;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushAutosave, 400);
}

export function flushAutosave(): void {
  clearTimeout(saveTimer);
  const doc = pending;
  pending = null;
  if (!doc) return;
  // A floor's underlay (model/doc.ts) is the one field that can make this
  // write large enough to matter: localStorage is MB-order, and a document
  // carrying one or more downscaled-but-still-substantial data URLs can
  // exceed a quota that an ordinary plan never approaches. This catch is
  // what absorbs that -- a failed autosave loses nothing already on screen,
  // it just means the NEXT load falls back to the demo plan, the same as if
  // no autosave existed yet -- so it stays silent rather than growing a
  // dedicated failure path for a write nothing else depends on succeeding.
  try {
    const json = JSON.stringify(doc);
    if (json === lastWritten) return;
    localStorage.setItem(KEY, json);
    lastWritten = json;
  } catch { /* storage unavailable */ }
}

/**
 * Keeps the autosave current across page lifecycle and across tabs.
 *
 * Every editor on the origin shares one key, and each writes its whole
 * document on any change, a selection included. A second tab holding an older
 * copy of the plan would therefore overwrite the newer one on its next click,
 * and the next reload would restore the older plan. `onElsewhere` receives the
 * document another tab wrote, so this editor can adopt it before it writes
 * again; the pending write it replaces is dropped.
 */
export function watchAutosave(onElsewhere: (doc: PlanDoc) => void): void {
  window.addEventListener("pagehide", flushAutosave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAutosave();
  });
  window.addEventListener("storage", e => {
    // A null key is storage.clear().
    if (e.key !== KEY && e.key !== null) return;
    lastWritten = e.newValue;
    const doc = readAutosave(e.newValue);
    if (!doc) return;
    clearTimeout(saveTimer);
    pending = null;
    onElsewhere(doc);
  });
}

export function clearAutosave(): void {
  clearTimeout(saveTimer);
  pending = null;
  lastWritten = null;
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
