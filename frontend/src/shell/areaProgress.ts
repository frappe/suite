import { inject, type InjectionKey } from "vue";

import { translate as __ } from "@/platform/translation";

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

/** The state in words, with no percentage: it changes only when the state does. */
export function progressState(progress: AreaProgress | null): string {
  if (!progress) return "";
  if (progress.attention) return __("Needs attention");
  if (progress.tone === "paused") return __("Paused");
  if (progress.tone === "done") return __("Done");
  return progress.fraction == null ? "" : __("In progress");
}

/** The state with its percentage, for a tooltip. */
export function progressDetail(progress: AreaProgress | null): string | undefined {
  if (!progress) return undefined;
  if (progress.tone === "running" && !progress.attention && progress.fraction != null) {
    return __("{0}% done", [Math.round(progress.fraction * 100)]);
  }
  return progressState(progress) || undefined;
}
