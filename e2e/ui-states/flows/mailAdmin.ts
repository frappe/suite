import { expect, type Locator, type Page } from "@playwright/test";
import { callMethod, unlessRefused } from "../../shared/frappe";
import { acrossRestarts } from "../bench";
import { openDemoScene, setSuiteCloudStandIn } from "../demo";
import { defineFlow, setupFlow } from "../flow";
import { perScene, type BaseScene } from "../scene";

type Event =
	| { type: "SUITE_CLOUD_OFF" }
	| { type: "DOMAINS_SLOW" }
	| { type: "DOMAINS_FAIL" }
	| { type: "DOMAINS_NONE" }
	| { type: "SEARCH_DOMAINS_MISS" }
	| { type: "FILTER_PENDING" }
	| { type: "OPEN_MISSING_DOMAIN" }
	| { type: "OPEN_ADD_DOMAIN" }
	| { type: "TYPE_DOMAIN" }
	| { type: "ADD_DOMAIN_SLOW" }
	| { type: "ADD_DOMAIN" }
	| { type: "ADD_TAKEN_DOMAIN" }
	| { type: "OPEN_DOMAIN_SLOW" }
	| { type: "OPEN_PENDING_DOMAIN" }
	| { type: "OPEN_ACTIVE_DOMAIN" }
	| { type: "VERIFY_SLOW" }
	| { type: "VERIFY" }
	| { type: "OPEN_EXPORT" }
	| { type: "OPEN_DOMAIN_MORE" }
	| { type: "EDIT_DOMAIN" }
	| { type: "SAVE_DOMAIN" }
	| { type: "SAVE_DOMAIN_FAILS" }
	| { type: "DISABLE_DOMAIN" }
	| { type: "CONFIRM_DISABLE_DOMAIN" }
	| { type: "DELETE_DOMAIN" }
	| { type: "CONFIRM_DELETE_DOMAIN" }
	| { type: "OPEN_GROUPS" }
	| { type: "OPEN_GROUPS_WITH_ONE" }
	| { type: "GROUPS_SLOW" }
	| { type: "GROUPS_FAIL" }
	| { type: "SEARCH_GROUPS_MISS" }
	| { type: "OPEN_ADD_GROUP" }
	| { type: "FILL_GROUP" }
	| { type: "ADD_GROUP_SLOW" }
	| { type: "ADD_GROUP" }
	| { type: "ADD_TAKEN_GROUP" }
	| { type: "OPEN_GROUP_SLOW" }
	| { type: "OPEN_GROUP" }
	| { type: "OPEN_GROUP_MORE" }
	| { type: "EDIT_GROUP" }
	| { type: "SAVE_GROUP" }
	| { type: "OPEN_ADD_GROUP_EMAIL" }
	| { type: "ADD_GROUP_EMAIL" }
	| { type: "OPEN_ADD_GROUP_MEMBERS" }
	| { type: "DISABLE_RECEIVING" }
	| { type: "CONFIRM_RECEIVING" }
	| { type: "DELETE_GROUP" }
	| { type: "CONFIRM_DELETE_GROUP" }
	| { type: "OPEN_LISTS" }
	| { type: "OPEN_LISTS_WITH_ONE" }
	| { type: "LISTS_SLOW" }
	| { type: "LISTS_FAIL" }
	| { type: "SEARCH_LISTS_MISS" }
	| { type: "OPEN_ADD_LIST" }
	| { type: "FILL_LIST" }
	| { type: "ADD_LIST_SLOW" }
	| { type: "ADD_LIST" }
	| { type: "ADD_TAKEN_LIST" }
	| { type: "OPEN_LIST_SLOW" }
	| { type: "OPEN_LIST" }
	| { type: "EDIT_LIST" }
	| { type: "SAVE_LIST" }
	| { type: "OPEN_ADD_LIST_EMAIL" }
	| { type: "ADD_LIST_EMAIL" }
	| { type: "OPEN_ADD_RECIPIENTS" }
	| { type: "ADD_RECIPIENT" }
	| { type: "OPEN_LIST_MORE" }
	| { type: "DELETE_LIST" }
	| { type: "CONFIRM_DELETE_LIST" };

/**
 * Mail's admin pages under /admin/mail: Domains, Groups and Mailing lists.
 * They need Suite Cloud, so the flow turns the demo site's stand-in
 * (`suite_cloud_fake`) on before its first path and off after its last. The
 * stand-in seeds one live domain, example.com; each path adds its own pending
 * and disabled domains, and its own groups and lists on example.com, and
 * removes them when it ends.
 */
