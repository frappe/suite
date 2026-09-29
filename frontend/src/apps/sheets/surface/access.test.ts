import { describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

import type { SessionState } from "@/apps/drive";
import { createSheetAccess } from "./access";

function fakeSession(role: number, state: SessionState = "Active") {
  return {
    state: ref<SessionState>(state),
    access: ref<{ role?: number }>({ role }),
    refreshAccess: vi.fn(async () => {}),
  };
}

describe("Sheets access", () => {
  it("follows the role Drive grants", async () => {
    const session = fakeSession(40);
    const access = createSheetAccess(session, {});
    expect([access.readable.value, access.canComment.value, access.writable.value]).toEqual([true, true, true]);

    session.access.value = { role: 20 };
    expect([access.readable.value, access.canComment.value, access.writable.value]).toEqual([true, true, false]);

    session.access.value = { role: 10 };
    expect([access.readable.value, access.canComment.value, access.writable.value]).toEqual([true, false, false]);

    session.state.value = "Refused";
    session.access.value = {};
    expect(access.readable.value).toBe(false);
  });

  it("keeps a trashed spreadsheet read-only whatever the role", () => {
    const access = createSheetAccess(fakeSession(50, "Trashed"), {});
    expect(access.readable.value).toBe(true);
    expect(access.writable.value).toBe(false);
    expect(access.canComment.value).toBe(false);
  });

  it("narrows to read-only on a refusal, and the answer to that refusal's own question does not lift it", async () => {
    const session = fakeSession(50);
    const onNarrow = vi.fn();
    const access = createSheetAccess(session, { narrowed: onNarrow });
    let answer = () => {};
    session.refreshAccess.mockImplementationOnce(
      () =>
        new Promise<void>((settle) => {
          answer = () => {
            session.access.value = { role: 50 };
            settle();
          };
        }),
    );

    access.refuse();
    expect(access.writable.value).toBe(false);
    expect(access.readable.value).toBe(true);
    expect(session.refreshAccess).toHaveBeenCalledTimes(1);
    expect(onNarrow).toHaveBeenCalledTimes(1);

    answer();
    await nextTick();
    expect(access.writable.value).toBe(false);
  });

  it("lifts a refusal once a later Drive answer grants edit again", async () => {
    const session = fakeSession(50);
    const widened = vi.fn();
    const access = createSheetAccess(session, { widened });
    access.refuse();
    await Promise.resolve();

    session.access.value = { role: 20 };
    expect(access.writable.value).toBe(false);
    session.access.value = { role: 40 };
    expect(access.writable.value).toBe(true);
    expect(widened).toHaveBeenCalledTimes(1);
  });

  it("runs the narrowing once per loss of edit access", () => {
    const session = fakeSession(40);
    const onNarrow = vi.fn();
    createSheetAccess(session, { narrowed: onNarrow });

    session.access.value = { role: 20 };
    session.access.value = { role: 10 };
    expect(onNarrow).toHaveBeenCalledTimes(1);

    session.access.value = { role: 40 };
    session.state.value = "Trashed";
    expect(onNarrow).toHaveBeenCalledTimes(2);
  });

  it("does not run the narrowing for a reader who never could edit", () => {
    const session = fakeSession(10);
    const onNarrow = vi.fn();
    createSheetAccess(session, { narrowed: onNarrow });
    session.access.value = {};
    expect(onNarrow).not.toHaveBeenCalled();
  });

  it("reports edit access coming back once, and never on first open", () => {
    const session = fakeSession(40);
    const widened = vi.fn();
    createSheetAccess(session, { widened });
    expect(widened).not.toHaveBeenCalled();

    session.state.value = "Trashed";
    session.state.value = "Active";
    session.access.value = { role: 50 };
    expect(widened).toHaveBeenCalledTimes(1);
  });
});
