import suiteRouter, { mailGuard } from '@/apps/mail/router'

/**
 * Mail's navigation guard on the suite router: account resolution, shortcut expansion (bare
 * `/mail` lands on the inbox), mailbox validation and dashboard access. Installed once, when
 * `routes.ts` first loads.
 */
suiteRouter.beforeEach(mailGuard)
