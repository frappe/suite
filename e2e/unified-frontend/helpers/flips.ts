import { test as base, expect } from "@playwright/test";

/**
 * The two rollout flips as the SPA boot sends them (`suite/www/suite.py`).
 * The Vite dev server does not render that boot, so a journey sets the values
 * before the app loads, the way the served page does.
 */
export type Flips = { suite_flip_shell: boolean; suite_flip_files: boolean };

/**
 * Journeys run with both flips on by default: the state the areas ship in.
 * A spec that checks another state sets `test.use({ flips })`.
 */
export const test = base.extend<{ flips: Flips }>({
	flips: [{ suite_flip_shell: true, suite_flip_files: true }, { option: true }],
	context: async ({ context, flips }, use) => {
		await context.addInitScript((value) => Object.assign(window, value), flips);
		await use(context);
	},
});

export { expect };
