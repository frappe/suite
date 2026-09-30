import { inject, type InjectionKey } from "vue";

/**
 * Work an area runs in the background, shown on its rail and bottom-nav item.
 * Drive's upload queue is the one source today (spec §6.3).
 */
export interface AreaProgress {
  /** Done over total, 0 to 1. `null` draws no ring. */
  fraction: number | null;
  /** `paused` draws the ring amber. `done` draws it full, then it fades. */
  tone: "running" | "paused" | "done";
  /** A red dot: work failed or stopped, and the user has not looked yet. */
  attention: boolean;
}

export interface AreaProgressSource {
  /** The indicator of one area, or `null` when it shows none. Reactive. */
  progress(area: string): AreaProgress | null;
  /** The user opened the area from its indicator. */
  open(area: string): void;
}

/** Composition provides it at the app root. The shell reads it; products never do. */
export const AREA_PROGRESS_KEY: InjectionKey<AreaProgressSource> =
  Symbol("suite:area-progress");

export function useAreaProgress(): AreaProgressSource | null {
  return inject(AREA_PROGRESS_KEY, null);
}