const machine = setupFlow<Event>().createMachine({
	id: "mailAdmin",
	initial: "domainsList",
	states: {
		redirectedToOverview: {
			meta: { description: "Without Suite Cloud (answered “not configured” in the test), Maya opens /admin/mail/domains and lands on the self-hosted Overview: Active users and Where storage goes, and no Mail section in the sidebar. Nothing says why the page she asked for is missing." },
		},
		domainsList: {
			meta: { description: "Domains: one row per domain with a status badge (Active, Pending Verification, Disabled), its description, when it was last verified and when it was added, and Add domain at the top. Every row says “2 months ago” and “—” because the stand-in fixes those dates." },
			on: {
				SUITE_CLOUD_OFF: "redirectedToOverview",
				DOMAINS_SLOW: "domainsSkeleton",
				DOMAINS_FAIL: "domainsFailed",
				DOMAINS_NONE: "domainsEmpty",
				SEARCH_DOMAINS_MISS: "domainsSearchEmpty",
				FILTER_PENDING: "domainsFiltered",
				OPEN_MISSING_DOMAIN: "domainMissing",
				OPEN_ADD_DOMAIN: "addDomain",
				OPEN_DOMAIN_SLOW: "domainSkeleton",
				OPEN_PENDING_DOMAIN: "domainPending",
				OPEN_ACTIVE_DOMAIN: "domainActive",
				OPEN_GROUPS: "groupsEmpty",
				OPEN_GROUPS_WITH_ONE: "groupsList",
				OPEN_LISTS: "listsEmpty",
				OPEN_LISTS_WITH_ONE: "listsList",
			},
		},
		domainsSkeleton: { meta: { description: "Domains loading: two placeholder rows under the column headers." } },
		domainsFailed: { meta: { description: "The domain list failed: a centred “Could not load domains” block with Retry replaces the rows." } },
		domainsEmpty: { meta: { description: "No domains (response shaped in the test): “No domains yet” with an Add domain button." } },
		domainsSearchEmpty: { meta: { description: "A search that matches nothing: “No matching domains”, without the first-run Add domain pitch." } },
		domainsFiltered: { meta: { description: "The Status filter set to Pending Verification: only the domain still waiting for DNS. The select is too narrow and cuts its label to “Pending Verificati”." } },
		domainMissing: { meta: { description: "A link to a domain that does not exist: the page goes back to Domains and a toast says “<name> not found.”" } },

		addDomain: {
			meta: { description: "Add domain: it asks for the domain, says its ownership record must be published at the DNS provider before it is added, and keeps a place for that record. Add domain is off until a name is typed." },
			on: { TYPE_DOMAIN: "addDomainChecked", ADD_TAKEN_DOMAIN: "addDomainFailed" },
		},
		addDomainChecked: {
			meta: { description: "A name typed and the field left: the ownership TXT record fills its place, with Host and Value each copyable; the dialog does not move." },
			on: { ADD_DOMAIN_SLOW: "addDomainBusy", ADD_DOMAIN: "domainAdded" },
		},
		addDomainBusy: { meta: { description: "Add domain pressed and the add still out: the fields grey out and the button dims, with no spinner." } },
		addDomainFailed: { meta: { description: "A domain the site already has: “Domain … already exists.” shows at the bottom of the dialog and again in a toast." } },
		domainAdded: { meta: { description: "The dialog closes, “Domain added.” shows, and the new domain's page opens with Pending Verification and the set-up banner." } },

		domainSkeleton: { meta: { description: "One domain loading: a header placeholder with four action placeholders, and DNS records with two groups of placeholder rows." } },
		domainPending: {
			meta: { description: "A domain waiting for DNS: Pending Verification badge, a blue banner about publishing the records, and DNS records grouped by purpose, with the Required group marked red and each record Not verified." },
			on: {
				VERIFY_SLOW: "verifyBusy",
				VERIFY: "domainVerified",
				OPEN_EXPORT: "exportMenu",
				OPEN_DOMAIN_MORE: "domainMoreMenu",
				EDIT_DOMAIN: "editDomain",
			},
		},
		domainActive: { meta: { description: "A live domain: Active badge and no banner. Each record still reads Not verified, because the stand-in never marks records." } },
		verifyBusy: { meta: { description: "Verify DNS pressed and the check still out: the button spins." } },
		domainVerified: { meta: { description: "The check passes: “DNS records checked.” shows, the badge turns Active and the banner goes. The records still read Not verified (stand-in)." } },
		exportMenu: { meta: { description: "Export DNS open: Zone file, CSV and JSON." } },
		domainMoreMenu: {
			meta: { description: "The more menu: Disable domain and Delete domain." },
			on: { DISABLE_DOMAIN: "disableDomainConfirm", DELETE_DOMAIN: "deleteDomainConfirm" },
		},
		editDomain: {
			meta: { description: "Edit domain: description, catch-all address, and switches for sub-addressing and relaying." },
			on: { SAVE_DOMAIN: "domainUpdated", SAVE_DOMAIN_FAILS: "editDomainFailed" },
		},
		domainUpdated: { meta: { description: "Saved: the dialog closes, “Domain updated.” shows and the header shows the new description." } },
		editDomainFailed: { meta: { description: "Saving failed: “Something went wrong” shows inside the dialog, which stays open, and again in a toast." } },
		disableDomainConfirm: {
			meta: { description: "Disable this domain?: mail for the domain stops and its verification is dropped. Cancel, and an amber Disable domain." },
			on: { CONFIRM_DISABLE_DOMAIN: "domainDisabled" },
		},
		domainDisabled: { meta: { description: "“Domain disabled.” shows and the badge turns Disabled, but the blue banner still asks for the DNS records to be added, and Verify DNS is still offered." } },
		deleteDomainConfirm: {
			meta: { description: "Delete this domain?: it cannot be undone. Cancel, and a red Delete domain." },
			on: { CONFIRM_DELETE_DOMAIN: "domainDeleted" },
		},
		domainDeleted: { meta: { description: "Back on Domains with “Domain deleted.” and the row gone." } },

		groupsEmpty: {
			meta: { description: "No groups yet: the first-run pitch with an Add group button." },
			on: { GROUPS_SLOW: "groupsSkeleton", GROUPS_FAIL: "groupsFailed", OPEN_ADD_GROUP: "addGroup" },
		},
		groupsSkeleton: { meta: { description: "Groups loading: two placeholder rows, as on Domains." } },
		groupsFailed: { meta: { description: "The group list failed: “Could not load groups” and Retry replace the rows." } },
		groupsList: {
			meta: { description: "Groups: address, description, storage (“0 B used, unlimited”) and when it was created." },
			on: { SEARCH_GROUPS_MISS: "groupsSearchEmpty", OPEN_GROUP_SLOW: "groupSkeleton", OPEN_GROUP: "groupView" },
		},
		groupsSearchEmpty: { meta: { description: "A search that matches no group: “No matching groups”." } },
		addGroup: {
			meta: { description: "Add group: its email address on one row (username @ a select of active domains), description, members picked from mail accounts, and Disable receiving. Add group is off until a name and a domain are set." },
			on: { FILL_GROUP: "addGroupFilled", ADD_TAKEN_GROUP: "addGroupFailed" },
		},
		addGroupFilled: {
			meta: { description: "A name, a domain and a description filled in: Add group turns on." },
			on: { ADD_GROUP_SLOW: "addGroupBusy", ADD_GROUP: "groupAdded" },
		},
		addGroupBusy: { meta: { description: "Add group pressed and the add still out: the fields grey out and the button dims, with no spinner." } },
		addGroupFailed: { meta: { description: "An address that is already a group: “… is already a Mail Group.” shows at the bottom of the dialog and again in a toast." } },
		groupAdded: { meta: { description: "“Group added.” and the group's page opens. The primary address's switch is on but greyed out, so it reads as off." } },
		groupSkeleton: { meta: { description: "One group loading: placeholder header and cards." } },
		groupView: {
			meta: { description: "One group: General information (receiving and when it was added; the description sits under the title), Mail storage usage (“0 GB · Mail has no storage limit”), Email addresses with an Enabled switch each, and Members with a search." },
			on: {
				OPEN_GROUP_MORE: "groupMoreMenu",
				EDIT_GROUP: "editGroup",
				OPEN_ADD_GROUP_EMAIL: "addGroupEmail",
				OPEN_ADD_GROUP_MEMBERS: "addGroupMembers",
			},
		},
		groupMoreMenu: {
			meta: { description: "The group's more menu: Disable receiving and Delete group." },
			on: { DISABLE_RECEIVING: "receivingConfirm", DELETE_GROUP: "deleteGroupConfirm" },
		},
		editGroup: {
			meta: { description: "Edit group: the description only." },
			on: { SAVE_GROUP: "groupUpdated" },
		},
		groupUpdated: { meta: { description: "“Group updated.” and the new description in the header." } },
		addGroupEmail: {
			meta: { description: "Add email address: a username and a domain, and a description used as the display name." },
			on: { ADD_GROUP_EMAIL: "groupEmailAdded" },
		},
		groupEmailAdded: { meta: { description: "“Email address added.” and a second row under Email addresses." } },
		addGroupMembers: { meta: { description: "Add members: a picker of mail accounts. It is empty here because the stand-in has no accounts." } },
		receivingConfirm: {
			meta: { description: "Disable receiving?: mail sent to the group bounces back to the sender. Cancel, and an amber Disable receiving." },
			on: { CONFIRM_RECEIVING: "receivingDisabled" },
		},
		receivingDisabled: { meta: { description: "“Receiving disabled.” and Receiving reads Disabled. The header and the address list do not change." } },
		deleteGroupConfirm: {
			meta: { description: "Delete this group?: it cannot be undone. Cancel, and a red Delete group." },
			on: { CONFIRM_DELETE_GROUP: "groupDeleted" },
		},
		groupDeleted: { meta: { description: "Back on an empty Groups list with “Group deleted.”, and no “not found” error from the page that was just deleted." } },

		listsEmpty: {
			meta: { description: "No mailing lists yet: the first-run pitch with an Add mailing list button. The page title says “Mailing lists”; the sidebar says “Mailing lists”." },
			on: { LISTS_SLOW: "listsSkeleton", LISTS_FAIL: "listsFailed", OPEN_ADD_LIST: "addList" },
		},
		listsSkeleton: { meta: { description: "Mailing lists loading: two placeholder rows, as on Domains." } },
		listsFailed: { meta: { description: "The mailing list failed: “Could not load mailing lists” and Retry replace the rows." } },
		listsList: {
			meta: { description: "Mailing lists: address, description and the number of recipients." },
			on: { SEARCH_LISTS_MISS: "listsSearchEmpty", OPEN_LIST_SLOW: "listSkeleton", OPEN_LIST: "listView" },
		},
		listsSearchEmpty: { meta: { description: "A search that matches no list: “No matching mailing lists”." } },
		addList: {
			meta: { description: "Add mailing list: its email address on one row (username @ a select of active domains), description and recipients as chips. Add mailing list is off until a name and a domain are set and every recipient is an address." },
			on: { FILL_LIST: "addListFilled", ADD_TAKEN_LIST: "addListFailed" },
		},
		addListFilled: {
			meta: { description: "A name, a domain, a description and two recipients filled in." },
			on: { ADD_LIST_SLOW: "addListBusy", ADD_LIST: "listAdded" },
		},
		addListBusy: { meta: { description: "Add mailing list pressed and the add still out: the fields grey out and the button dims, with no spinner." } },
		addListFailed: { meta: { description: "An address that is already a list: “… is already a Mailing list.” shows at the bottom of the dialog and again in a toast." } },
		listAdded: { meta: { description: "“Mailing list added.” and the list's page opens with its two recipients." } },
		listSkeleton: { meta: { description: "One list loading: placeholder header and cards." } },
		listView: {
			meta: { description: "One list: Email addresses with Enabled switches, and Recipients with a search." },
			on: {
				EDIT_LIST: "editList",
				OPEN_ADD_LIST_EMAIL: "addListEmail",
				OPEN_ADD_RECIPIENTS: "addRecipients",
				OPEN_LIST_MORE: "listMoreMenu",
			},
		},
		editList: {
			meta: { description: "Edit mailing list: the description only." },
			on: { SAVE_LIST: "listUpdated" },
		},
		listUpdated: { meta: { description: "“Mailing list updated.” and the new description in the header." } },
		addListEmail: {
			meta: { description: "Add email address for the list: a username and a domain, and a description." },
			on: { ADD_LIST_EMAIL: "listEmailAdded" },
		},
		listEmailAdded: { meta: { description: "“Email address added.” and a second row under Email addresses." } },
		addRecipients: {
			meta: { description: "Add recipients: one field that takes many addresses, typed or pasted, each shown as a chip." },
			on: { ADD_RECIPIENT: "recipientsAdded" },
		},
		recipientsAdded: { meta: { description: "“Recipients added.” and the new address under Recipients." } },
		listMoreMenu: {
			meta: { description: "The list's more menu: Delete mailing list only." },
			on: { DELETE_LIST: "deleteListConfirm" },
		},
		deleteListConfirm: {
			meta: { description: "Delete this mailing list?: it cannot be undone. Cancel, and a red Delete mailing list." },
			on: { CONFIRM_DELETE_LIST: "listDeleted" },
		},
		listDeleted: { meta: { description: "Back on Mailing lists with “Mailing list deleted.”." } },
	},
});

