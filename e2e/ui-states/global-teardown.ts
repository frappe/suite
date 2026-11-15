import type { FullConfig } from "@playwright/test";
import { removeUsers } from "../drive-backed-apps/global-teardown";
import { STATE_DIR } from "./global-setup";

/** Removes this run's users, whatever point the setup reached. */
export default function globalTeardown(config: FullConfig): Promise<void> {
	return removeUsers(config, STATE_DIR);
}
