export interface PaletteRecent {
  kind: "entity";
  id: string;
  label: string;
  href?: string;
  icon?: string;
  driveEntity?: Record<string, unknown>;
}

const storageKey = "suite-palette-recents";
const limit = 5;

export function readPaletteRecents(): PaletteRecent[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item) => item?.kind === "entity").slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

export function rememberPaletteRecent(recent: PaletteRecent) {
  const recents = [
    recent,
    ...readPaletteRecents().filter((item) => item.id !== recent.id),
  ].slice(0, limit);
  localStorage.setItem(storageKey, JSON.stringify(recents));
  return recents;
}