// — the path's own data —

/** The stand-in's seeded live domain. Groups and lists need an active domain, so they go here. */
const LIVE = "example.com";
const ADMIN_API = "suite.mail.api.admin";

interface Names {
	stamp: string;
	/** Pending Verification; edited, disabled, verified and deleted by the paths that need it. */
	pending: string;
	disabled: string;
	/** Added through the dialog. */
	added: string;
	group: string;
	list: string;
}
const names = perScene<Names>("mailAdmin: names");

function call<T = unknown>(scene: BaseScene, method: string, data: Record<string, unknown>): Promise<T> {
	return callMethod<T>(scene.api, `${ADMIN_API}.${method}`, data);
}

/** Cleanup. The item may never have been made, or a path may have deleted it already, so a refusal is fine. */
async function quietly(scene: BaseScene, method: string, data: Record<string, unknown>): Promise<void> {
	await call(scene, method, data).catch(unlessRefused);
}

/** Removes what an earlier run of this flow left behind, so the empty Groups and Mailing lists states hold. */
async function sweep(scene: BaseScene): Promise<void> {
	const domains = await call<{ items: { name: string }[] }>(scene, "get_domains", { page_length: 100 });
	const groups = await call<{ items: { id: string }[] }>(scene, "get_groups", { page_length: 100 });
	const lists = await call<{ items: { id: string }[] }>(scene, "get_mailing_lists", { page_length: 100 });
	const ours = /^(harbor|archive|quay)-[0-9a-z]+\.test$/;
	for (const group of groups.items.filter((item) => /^frontdesk-[0-9a-z]+@/.test(item.id)))
		await quietly(scene, "delete_groups", { ids: [group.id] });
	for (const list of lists.items.filter((item) => /^newsletter-[0-9a-z]+@/.test(item.id)))
		await quietly(scene, "delete_mailing_lists", { ids: [list.id] });
	for (const domain of domains.items.filter((item) => ours.test(item.name)))
		await quietly(scene, "delete_domain", { domain_id: domain.name });
}

