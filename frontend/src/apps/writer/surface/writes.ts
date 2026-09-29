import { computed, reactive, ref, toRefs, watch, type Ref } from "vue";

import type { DocumentSession } from "@/apps/drive";

const EDIT = 40;
/** The highest Drive role below EDIT. A refused write proves no more than this. */
const BELOW_EDIT = 30;
const REFUSALS = new Set(["PermissionError", "DriveForbidden", "DriveNotFound"]);

/** One `useDoc` document method, as the editor calls it. */
export interface DocumentWrite {
  readonly loading: boolean;
  readonly error: unknown;
  submit(params?: object): Promise<unknown>;
}

export interface WriteGate {
  /** The session's Drive role, lowered to below EDIT once the server refuses a write. */
  readonly role: Readonly<Ref<number>>;
  /** True while this document takes writes: it is Active and the role is EDIT or more. */
  readonly writable: Readonly<Ref<boolean>>;
  /**
   * The same document with each named write passed through the gate.
   *
   * While the gate is shut, a write resolves to `null` and sends nothing. So a
   * debounced autosave, the save on unmount, the automatic version and a
   * settings change that were pending when access narrowed are cancelled.
   */
  guard<D extends object>(document: D, writes: readonly (keyof D & string)[]): D;
}

/**
 * Hold a Writer document's writes to the access Drive grants.
 *
 * Writer collaboration is peer to peer, so no server tells the editor that
 * access changed. The verdict comes from two places: the session's access
 * refresh, and a write the server refuses. A refusal is not lifted by a later
 * refresh; it holds until the document is opened again.
 *
 * `onClose` runs once each time the gate shuts, before any write it refuses.
 */
export function createWriteGate(
  session: Pick<DocumentSession, "state" | "access" | "refreshAccess">,
  onClose: () => void,
): WriteGate {
  const verdict = ref<number | null>(null);
  const role = computed(() => {
    const granted = session.access.value.role ?? 0;
    return verdict.value === null ? granted : Math.min(granted, verdict.value);
  });
  const writable = computed(() => session.state.value === "Active" && role.value >= EDIT);

  watch(writable, (open, wasOpen) => {
    if (wasOpen && !open) onClose();
  }, { flush: "sync" });

  function refuse(): void {
    verdict.value = Math.min(verdict.value ?? BELOW_EDIT, BELOW_EDIT);
    void session.refreshAccess();
  }

  function gated(write: DocumentWrite): DocumentWrite {
    return {
      get loading() {
        return write.loading;
      },
      get error() {
        return write.error;
      },
      async submit(params) {
        if (!writable.value) return null;
        try {
          return await write.submit(params);
        } catch (error) {
          if (isRefusal(error)) refuse();
          throw error;
        }
      },
    };
  }

  function guard<D extends object>(document: D, writes: readonly (keyof D & string)[]): D {
    const replaced: Partial<Record<string, DocumentWrite>> = {};
    for (const key of writes) replaced[key] = gated(document[key] as DocumentWrite);
    return reactive({ ...toRefs(document), ...replaced }) as D;
  }

  return { role, writable, guard };
}

function isRefusal(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { type, status } = error as { type?: unknown; status?: unknown };
  return (typeof type === "string" && REFUSALS.has(type)) || status === 401 || status === 403;
}
