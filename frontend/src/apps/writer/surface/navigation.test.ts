import { describe, expect, it, vi } from "vitest";

import { resolveDocumentLeave, type DocumentSaveState } from "./navigation";

describe("document leave decisions", () => {
  it("leaves a clean document without prompting", async () => {
    const confirmLeave = vi.fn(() => false);
    expect(await resolveDocumentLeave({
      state: () => "clean",
      flush: vi.fn(),
      retainRecovery: vi.fn(),
      confirmLeave,
    })).toBe(true);
    expect(confirmLeave).not.toHaveBeenCalled();
  });

  it("waits for an active save and leaves when the flush becomes clean", async () => {
    let state: DocumentSaveState = "saving";
    const flush = vi.fn(async () => { state = "clean"; });
    expect(await resolveDocumentLeave({
      state: () => state,
      flush,
      retainRecovery: vi.fn(),
      confirmLeave: vi.fn(() => false),
    })).toBe(true);
    expect(flush).toHaveBeenCalledOnce();
  });

  it("offers Stay or Leave and retains recovery for unsaved work", async () => {
    const retainRecovery = vi.fn();
    expect(await resolveDocumentLeave({
      state: () => "unsaved",
      flush: vi.fn(),
      retainRecovery,
      confirmLeave: () => false,
    })).toBe(false);
    expect(retainRecovery).toHaveBeenCalledOnce();
  });
});