function method(name: string): RegExp {
	return new RegExp(`/api/method/suite\\.mail\\.api\\.admin\\.${name}(\\?|$)`);
}

async function seedGroup(scene: BaseScene, name: string): Promise<void> {
	scene.defer(() => quietly(scene, "delete_groups", { ids: [`${name}@${LIVE}`] }));
	await call(scene, "add_group", { name, domain: LIVE, description: "Front desk and visitors" });
}

async function seedList(scene: BaseScene, name: string): Promise<void> {
	scene.defer(() => quietly(scene, "delete_mailing_lists", { ids: [`${name}@${LIVE}`] }));
	await call(scene, "add_mailing_list", {
		name,
		domain: LIVE,
		description: "Quarterly news for the whole company",
		recipients: ["leo@northwind.test", "nisha@northwind.test"],
	});
}

function adminNav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Administration" });
}

function headerButton(page: Page, name: string): Locator {
	return page.getByRole("banner").getByRole("button", { name });
}

async function reloadWaitingFor(scene: BaseScene, pattern: RegExp): Promise<void> {
	const sent = scene.page.waitForRequest((request) => pattern.test(request.url()));
	await scene.page.reload();
	await sent;
}

/**
 * Picks `option` from the first select in `within`. A select opened while its
 * dialog is still coming in can open off screen, never placed by its
 * popover; Escape closes it and the next try opens it again.
 */
async function pickOption(scene: BaseScene, within: Locator, option: string): Promise<void> {
	const choice = scene.page.getByRole("option", { name: option, exact: true });
	await expect(async () => {
		if (await choice.isVisible()) await scene.page.keyboard.press("Escape");
		await within.getByRole("combobox").first().click();
		await expect(choice).toBeInViewport({ timeout: 2_000 });
	}).toPass({ timeout: 15_000 });
	await choice.click();
}

