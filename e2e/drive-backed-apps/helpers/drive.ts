import {
	expect,
	type APIRequestContext,
	type APIResponse,
	type Locator,
	type Page,
} from "@playwright/test";
import type {
	NodeChildrenOutput,
	NodeCreateCreateDocumentInput,
	NodeCreateCreateFolderInput,
	NodeDeleteGrantOutput,
	NodeGetOutput,
	NodeGrantsOutput,
	NodePatchMoveInput,
	NodePatchRenameInput,
	NodePatchRestoreInput,
	NodePatchTrashInput,
	NodePurgeOutput,
	NodePutGrantInput,
	NodePutGrantOutput,
	NotificationsListOutput,
	RootsDiscoverOutput,
	UploadCreateInput,
	UploadCreateOutput,
	UploadFinishInput,
	UploadFinishOutput,
	ViewListOutput,
} from "../../../frontend/src/apps/drive/client/generated";

/** The Drive HTTP API (`suite/drive/http/`), as `frontend/src/apps/drive/client/contract.json` describes it. */
export const DRIVE = "/api/suite/drive";

/** Drive roles (§5). A grant carries one of these as `role`; `0` is an explicit deny. */
export const ROLE = {
	NONE: 0,
	READ: 10,
	COMMENT: 20,
	UPLOAD: 30,
	EDIT: 40,
	MANAGE: 50,
} as const;

export type DriveNode = NodeGetOutput;
export type DriveGrant = NodePutGrantOutput;
export type DriveNotification = NotificationsListOutput["rows"][number];

type Method = "get" | "post" | "patch" | "put" | "delete";

/** The generated input types carry the path parameters too; a request body leaves them out. */
type Body<Input, PathParams extends keyof Input> = Omit<Input, PathParams>;

async function unwrap<T>(response: APIResponse, what: string): Promise<T> {
	const text = await response.text();
	if (!response.ok()) {
		throw new Error(`${what} failed with ${response.status()}: ${text}`);
	}
	const parsed = JSON.parse(text) as { data?: T; message?: T };
	return (parsed.data ?? parsed.message) as T;
}

/**
 * One call to the Drive API; throws on any non-2xx answer.
 *
 * A write that two workers make at the same time can deadlock in MariaDB, which
 * Frappe reports as 508 without retrying (tracker B86). The call is repeated once
 * so that product issue does not fail an unrelated test; the warning keeps it visible.
 */
async function driveRequest<T>(
	request: APIRequestContext,
	method: Method,
	path: string,
	body?: unknown,
): Promise<T> {
	const send = () =>
		request[method](`${DRIVE}/${path}`, body === undefined ? undefined : { data: body });
	let response = await send();
	if (response.status() === 508 && (await response.text()).includes("QueryDeadlockError")) {
		console.warn(`B86: ${method.toUpperCase()} ${DRIVE}/${path} deadlocked; retrying once`);
		response = await send();
	}
	return unwrap<T>(response, `${method.toUpperCase()} ${DRIVE}/${path}`);
}

/** The caller's Personal root: where a spec's nodes go when it names no parent. */
async function personalRoot(request: APIRequestContext): Promise<string> {
	const roots = await driveRequest<RootsDiscoverOutput>(request, "get", "roots");
	return roots.personal.node;
}

/** A name no other run or spec produces, so listings can be matched on it alone. */
export function uniqueName(runId: string, label: string, extension = ""): string {
	return `${label}-${runId}-${Date.now().toString(36)}${extension}`;
}

// ---------------------------------------------------------------------------
// Nodes

export async function createFolder(
	request: APIRequestContext,
	title: string,
	parent?: string,
): Promise<DriveNode> {
	const body: NodeCreateCreateFolderInput = {
		kind: "folder",
		parent_node: parent ?? (await personalRoot(request)),
		title,
	};
	return driveRequest<DriveNode>(request, "post", "nodes", body);
}

/** A native document (Writer, Sheets, …) of `contentDoctype`, inside `parent` or the Personal root. */
export async function createDocument(
	request: APIRequestContext,
	title: string,
	contentDoctype: string,
	parent?: string,
): Promise<DriveNode> {
	const body: NodeCreateCreateDocumentInput = {
		kind: "document",
		parent_node: parent ?? (await personalRoot(request)),
		title,
		content_doctype: contentDoctype,
	};
	return driveRequest<DriveNode>(request, "post", "nodes", body);
}

