import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const server = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; args: Record<string, unknown>; fetch?: unknown }>,
  answer: (_method: string): unknown => ({}),
  visits: [] as string[],
}));

vi.mock("../../utils/api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/api.js")>()),
  call: async (method: string, args: Record<string, unknown>, options: { fetch?: unknown } = {}) => {
    server.calls.push({ method, args, fetch: options.fetch });
    const answer = server.answer(method);
    if (answer instanceof Error) throw answer;
    return answer;
  },
}));
vi.mock("./driveVisit", () => ({
  recordVisit: async (node: string) => {
    server.visits.push(node);
  },
}));
vi.mock("../../utils/compress.js", () => ({
  isDecompressionSupported: () => false,
  decodeFromDownload: async (value: string) => value,
  encodeForUpload: async (value: string) => value,
}));

import { usePersistence } from "./usePersistence.js";

function refusal(): Error {
  return Object.assign(new Error("Not permitted"), { excType: "PermissionError", status: 403 });
}

let live: Record<string, Record<string, string>> = { Sheet1: {} };

function persistence(options: Record<string, unknown> = {}) {
  const sheet = {
    restore: () => {},
    getAllRaw: () => live,
    getCurrentSheet: () => "Sheet1",
  };
  const formats = { restore: () => {}, snapshot: () => ({}) };
  return usePersistence({ sheet, formats, currentTitle: ref("Budget"), emit: () => {}, ...options });
}

const saves = () => server.calls.filter((call) => call.method === "suite.sheets.api.save_sheet");

beforeEach(() => {
  live = { Sheet1: {} };
  server.calls = [];
  server.visits = [];
  server.answer = (method) =>
    method === "suite.sheets.api.get_sheet"
      ? { name: "sheet-1", title: "Budget", can_write: true, sheets_data: "{}", owner: "a@example.com", node: "node-1" }
      : { name: "sheet-1" };
});

describe("Sheets persistence", () => {
  it("records a Drive visit on the sheet's node, and none for a legacy sheet or when the caller records it", async () => {
    await persistence().loadSheet("sheet-1");
    await persistence({ recordVisits: false }).loadSheet("sheet-1");
    server.answer = () => ({ name: "sheet-2", title: "Old", sheets_data: "{}", node: null });
    await persistence().loadSheet("sheet-2");

    expect(server.visits).toEqual(["node-1"]);
    expect(server.calls.map((call) => call.method)).not.toContain("suite.drive.api.files.track_visit");
  });

  it("sends nothing while the editor may not write, and says the change is not saved", async () => {
    const saved = persistence({ isWritable: () => false });
    await expect(saved.saveExisting("sheet-1", "Budget")).resolves.toBeNull();

    expect(saves()).toEqual([]);
    expect(saved.saveError.value).toMatch(/not saved/i);
  });

  it("reports a refused save once and does not retry it", async () => {
    server.answer = () => refusal();
    const onRefused = vi.fn();
    const saved = persistence({ onRefused });

    await expect(saved.saveExisting("sheet-1", "Budget")).resolves.toBeNull();

    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(saves()).toHaveLength(1);
    expect(saved.saveError.value).toContain("Not permitted");
  });

  it("keeps the whole workbook as JSON for a recovery copy", () => {
    const workbook = JSON.parse(persistence().workbookJson());
    expect(workbook).toMatchObject({ formats: {}, merge: null, view: null });
    expect(workbook.sheet).toBeTruthy();
  });

  it("loads and saves through the caller's fetch, so link credentials ride along", async () => {
    const credentialFetch = vi.fn();
    const saved = persistence({ credentialFetch });
    await saved.loadSheet("sheet-1");
    await saved.saveExisting("sheet-1", "Budget");

    expect(server.calls.map((call) => [call.method, call.fetch])).toEqual([
      ["suite.sheets.api.get_sheet", credentialFetch],
      ["suite.sheets.api.save_sheet", credentialFetch],
    ]);
  });

  it("treats Drive hiding the sheet as a refusal, not a network blip", async () => {
    server.answer = () => Object.assign(new Error("Not found"), { excType: "DriveNotFound", status: 404 });
    const onRefused = vi.fn();
    await persistence({ onRefused }).saveExisting("sheet-1", "Budget");

    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(saves()).toHaveLength(1);
  });

  it("puts a cell edit still in progress into the recovery copy, and leaves the live workbook alone", () => {
    live = { Sheet1: { A1: "kept" } };
    const workbook = JSON.parse(persistence().workbookJson({ sheet: "Sheet1", cell: "B2", value: "typing" }));

    expect(workbook.sheet.sheets.Sheet1.rows).toEqual({ "0": ["kept"], "1": [null, "typing"] });
    expect(live).toEqual({ Sheet1: { A1: "kept" } });
  });
});
