import { onBeforeRouteLeave, onBeforeRouteUpdate } from "vue-router";

export type DocumentSaveState = "clean" | "saving" | "unsaved" | "failed";

export interface LeaveGuardOptions {
  state: () => DocumentSaveState;
  flush: () => Promise<void>;
  retainRecovery: () => unknown;
  confirmLeave?: () => boolean;
}

export async function resolveDocumentLeave(options: LeaveGuardOptions): Promise<boolean> {
  if (options.state() === "clean") return true;
  if (options.state() === "saving") await options.flush();
  if (options.state() === "clean") return true;
  await options.retainRecovery();
  return (options.confirmLeave ?? defaultConfirmation)();
}

// A closing tab can't wait for a save, so it keeps a recovery copy and asks the browser to confirm
export function resolveDocumentUnload(
  options: Pick<LeaveGuardOptions, "state" | "retainRecovery">,
  event: Event,
): void {
  if (options.state() === "clean") return;
  event.preventDefault();
  void options.retainRecovery();
}

export function useDocumentLeaveGuard(options: LeaveGuardOptions): void {
  const guard = () => resolveDocumentLeave(options);
  onBeforeRouteLeave(guard);
  onBeforeRouteUpdate((to, from) =>
    to.params.node === from.params.node ? true : guard(),
  );
}

function defaultConfirmation(): boolean {
  return window.confirm("Your latest changes are kept as a recovery copy. Leave this document?");
}
