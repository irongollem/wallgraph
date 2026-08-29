// Getting a file to the user, in one place.
//
// Two channels, neither guaranteed: the hosted runtime's downloads capability
// (present in sandboxed embeds, string payload only) and an ordinary blob link.
// A sandboxed iframe ignores a download click *without throwing*, so a `true`
// here means "nothing went wrong", not "the user has the file" — callers keep
// their own last-resort fallback (clipboard, or telling the user).
type ClaudeUse = { use(name: string): Promise<{ save(r: { filename: string; data: string }): Promise<unknown> } | null> };

/**
 * Save through the hosted downloads capability. `data` is a thunk because
 * serialising a payload (a multi-megabyte PNG data URL, say) is wasted work
 * when the capability isn't there — which is the common case.
 */
export async function saveViaHost(filename: string, data: () => string | Promise<string>): Promise<boolean> {
  const claude = (window as unknown as { claude?: ClaudeUse }).claude;
  if (!claude?.use) return false;
  try {
    const downloads = await claude.use("downloads");
    if (!downloads) return false;
    await downloads.save({ filename, data: await data() });
    return true;
  } catch { return false; }
}

/** Ordinary download link. False only when it throws outright. */
export function downloadBlob(filename: string, blob: Blob): boolean {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return true;
  } catch { return false; }
}
