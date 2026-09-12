import {
  computed,
  ref,
  shallowReactive,
  toValue,
  type MaybeRefOrGetter,
} from "vue";
import { defineStore } from "pinia";

export interface PaletteCommand {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  disabled?: boolean;
  run: (context?: {
    query: string;
    filters?: Record<string, string>;
  }) => void | Promise<void>;
}

export interface PaletteCommandGroup {
  commands: PaletteCommand[];
}

/**
 * Root suite store: cross-app UI state that the shell and every app share
 * (active app id, global theme, command-palette open state, etc.).
 *
 * Per-app stores live under src/apps/<app>/stores/ and are namespaced; this
 * root store only holds what the shell itself needs.
 */
export const useRootStore = defineStore("suite-root", () => {
  const theme = ref<"light" | "dark">("light");
  const paletteOpen = ref(false);
  const paletteRegistrations = shallowReactive(
    new Map<string, MaybeRefOrGetter<PaletteCommandGroup[]>>(),
  );
  const paletteGroups = computed(() =>
    [...paletteRegistrations.values()].flatMap((groups) => toValue(groups)),
  );

  function setTheme(next: "light" | "dark") {
    theme.value = next;
    document.documentElement.setAttribute("data-theme", next);
    document.documentElement.setAttribute("data-theme-mode", next);
  }

  function registerPaletteGroups(
    owner: string,
    groups: MaybeRefOrGetter<PaletteCommandGroup[]>,
  ) {
    paletteRegistrations.set(owner, groups);
    return () => {
      if (paletteRegistrations.get(owner) === groups)
        paletteRegistrations.delete(owner);
    };
  }

  return {
    theme,
    paletteOpen,
    paletteGroups,
    setTheme,
    registerPaletteGroups,
  };
});
