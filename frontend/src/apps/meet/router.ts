import type { RouteLocationNormalized, Router } from "vue-router";

import suiteRouter from "@/router";
import { userResource } from "@/boot/session";
import { isUnknownRecord } from "./types";

/**
 * Meet-local guard on the shared suite router: the `requiresAdmin` role check
 * (audio-test, restricted to System Manager / Administrator). Early-returns
 * for any route whose name doesn't start with `meet-`; auth itself is the
 * suite router's `beforeEach` (redirects guests unless `meta.allowGuest`,
 * which `meet-meeting` carries so guests can join).
 *
 * Re-exports the suite router instance as `router` for meet pages/composables.
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
			const user = userResource.data;
			const roles =
				isUnknownRecord(user) &&
				Array.isArray(user.roles) &&
				user.roles.every((role) => typeof role === "string")
					? user.roles
					: [];
			const isAdmin = roles.some((r) =>
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