async function menuItem(scene: BaseScene, name: string): Promise<void> {
	await scene.page.getByRole("menuitem", { name }).click();
}

async function openMore(scene: BaseScene): Promise<void> {
	// The header's last button, an icon-only “more” dropdown, is the one without a name.
	await scene.page.locator("main, body").getByRole("button", { name: "", exact: true }).last().click();
	await expect(scene.page.getByRole("menuitem").first()).toBeVisible();
}

export const mailAdmin = defineFlow<Event, BaseScene>({
	id: "mailAdmin",
	title: "Mail admin",
	source: "frontend/src/apps/mail/adminRoutes.ts",
	open: (browser) => openDemoScene(browser),
	prepare: (browser) => setSuiteCloudStandIn(browser, true),
	restore: (browser) => setSuiteCloudStandIn(browser, false),
	machine,
	async enter(scene) {
		const stamp = scene.name("x").split(" ")[1];
		const own: Names = {
			stamp,
			pending: `harbor-${stamp}.test`,
			disabled: `archive-${stamp}.test`,
			added: `quay-${stamp}.test`,
			group: `frontdesk-${stamp}`,
			list: `newsletter-${stamp}`,
		};
		names.set(scene, own);
		await sweep(scene);
		for (const domain of [own.pending, own.disabled, own.added])
			scene.defer(() => quietly(scene, "delete_domain", { domain_id: domain }));
		await call(scene, "add_domain", { name: own.pending, description: "Harbor office" });
		await call(scene, "add_domain", { name: own.disabled, description: "Old archive" });
		await call(scene, "set_domain_enabled", { domain_id: own.disabled, enabled: false });
		await scene.goto("/admin/mail/domains");
		await expect(scene.page.getByText(own.pending)).toBeVisible();
		await expect(scene.page.getByText(own.disabled)).toBeVisible();
	},
	events: {
		async SUITE_CLOUD_OFF(scene) {
			// The answers a site without Suite Cloud gives: the account says so, and the storage report has no cloud.
			await scene.page.route("**/api/method/suite.mail.api.account.get_user_info*", async (route) => {
				const response = await acrossRestarts(scene.baseURL, () => route.fetch());
				// SAFETY: get_user_info answers `{ message: { ...user, is_suite_cloud_configured } }`.
				const body = (await response.json()) as { message: Record<string, unknown> };
				body.message.is_suite_cloud_configured = false;
				await route.fulfill({ response, json: body });
			});
			await scene.page.route(/\/api\/suite\/storage(\?|$)/, async (route) => {
				const response = await acrossRestarts(scene.baseURL, () => route.fetch());
				// SAFETY: the storage report answers `{ data: { cloud, ... } }`.
				const body = (await response.json()) as { data: Record<string, unknown> };
				body.data.cloud = false;
				await route.fulfill({ response, json: body });
			});
			await scene.page.reload();
			await expect(scene.page).toHaveURL(/\/admin$/);
			await expect(scene.page.getByRole("link", { name: /Active users/ })).toBeVisible();
		},
		async DOMAINS_SLOW(scene) {
			await scene.hold(method("get_domains"));
			await reloadWaitingFor(scene, method("get_domains"));
			await expect(scene.page.getByText(names.get(scene).pending)).toHaveCount(0);
		},
		async DOMAINS_FAIL(scene) {
			const hold = await scene.hold(method("get_domains"));
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByText("Could not load domains").first()).toBeVisible();
		},
		async DOMAINS_NONE(scene) {
			await scene.page.route(method("get_domains"), (route) => route.fulfill({ json: { message: { items: [], total: 0 } } }));
			await scene.page.reload();
			await expect(scene.page.getByText("No domains yet")).toBeVisible();
		},
		async SEARCH_DOMAINS_MISS(scene) {
			await scene.page.getByPlaceholder("Search").fill("lighthouse");
			await expect(scene.page.getByText("No matching domains")).toBeVisible();
		},
		async FILTER_PENDING(scene) {
			await pickOption(scene, scene.page.locator("body"), "Pending Verification");
			await expect(scene.page.getByText(names.get(scene).disabled)).toHaveCount(0);
			await expect(scene.page.getByText(names.get(scene).pending)).toBeVisible();
		},
		async OPEN_MISSING_DOMAIN(scene) {
			await scene.goto(`/admin/mail/domains/lighthouse-${names.get(scene).stamp}.test`);
			await expect(scene.page).toHaveURL(/\/admin\/mail\/domains$/);
			await expect(scene.page.getByText(names.get(scene).pending)).toBeVisible();
		},
		async OPEN_ADD_DOMAIN(scene) {
			await headerButton(scene.page, "Add domain").click();
			await expect(scene.dialog("Add domain")).toBeVisible();
		},
		async TYPE_DOMAIN(scene) {
			const dialog = scene.dialog("Add domain");
			await dialog.getByLabel("Domain name").fill(names.get(scene).added);
			await dialog.getByLabel("Description").fill("Quay warehouse");
			await expect(dialog.getByRole("button", { name: "Copy value" })).toBeVisible();
		},
		async ADD_DOMAIN_SLOW(scene) {
			await scene.hold(method("add_domain"));
			const sent = scene.page.waitForRequest((request) => method("add_domain").test(request.url()));
			await scene.dialog("Add domain").getByRole("button", { name: "Add domain" }).click();
			await sent;
		},
		async ADD_DOMAIN(scene) {
			await scene.dialog("Add domain").getByRole("button", { name: "Add domain" }).click();
			await expect(scene.toast("Domain added")).toBeVisible();
			await expect(scene.page).toHaveURL(new RegExp(`/admin/mail/domains/${names.get(scene).added.replace(/\./g, "\\.")}$`));
			await expect(scene.page.getByText("Set up your domain")).toBeVisible();
		},
		async ADD_TAKEN_DOMAIN(scene) {
			const dialog = scene.dialog("Add domain");
			await dialog.getByLabel("Domain name").fill(names.get(scene).pending);
			await dialog.getByRole("button", { name: "Add domain" }).click();
			await expect(dialog.getByText(/already exists/)).toBeVisible();
		},
		async OPEN_DOMAIN_SLOW(scene) {
			await scene.hold(method("get_domain"));
			await scene.page.getByText(names.get(scene).pending).click();
			await expect(scene.page.getByText("DNS records")).toBeVisible();
		},
		async OPEN_PENDING_DOMAIN(scene) {
			await scene.page.getByText(names.get(scene).pending).click();
			await expect(scene.page.getByText("Set up your domain")).toBeVisible();
		},
		async OPEN_ACTIVE_DOMAIN(scene) {
			await scene.page.getByText(LIVE, { exact: true }).click();
			await expect(scene.page.getByRole("button", { name: "Verify DNS" })).toBeVisible();
			await expect(scene.page.getByText("Set up your domain")).toHaveCount(0);
		},
		async VERIFY_SLOW(scene) {
			await scene.hold(method("verify_domain"));
			const sent = scene.page.waitForRequest((request) => method("verify_domain").test(request.url()));
			await scene.page.getByRole("button", { name: "Verify DNS" }).click();
			await sent;
		},
		async VERIFY(scene) {
			await scene.page.getByRole("button", { name: "Verify DNS" }).click();
			await expect(scene.toast("DNS records checked.")).toBeVisible();
			await expect(scene.page.getByText("Set up your domain")).toHaveCount(0);
		},
		async OPEN_EXPORT(scene) {
			await scene.page.getByRole("button", { name: "Export DNS" }).click();
			await expect(scene.page.getByRole("menuitem", { name: "Zone file" })).toBeVisible();
		},
		async OPEN_DOMAIN_MORE(scene) {
			await openMore(scene);
			await expect(scene.page.getByRole("menuitem", { name: "Delete domain" })).toBeVisible();
		},
		async EDIT_DOMAIN(scene) {
			await scene.page.getByRole("button", { name: "Edit", exact: true }).click();
			await expect(scene.dialog("Edit domain")).toBeVisible();
		},
		async SAVE_DOMAIN(scene) {
			const dialog = scene.dialog("Edit domain");
			await dialog.getByLabel("Description").fill("Harbor office and loading bay");
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Domain updated")).toBeVisible();
			await expect(scene.page.getByText("Harbor office and loading bay").first()).toBeVisible();
		},
		async SAVE_DOMAIN_FAILS(scene) {
			const hold = await scene.hold(method("update_domain"));
			await hold.abort(500);
			const dialog = scene.dialog("Edit domain");
			await dialog.getByLabel("Description").fill("Harbor office and loading bay");
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(dialog.getByText("Something went wrong")).toBeVisible();
		},
		async DISABLE_DOMAIN(scene) {
			await menuItem(scene, "Disable domain");
			await expect(scene.dialog("Disable this domain?")).toBeVisible();
		},
		async CONFIRM_DISABLE_DOMAIN(scene) {
			await scene.dialog("Disable this domain?").getByRole("button", { name: "Disable domain" }).click();
			await expect(scene.toast("Domain disabled")).toBeVisible();
			await expect(scene.page.getByRole("dialog")).toHaveCount(0);
		},
		async DELETE_DOMAIN(scene) {
			await menuItem(scene, "Delete domain");
			await expect(scene.dialog("Delete this domain?")).toBeVisible();
		},
		async CONFIRM_DELETE_DOMAIN(scene) {
			await scene.dialog("Delete this domain?").getByRole("button", { name: "Delete domain" }).click();
			await expect(scene.toast("Domain deleted")).toBeVisible();
			await expect(scene.page).toHaveURL(/\/admin\/mail\/domains$/);
			await expect(scene.page.getByText(names.get(scene).pending)).toHaveCount(0);
		},

		async OPEN_GROUPS(scene) {
			await adminNav(scene.page).getByRole("link", { name: "Groups" }).click();
			await expect(scene.page.getByText("No groups yet")).toBeVisible();
		},
		async OPEN_GROUPS_WITH_ONE(scene) {
			await seedGroup(scene, names.get(scene).group);
			await adminNav(scene.page).getByRole("link", { name: "Groups" }).click();
			await expect(scene.page.getByText(`${names.get(scene).group}@${LIVE}`)).toBeVisible();
		},
		async GROUPS_SLOW(scene) {
			await scene.hold(method("get_groups"));
			await reloadWaitingFor(scene, method("get_groups"));
		},
		async GROUPS_FAIL(scene) {
			const hold = await scene.hold(method("get_groups"));
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByText("Could not load groups").first()).toBeVisible();
		},
		async SEARCH_GROUPS_MISS(scene) {
			await scene.page.getByPlaceholder("Search").fill("lighthouse");
			await expect(scene.page.getByText("No matching groups")).toBeVisible();
		},
		async OPEN_ADD_GROUP(scene) {
			await headerButton(scene.page, "Add group").click();
			await expect(scene.dialog("Add group")).toBeVisible();
		},
		async FILL_GROUP(scene) {
			const dialog = scene.dialog("Add group");
			await dialog.getByLabel("Email address username").fill(names.get(scene).group);
			await pickOption(scene, dialog, LIVE);
			await dialog.getByLabel("Description").fill("Front desk and visitors");
			await expect(dialog.getByRole("button", { name: "Add group" })).toBeEnabled();
			scene.defer(() => quietly(scene, "delete_groups", { ids: [`${names.get(scene).group}@${LIVE}`] }));
		},
		async ADD_GROUP_SLOW(scene) {
			await scene.hold(method("add_group"));
			const sent = scene.page.waitForRequest((request) => method("add_group").test(request.url()));
			await scene.dialog("Add group").getByRole("button", { name: "Add group" }).click();
			await sent;
		},
		async ADD_GROUP(scene) {
			await scene.dialog("Add group").getByRole("button", { name: "Add group" }).click();
			await expect(scene.toast("Group added")).toBeVisible();
			await expect(scene.page.getByText("General information")).toBeVisible();
		},
		async ADD_TAKEN_GROUP(scene) {
			const taken = names.get(scene).group;
			await seedGroup(scene, taken);
			const dialog = scene.dialog("Add group");
			await dialog.getByLabel("Email address username").fill(taken);
			await pickOption(scene, dialog, LIVE);
			await dialog.getByRole("button", { name: "Add group" }).click();
			await expect(dialog.getByText(/already a Mail Group/)).toBeVisible();
		},
		async OPEN_GROUP_SLOW(scene) {
			await scene.hold(method("get_group"));
			await scene.page.getByText(`${names.get(scene).group}@${LIVE}`).click();
			await expect(scene.page).toHaveURL(/\/admin\/mail\/groups\/.+/);
		},
		async OPEN_GROUP(scene) {
			await scene.page.getByText(`${names.get(scene).group}@${LIVE}`).click();
			await expect(scene.page.getByText("General information")).toBeVisible();
		},
		async OPEN_GROUP_MORE(scene) {
			await openMore(scene);
			await expect(scene.page.getByRole("menuitem", { name: "Disable receiving" })).toBeVisible();
		},
		async EDIT_GROUP(scene) {
			await scene.page.getByRole("button", { name: "Edit", exact: true }).click();
			await expect(scene.dialog("Edit group")).toBeVisible();
		},
		async SAVE_GROUP(scene) {
			const dialog = scene.dialog("Edit group");
			await dialog.getByLabel("Description").fill("Front desk, visitors and deliveries");
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Group updated")).toBeVisible();
		},
		async OPEN_ADD_GROUP_EMAIL(scene) {
			await scene.page.getByRole("button", { name: "Add" }).first().click();
			await expect(scene.dialog("Add email address")).toBeVisible();
		},
		async ADD_GROUP_EMAIL(scene) {
			const dialog = scene.dialog("Add email address");
			const alias = `reception-${names.get(scene).stamp}`;
			await dialog.getByLabel("Email address username").fill(alias);
			await pickOption(scene, dialog, LIVE);
			await dialog.getByLabel("Description").fill("Reception");
			await dialog.getByRole("button", { name: "Add" }).click();
			await expect(scene.toast("Email address added")).toBeVisible();
			await expect(scene.page.getByText(`${alias}@${LIVE}`)).toBeVisible();
		},
		async OPEN_ADD_GROUP_MEMBERS(scene) {
			await scene.page.getByRole("button", { name: "Add" }).last().click();
			await expect(scene.dialog("Add members")).toBeVisible();
		},
		async DISABLE_RECEIVING(scene) {
			await menuItem(scene, "Disable receiving");
			await expect(scene.dialog("Disable receiving?")).toBeVisible();
		},
		async CONFIRM_RECEIVING(scene) {
			await scene.dialog("Disable receiving?").getByRole("button", { name: "Disable receiving" }).click();
			await expect(scene.toast("Receiving disabled")).toBeVisible();
		},
		async DELETE_GROUP(scene) {
			await menuItem(scene, "Delete group");
			await expect(scene.dialog("Delete this group?")).toBeVisible();
		},
		async CONFIRM_DELETE_GROUP(scene) {
			await scene.dialog("Delete this group?").getByRole("button", { name: "Delete group" }).click();
			await expect(scene.toast("Group deleted")).toBeVisible();
			await expect(scene.page).toHaveURL(/\/admin\/mail\/groups$/);
		},

		async OPEN_LISTS(scene) {
			await adminNav(scene.page).getByRole("link", { name: "Mailing lists" }).click();
			await expect(scene.page.getByText("No mailing lists yet")).toBeVisible();
		},
		async OPEN_LISTS_WITH_ONE(scene) {
			await seedList(scene, names.get(scene).list);
			await adminNav(scene.page).getByRole("link", { name: "Mailing lists" }).click();
			await expect(scene.page.getByText(`${names.get(scene).list}@${LIVE}`)).toBeVisible();
		},
		async LISTS_SLOW(scene) {
			await scene.hold(method("get_mailing_lists"));
			await reloadWaitingFor(scene, method("get_mailing_lists"));
		},
		async LISTS_FAIL(scene) {
			const hold = await scene.hold(method("get_mailing_lists"));
			await hold.abort(500);
			await scene.page.reload();
			await expect(scene.page.getByText("Could not load mailing lists").first()).toBeVisible();
		},
		async SEARCH_LISTS_MISS(scene) {
			await scene.page.getByPlaceholder("Search").fill("lighthouse");
			await expect(scene.page.getByText("No matching mailing lists")).toBeVisible();
		},
		async OPEN_ADD_LIST(scene) {
			await headerButton(scene.page, "Add mailing list").click();
			await expect(scene.dialog("Add mailing list")).toBeVisible();
		},
		async FILL_LIST(scene) {
			const dialog = scene.dialog("Add mailing list");
			await dialog.getByLabel("Email address username").fill(names.get(scene).list);
			await pickOption(scene, dialog, LIVE);
			await dialog.getByLabel("Description").fill("Quarterly news for the whole company");
			const recipients = dialog.getByLabel("Recipients");
			for (const address of ["leo@northwind.test", "nisha@northwind.test"]) {
				await recipients.fill(address);
				await recipients.press("Enter");
			}
			await expect(dialog.getByRole("button", { name: "Add mailing list" })).toBeEnabled();
			scene.defer(() => quietly(scene, "delete_mailing_lists", { ids: [`${names.get(scene).list}@${LIVE}`] }));
		},
		async ADD_LIST_SLOW(scene) {
			await scene.hold(method("add_mailing_list"));
			const sent = scene.page.waitForRequest((request) => method("add_mailing_list").test(request.url()));
			await scene.dialog("Add mailing list").getByRole("button", { name: "Add mailing list" }).click();
			await sent;
		},
		async ADD_LIST(scene) {
			await scene.dialog("Add mailing list").getByRole("button", { name: "Add mailing list" }).click();
			await expect(scene.page).toHaveURL(/\/admin\/mail\/mailing-lists\/.+/);
			await expect(scene.page.getByText("Recipients").first()).toBeVisible();
		},
		async ADD_TAKEN_LIST(scene) {
			const taken = names.get(scene).list;
			await seedList(scene, taken);
			const dialog = scene.dialog("Add mailing list");
			await dialog.getByLabel("Email address username").fill(taken);
			await pickOption(scene, dialog, LIVE);
			await dialog.getByRole("button", { name: "Add mailing list" }).click();
			await expect(dialog.getByText(/already a Mailing List/)).toBeVisible();
		},
		async OPEN_LIST_SLOW(scene) {
			await scene.hold(method("get_mailing_list"));
			await scene.page.getByText(`${names.get(scene).list}@${LIVE}`).click();
			await expect(scene.page).toHaveURL(/\/admin\/mail\/mailing-lists\/.+/);
		},
		async OPEN_LIST(scene) {
			await scene.page.getByText(`${names.get(scene).list}@${LIVE}`).click();
			await expect(scene.page.getByText("leo@northwind.test")).toBeVisible();
		},
		async EDIT_LIST(scene) {
			await scene.page.getByRole("button", { name: "Edit", exact: true }).click();
			await expect(scene.dialog("Edit mailing list")).toBeVisible();
		},
		async SAVE_LIST(scene) {
			const dialog = scene.dialog("Edit mailing list");
			await dialog.getByLabel("Description").fill("Monthly news for the whole company");
			await dialog.getByRole("button", { name: "Save" }).click();
			await expect(scene.toast("Mailing list updated")).toBeVisible();
		},
		async OPEN_ADD_LIST_EMAIL(scene) {
			await scene.page.getByRole("button", { name: "Add" }).first().click();
			await expect(scene.dialog("Add email address")).toBeVisible();
		},
		async ADD_LIST_EMAIL(scene) {
			const dialog = scene.dialog("Add email address");
			const alias = `news-${names.get(scene).stamp}`;
			await dialog.getByLabel("Email address username").fill(alias);
			await pickOption(scene, dialog, LIVE);
			await dialog.getByLabel("Description").fill("Company news");
			await dialog.getByRole("button", { name: "Add" }).click();
			await expect(scene.toast("Email address added")).toBeVisible();
			await expect(scene.page.getByText(`${alias}@${LIVE}`)).toBeVisible();
		},
		async OPEN_ADD_RECIPIENTS(scene) {
			await scene.page.getByRole("button", { name: "Add" }).last().click();
			await expect(scene.dialog("Add recipients")).toBeVisible();
		},
		async ADD_RECIPIENT(scene) {
			const dialog = scene.dialog("Add recipients");
			// Left as typed, not a chip yet: leaving the field for Add turns it into one.
			await dialog.getByLabel("Recipients").fill("theo@northwind.test");
			await dialog.getByRole("button", { name: "Add", exact: true }).click();
			await expect(scene.toast("Recipients added")).toBeVisible();
			await expect(scene.page.getByText("theo@northwind.test")).toBeVisible();
		},
		async OPEN_LIST_MORE(scene) {
			await openMore(scene);
			await expect(scene.page.getByRole("menuitem", { name: "Delete mailing list" })).toBeVisible();
		},
		async DELETE_LIST(scene) {
			await menuItem(scene, "Delete mailing list");
			await expect(scene.dialog("Delete this mailing list?")).toBeVisible();
		},
		async CONFIRM_DELETE_LIST(scene) {
			await scene.dialog("Delete this mailing list?").getByRole("button", { name: "Delete mailing list" }).click();
			await expect(scene.toast("Mailing list deleted")).toBeVisible();
			await expect(scene.page).toHaveURL(/\/admin\/mail\/mailing-lists$/);
		},
	},
	settle: {
		async exportMenu(scene) {
			await expect(scene.page.getByRole("menuitem", { name: "JSON" })).toBeVisible();
		},
	},
});
