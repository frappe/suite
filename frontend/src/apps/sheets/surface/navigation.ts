import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";

export type DocumentSaveState = "clean" | "saving" | "unsaved" | "failed";

interface LeaveGuardOptions {
  state: () => DocumentSaveState;
  flush: () => Promise<void>;
  retainRecovery: () => void | Promise<void>;
}

export async function resolveDocumentLeave(options: LeaveGuardOptions): Promise<boolean> {
  if (options.state() === "clean") return true;
  if (options.state() === "saving") await options.flush();
  if (options.state() === "clean") return true;
  await options.retainRecovery();
  return window.confirm("Your latest changes are kept as a recovery copy. Leave this spreadsheet?");
}

export function useDocumentLeaveGuard(options: LeaveGuardOptions): void {
  const guard = () => resolveDocumentLeave(options);
  onBeforeRouteLeave(guard);
  onBeforeRouteUpdate((to, from) =>
    to.params.node === from.params.node ? true : guard(),
  );
}
