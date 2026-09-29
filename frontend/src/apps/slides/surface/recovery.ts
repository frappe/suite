/**
 * Slides' local recovery copy: the deck's slides kept on this device when
 * unsaved work cannot reach the server. It is never replayed automatically.
 * The person takes it out as a JSON file. It is removed once downloaded, or
 * once the presentation saves again with edit access, because it is then stale.
 */
export interface RecoveryCopy {
  savedAt: string;
  /** The editor's slides, as it holds them. */
  slides: unknown[];
}

const key = (node: string) => `suite:slides-recovery:${node}`;

export function keepRecovery(node: string, slides: readonly unknown[], now = new Date()): RecoveryCopy {
  const copy = { savedAt: now.toISOString(), slides: [...slides] };
  localStorage.setItem(key(node), JSON.stringify(copy));
  return copy;
}

export function readRecovery(node: string): RecoveryCopy | null {
  try {
    const copy = JSON.parse(localStorage.getItem(key(node)) ?? "null") as Partial<RecoveryCopy> | null;
    return Array.isArray(copy?.slides) && typeof copy.savedAt === "string"
      ? { savedAt: copy.savedAt, slides: copy.slides }
      : null;
  } catch {
    return null;
  }
}

export function clearRecovery(node: string): void {
  localStorage.removeItem(key(node));
}

/** The copy as a JSON file, named after the presentation title. */
export function recoveryFile(copy: RecoveryCopy, title: string): File {
  const name = title.replace(/[<>:"/\\|?*]/g, "").trim() || "Presentation";
  const body = JSON.stringify({ title, recoveredAt: copy.savedAt, slides: copy.slides }, null, 2);
  return new File([body], `${name} (recovered).json`, { type: "application/json" });
}

/** Save the presentation's recovery copy through the browser, then remove it. False when none is kept. */
export function downloadRecovery(node: string, title: string): boolean {
  const copy = readRecovery(node);
  if (!copy) return false;
  const file = recoveryFile(copy, title);
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  clearRecovery(node);
  return true;
}
