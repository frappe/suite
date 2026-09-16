import { createHash } from "node:crypto";
import { expect, test } from "../../fixtures/test";

// Matches FileUploader.vue's Dropzone chunkSize (20MB). A file just over one
// chunk produces exactly 2 chunks, so the second needs a real offset to land
// at rather than offset 0.
const CHUNK_SIZE = 20 * 1024 * 1024;

// Deterministic, not `randomBytes()`: a failing run must be reproducible from
// its SHA-256 alone, and content has to actually differ from one chunk to the
// next so a duplication or reorder bug is guaranteed to change the hash.
function fillDeterministic(size: number): Buffer {
  const buf = Buffer.alloc(size);
  let state = 0x2f6e2b1;
  for (let i = 0; i < size; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    buf[i] = state & 0xff;
  }
  return buf;
}

const fileBuffer = fillDeterministic(CHUNK_SIZE + 5 * 1024 * 1024);
const expectedSha256 = createHash("sha256").update(fileBuffer).digest("hex");

/**
 * Retrying a failed upload resends chunk 0 under the same upload id. The
 * retry must overwrite the already-staged bytes, not duplicate them.
 */
test("retrying a failed chunked upload does not duplicate already-staged bytes", async ({
  owner,
}) => {
  const { page } = owner;
  let uploadRequestsSeen = 0;

  await page.route(
    "**/api/method/suite.drive.api.files.upload_file",
    async (route) => {
      uploadRequestsSeen++;
      // Let chunk 0 through; drop chunk 1 exactly once to simulate a network
      // failure partway through the upload (the second upload_file call is
      // always chunk 1 here, since Dropzone sends chunks sequentially and
      // `parallelChunkUploads` is unset).
      if (uploadRequestsSeen === 2) {
        await route.abort("failed");
      } else {
        await route.continue();
      }
    },
  );

  await page.goto("/drive");
  const fileName = `chunked-retry-${Date.now()}.bin`;
  await page.getByTestId("drive-file-input").setInputFiles({
    name: fileName,
    mimeType: "application/octet-stream",
    buffer: fileBuffer,
  });

  await expect(page.getByText(/upload.*failed/i)).toBeVisible({ timeout: 30_000 });

  let finalizedFile: { name: string; file_size: number } | null = null;
  page.on("response", async (response) => {
    if (!response.url().includes("upload_file") || !response.ok()) return;
    try {
      const body = await response.json();
      if (body?.message?.name) finalizedFile = body.message;
    } catch {
      // Intermediate chunk responses have an empty body.
    }
  });

  await page.getByTestId("upload-retry-button").click();

  await expect
    .poll(() => finalizedFile, { timeout: 30_000, message: "retry never finalized the upload" })
    .not.toBeNull();

  const finalized = finalizedFile as unknown as { name: string; file_size: number };
  expect(finalized.file_size, "reported file_size must match the original, not an inflated retry").toBe(
    fileBuffer.length,
  );

  const content = await page.request.get(
    `/api/method/suite.drive.api.files.get_file_content?entity_name=${finalized.name}`,
  );
  expect(content.ok()).toBe(true);
  const bytes = await content.body();
  expect(bytes.length).toBe(fileBuffer.length);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(expectedSha256);
});
