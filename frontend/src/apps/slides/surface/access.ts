import { computed, ref, watch, type Ref } from "vue";

import type { DocumentSession } from "@/apps/drive";

const READ = 10;
const COMMENT = 20;
const EDIT = 40;
/** The highest Drive role below EDIT. A refused write proves no more than this. */
const BELOW_EDIT = 30;

export interface SlidesAccess {
  /** False once Drive refuses READ: the surface unmounts the deck. */
  readonly readable: Readonly<Ref<boolean>>;
  /** True while the presentation is Active and the caller may comment. */
  readonly canComment: Readonly<Ref<boolean>>;
  /** True while the presentation is Active and the role is EDIT or more. */
  readonly writable: Readonly<Ref<boolean>>;
  /**
   * A write verdict: the server refused a save. Access narrows to read-only, and the
   * session asks Drive for the real role. The answer to that question does
   * not lift the verdict: it may predate the refusal. A later Drive answer
   * that grants EDIT lifts it.
   */
  refuse(): void;
}

export interface AccessChanges {
  /** Runs once each time edit access is lost, before the editor can queue another write. */
  narrowed?: () => void;
  /** Runs once each time edit access comes back after a loss. */
  widened?: () => void;
}

/**
 * The access a Slides surface acts on: Drive's grant, narrowed by any verdict.
 * A verdict may only narrow Drive access, never widen it.
 */
export function createSlidesAccess(
  session: Pick<DocumentSession, "state" | "access" | "refreshAccess">,
  { narrowed, widened }: AccessChanges,
): SlidesAccess {
  const verdict = ref<number | null>(null);
  const role = computed(() => {
    const granted = session.access.value.role ?? 0;
    return verdict.value === null ? granted : Math.min(granted, verdict.value);
  });
  const active = computed(() => session.state.value === "Active");
  const readable = computed(() => session.state.value !== "Refused" && role.value >= READ);
  const canComment = computed(() => active.value && role.value >= COMMENT);
  const writable = computed(() => active.value && role.value >= EDIT);

  watch(writable, (open) => (open ? widened?.() : narrowed?.()), { flush: "sync" });

  // The refresh the refusal asked for, while it is in flight.
  let asking: Promise<void> | null = null;
  watch(
    session.access,
    (answer) => {
      if (verdict.value !== null && !asking && (answer.role ?? 0) >= EDIT) verdict.value = null;
    },
    { flush: "sync" },
  );

  return {
    readable,
    canComment,
    writable,
    refuse() {
      verdict.value = BELOW_EDIT;
      const asked = session.refreshAccess();
      asking = asked;
      void asked.finally(() => {
        if (asking === asked) asking = null;
      });
    },
  };
}