/** Upload `content` as a file named `title` through the three-step upload (§6): create, chunk, finish. */
export async function uploadFile(
	request: APIRequestContext,
	title: string,
	content: Buffer,
	parent?: string,
	mime = "text/plain",
): Promise<DriveNode> {
	const parentNode = parent ?? (await personalRoot(request));
	const create: UploadCreateInput = {
		parent_node: parentNode,
		filename: title,
		size: content.byteLength,
		mime,
	};
	const upload = await driveRequest<UploadCreateOutput>(request, "post", "uploads", create);
	if (upload.mode !== "chunked") {
		throw new Error(`Direct uploads are not supported by this helper (upload ${upload.upload_id})`);
	}
	const chunk = await request.put(`${DRIVE}/uploads/${upload.upload_id}/chunk?offset=0`, {
		data: content,
		headers: { "content-type": "application/octet-stream" },
	});
	await unwrap(chunk, `PUT ${DRIVE}/uploads/${upload.upload_id}/chunk`);
	const finish: Body<UploadFinishInput, "upload_id"> = { parent_node: parentNode, title };
	return driveRequest<UploadFinishOutput>(
		request,
		"post",
		`uploads/${upload.upload_id}/finish`,
		finish,
	);
}

/** One node with the caller's effective role; Drive answers 404 for a node it withholds (§5.4). */
export async function getNode(
	request: APIRequestContext,
	node: string,
	expand = "access",
): Promise<DriveNode> {
	return driveRequest<DriveNode>(request, "get", `nodes/${node}?expand=${expand}`);
}

/** Whether the caller may read `node`. */
export async function canReadNode(request: APIRequestContext, node: string): Promise<boolean> {
	const response = await request.get(`${DRIVE}/nodes/${node}`);
	return response.ok();
}

/** The caller's role on `node`, `ROLE.NONE` when it is withheld. */
export async function roleOn(request: APIRequestContext, node: string): Promise<number> {
	const response = await request.get(`${DRIVE}/nodes/${node}?expand=access`);
	if (!response.ok()) return ROLE.NONE;
	const parsed = (await response.json()) as { data?: DriveNode; message?: DriveNode };
	return (parsed.data ?? parsed.message)?.access?.role ?? ROLE.NONE;
}

/** The active children of `parent`, or of the caller's Personal root. */
async function children(request: APIRequestContext, parent?: string): Promise<DriveNode[]> {
	const node = parent ?? (await personalRoot(request));
	const page = await driveRequest<NodeChildrenOutput>(request, "get", `nodes/${node}/children`);
	return page.rows;
}

/** Poll until a child titled `title` is listed in `parent`; returns it. */
export async function waitForChild(
	request: APIRequestContext,
	title: string,
	parent?: string,
): Promise<DriveNode> {
	let found: DriveNode | undefined;
	await expect
		.poll(async () => {
			found = (await children(request, parent)).find((row) => row.title === title);
			return found?.name;
		})
		.toBeTruthy();
	return found as DriveNode;
}

/** Poll until no child titled `title` is listed in `parent`. */
export async function expectChildAbsent(
	request: APIRequestContext,
	title: string,
	parent?: string,
): Promise<void> {
	await expect
		.poll(async () => (await children(request, parent)).some((row) => row.title === title))
		.toBe(false);
}

export async function moveNode(request: APIRequestContext, node: string, parent: string): Promise<void> {
	const body: Body<NodePatchMoveInput, "node"> = { parent_node: parent };
	await driveRequest(request, "patch", `nodes/${node}`, body);
}

export async function trashNode(request: APIRequestContext, node: string): Promise<void> {
	const body: Body<NodePatchTrashInput, "node"> = { state: "Trashed" };
	await driveRequest(request, "patch", `nodes/${node}`, body);
}

export async function restoreNode(request: APIRequestContext, node: string): Promise<void> {
	const body: Body<NodePatchRestoreInput, "node"> = { state: "Active" };
	await driveRequest(request, "patch", `nodes/${node}`, body);
}

/** Permanent removal of a trashed node (§8.8). */
export async function purgeNode(request: APIRequestContext, node: string): Promise<number> {
	const answer = await driveRequest<NodePurgeOutput>(request, "delete", `nodes/${node}`);
	return answer.count;
}

/** Trash and purge `node` so a spec leaves nothing behind. Errors are swallowed: cleanup must not fail a test. */
export async function discardNode(request: APIRequestContext, node: string): Promise<void> {
	try {
		await trashNode(request, node);
		await purgeNode(request, node);
	} catch {
		// Already gone, or trashed by the test itself.
		await request.delete(`${DRIVE}/nodes/${node}`);
	}
}

/** The node rows of a saved view (`shared`, `recents`, `favourites`, `trash`, `search`); the quota rows of `roots` are left out. */
export async function view(
	request: APIRequestContext,
	name: string,
	query: Record<string, string> = {},
): Promise<DriveNode[]> {
	const search = new URLSearchParams(query).toString();
	const page = await driveRequest<ViewListOutput>(
		request,
		"get",
		`views/${name}${search ? `?${search}` : ""}`,
	);
	return page.rows.filter((item): item is DriveNode => "name" in item);
}

export async function notifications(request: APIRequestContext): Promise<DriveNotification[]> {
	const page = await driveRequest<NotificationsListOutput>(request, "get", "notifications");
	return page.rows;
}

// ---------------------------------------------------------------------------
// Grants

