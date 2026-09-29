import type { RouteRecordRaw } from "vue-router";

/**
 * Meet route module — mounted by the suite router under the '/meet' prefix.
 * Paths are RELATIVE to '/meet' (no leading slash; the empty-path child '' is
 * the app index). Route names are namespaced `meet-*` to avoid collisions in the
 * single suite router.
 *
 * All routes nest under MeetLayout, which opens the socket connection and
 * closes it on unmount, provides the meet-local `$platform`, and hosts the
 * shortcuts dialog. The platform provides the one FrappeUIProvider.
 *
 * `meet-meeting` is marked `meta.allowGuest` so the suite's auth guard lets
 * guests join meetings. The meet-local guard (./router.ts) enforces
 * `requiresAdmin` for audio-test.
 */
export const routes: RouteRecordRaw[] = [
	{
		path: "",
		component: () => import("@/apps/meet/pages/MeetLayout.vue"),
		children: [
			{
				path: "",
				name: "meet-home",
				component: () => import("@/apps/meet/pages/Home.vue"),
			},
			{
				path: "audio-test",
				name: "meet-audio-test",
				component: () => import("@/apps/meet/pages/AudioTest.vue"),
				meta: { requiresAdmin: true },
			},
			{
				path: ":meetingId",
				name: "meet-meeting",
				component: () => import("@/apps/meet/pages/Meeting.vue"),
				meta: { allowGuest: true },
			},
		],
	},
];
