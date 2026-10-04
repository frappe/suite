import type { FullConfig } from "@playwright/test";
import { readFile } from "node:fs/promises";
import meetSetup from "../global-setup";
// @ts-expect-error Runtime validated JSON interface.
import { validateManifest } from "./report.mjs";

export default async function setup(config: FullConfig): Promise<void> {
  const path = process.env.MEET_CAPTION_MANIFEST;
  if (!path) throw new Error("Set MEET_CAPTION_MANIFEST to a consented audio corpus manifest");
  validateManifest(JSON.parse(await readFile(path, "utf8")));
  await meetSetup(config);
}
