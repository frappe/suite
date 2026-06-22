import type { RouteLocationNormalized, Router } from "vue-router";

import suiteRouter from "@/router";
import { userResource } from "@/boot/session";

/**
 * Meet router compat + guard.
 *
 * The standalone Meet app had its own `createRouter` with a global `beforeEach`
 * implementing: auth redirect to /login, `requiresAdmin` (audio-test, restricted
 * to System Manager / Administrator), and `allowGuest` (the Meeting route is
 * reachable by guests). In the suite there is ONE router; the suite router's own
 * `beforeEach` already redirects guests to /login UNLESS the route is marked
 * `meta.isPublic` (we mark `meet-meeting` public so guests can join).
 *
 * So only the meet-SPECIFIC `requiresAdmin` role check is ported here as a
 * meet-local guard that early-returns for any route whose name doesn't start
 * with `meet-`. Login state comes from the shared session store via the suite
 * guard; here we only use meet's `userResource` for the admin role check.
 *
 * Re-exports the single suite router instance as `router` so meet pages/
 * composables can keep importing it, mirroring the calendar/slides ports.
 */
export const router = suiteRouter;

function installMeetGuard(r: Router) {
	r.beforeEach(async (to: RouteLocationNormalized) => {
		// Only act on meet routes; let the suite handle everything else.
		if (typeof to.name !== "string" || !to.name.startsWith("meet-")) return;

		if (to.meta?.requiresAdmin) {
			try {
				if (!userResource.fetched) {
					await userResource.fetch();
				}
			} catch {
				// userResource onError already redirects to /login on auth errors.
				return false;
			}
			const user = userResource.data as Record<string, unknown> | null;
			const isAdmin = (user?.roles as string[])?.some((r) =>
				["System Manager", "Administrator"].includes(r),
			);
			if (!isAdmin) {
				return { name: "meet-home" };
			}
		}
	});
}

installMeetGuard(router);

export default router;