/** Write one grant (§5.9). `role: 0` is an explicit deny; `$PUBLIC` publishes, capped at Read. */
export async function grantAccess(
	request: APIRequestContext,
	node: string,
	principal: string,
	role: number,
	options: Partial<Body<NodePutGrantInput, "node" | "principal" | "role">> = {},
): Promise<DriveGrant> {
	const body: Body<NodePutGrantInput, "node" | "principal"> = { role, ...options };
	return driveRequest<DriveGrant>(
		request,
		"put",
		`nodes/${node}/grants/${encodeURIComponent(principal)}`,
		body,
	);
}

/** Remove one principal's local grant. Access inherited from an ancestor survives (§5.10). */
export async function revokeAccess(
	request: APIRequestContext,
	node: string,
	principal: string,
): Promise<number> {
	const answer = await driveRequest<NodeDeleteGrantOutput>(
		request,
		"delete",
		`nodes/${node}/grants/${encodeURIComponent(principal)}`,
	);
	return answer.count;
}

/** The local grants on `node`, as the share dialog lists them. */
export async function listGrants(
	request: APIRequestContext,
	node: string,
): Promise<NodeGrantsOutput["grants"]> {
	const answer = await driveRequest<NodeGrantsOutput>(request, "get", `nodes/${node}/grants`);
	return answer.grants;
}

/** Publish `node` for reading (`$PUBLIC` caps at Read, §5.9). */
export async function publishNode(request: APIRequestContext, node: string): Promise<DriveGrant> {
	return grantAccess(request, node, "$PUBLIC", ROLE.READ);
}

// ---------------------------------------------------------------------------
// The Files page (`frontend/src/apps/drive/files/pages/FilesPage.vue`)

/** The listing item for `node`, in the list or the grid presentation. */
export function row(page: Page, node: string): Locator {
	return page.locator(`[data-node="${node}"], [data-listing-item="${node}"]`);
}

/** Open the row menu of the item titled `title`, which carries the item's actions. */
export async function openRowMenu(page: Page, title: string): Promise<Locator> {
	await page.getByRole("button", { name: `Actions for ${title}`, exact: true }).click();
	const menu = page.getByRole("menu");
	await expect(menu).toBeVisible();
	return menu;
}

/** The labels of the items in the open row menu, then closes it. */
export async function rowMenuItems(page: Page, title: string): Promise<string[]> {
	const menu = await openRowMenu(page, title);
	const labels = await menu.getByRole("menuitem").allInnerTexts();
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();
	return labels.map((label) => label.trim());
}

/** The Drive sidebar link labelled `label` ("My files", "Trash", …), kept apart from a same-named breadcrumb. */
export function sidebarLink(page: Page, label: string): Locator {
	return page
		.getByRole("complementary", { name: "Drive" })
		.getByRole("link", { name: label, exact: true });
}

/**
 * Choose `item` from the New menu in the page header. The menu lists Create before
 * Upload, and "Folder" appears in both, so the first match is the create action.
 */
export async function chooseNew(page: Page, item: string): Promise<void> {
	await page.getByRole("button", { name: "New", exact: true }).click();
	await page.getByRole("menuitem", { name: item, exact: true }).first().click();
}

/** Move the item titled `title` into `destination` through the row menu and the folder picker. */
export async function moveViaPicker(page: Page, title: string, destination: string): Promise<void> {
	const menu = await openRowMenu(page, title);
	await menu.getByRole("menuitem", { name: "Move", exact: true }).click();
	const picker = page.getByRole("dialog", { name: "Move to" });
	await picker.getByRole("button", { name: destination, exact: true }).click();
	await picker.getByRole("button", { name: "Move here", exact: true }).click();
	await expect(picker).toBeHidden();
}

/** Create a folder through New › Folder and wait for it to be listed. */
export async function createFolderViaUi(page: Page, title: string): Promise<void> {
	await chooseNew(page, "Folder");
	const dialog = page.getByRole("dialog", { name: "New folder" });
	await dialog.getByRole("textbox", { name: "Name" }).fill(title);
	await dialog.getByRole("button", { name: "Create", exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole("button", { name: `Actions for ${title}`, exact: true })).toBeVisible();
}

/** Upload one file through New › Upload › Files and wait for the finish call. */
export async function uploadViaUi(
	page: Page,
	file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
	const [chooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		chooseNew(page, "Files"),
	]);
	const finished = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			/\/api\/suite\/drive\/uploads\/[^/]+\/finish/.test(response.url()),
	);
	await chooser.setFiles(file);
	const response = await finished;
	if (!response.ok()) throw new Error(`Upload finish failed: ${await response.text()}`);
}

/** The breadcrumb links in the visible Files page header, outermost first. */
export function breadcrumbs(page: Page): Locator {
	return page.locator("header").filter({ visible: true }).getByRole("link");
}

/** The breadcrumb trail as the user reads it. */
export async function trail(page: Page): Promise<string[]> {
	return (await breadcrumbs(page).allInnerTexts()).map((text) => text.trim()).filter(Boolean);
}
