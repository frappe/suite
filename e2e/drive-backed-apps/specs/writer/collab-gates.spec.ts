import type { Route } from "@playwright/test";
import { expect, test } from "../../fixtures/test";
import {
	expectConverged,
	expectSaved,
	holdDocument,
	openForCollab,
	quarantineLast,
	releaseDocument,
	serverBlocks,
	typeParagraph,
	writeNewerSchema,
} from "../../helpers/collab";
import { discardNode } from "../../helpers/drive";
import {
	createWriterDocument,
	openWriterDocument,
	uniqueWriterTitle,
	writerEditor,
} from "../../helpers/writer";

test.describe("Writer collaboration", () => {
	let node = "";
	let title = "";

	test.beforeEach(async ({ owner, collaborator, run, testApi }, testInfo) => {
		title = uniqueWriterTitle(run.run_id, `collab ${testInfo.title}`);
		node = (await createWriterDocument(owner.page.request, title)).name;
		await openForCollab(testApi, owner.page.request, node, collaborator.user.user);
	});

	test.afterEach(async ({ owner }) => {
		await discardNode(owner.context.request, node);
	});

	test("a tab older than the minimum Writer build opens read-only", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		// Only this tab is told its build is too old; the site setting would reach every spec
		async function askForNewerBuild(route: Route) {
			const response = await route.fetch();
			const headers = {
				...response.headers(),
				"x-suite-min-builds": JSON.stringify({ writer: "99999999999999" }),
			};
			await route.fulfill({ response, headers });
		}

		await collaborator.context.route("**/api/**", askForNewerBuild);
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);

		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "false");
		await writerEditor(collaborator.page).click();
		await collaborator.page.keyboard.type("Typed in the old tab");
		await expect(writerEditor(collaborator.page)).not.toContainText("Typed in the old tab");

		await typeParagraph(owner.page, "Typed in the current tab");
		await expectSaved(owner.page);
		const blocks = await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Typed in the current tab"],
		);
		expect(blocks.join("\n")).not.toContain("Typed in the old tab");
		await collaborator.context.unrouteAll({ behavior: "ignoreErrors" });
	});

	test("a tab that can't apply a change the server judges clean stops editing, and the others go on", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		test.setTimeout(300_000);
		// Only this browser fails to read one character, as an older browser might
		function failOnSectionSign() {
			const originalDecode = TextDecoder.prototype.decode;
			TextDecoder.prototype.decode = function (
				this: TextDecoder,
				...args: Parameters<TextDecoder["decode"]>
			) {
				const text = originalDecode.apply(this, args);
				if (text.includes("\u00a7")) {
					throw new TypeError("This browser can't read the text");
				}

				return text;
			};
		}

		await owner.page.addInitScript(failOnSectionSign);
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);

		await typeParagraph(collaborator.page, "Marked \u00a7 here");
		await expectSaved(collaborator.page);

		// Each failed open asks again, a minute apart, until three clean verdicts stop this tab
		await expect(
			owner.page.getByText("This document can't be edited in this browser version."),
		).toBeVisible({ timeout: 240_000 });
		await expect(writerEditor(owner.page)).toHaveAttribute("contenteditable", "false");
		await typeParagraph(collaborator.page, "Still saving");
		await expectConverged(
			testApi,
			node,
			[collaborator.page],
			["Marked \u00a7 here", "Still saving"],
		);
	});

	test("a document held for an admin is read-only for everyone until it is released", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		await typeParagraph(owner.page, "Before the hold");
		await expectSaved(owner.page);

		await holdDocument(testApi, node, "checker_failed");
		for (const page of [owner.page, collaborator.page]) {
			await expect(
				page.getByText("This document is read-only while an admin checks it."),
			).toBeVisible();
			await expect(writerEditor(page)).toHaveAttribute("contenteditable", "false");
		}

		await releaseDocument(testApi, node);
		await holdDocument(testApi, node, "bad_checkpoint");
		await expect(
			owner.page.getByText("This document is read-only while an admin checks it."),
		).toBeVisible();

		await releaseDocument(testApi, node);
		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "true");
		await expect(owner.page.getByText("read-only while an admin checks")).toBeHidden();
		await typeParagraph(collaborator.page, "After the release");
		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Before the hold", "After the release"],
		);
	});

	test("a quarantined change leaves every tab, and the writer's typing after it is kept aside", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		await openWriterDocument(owner.page, node);
		await openWriterDocument(collaborator.page, node);
		await typeParagraph(owner.page, "Kept line");
		await expectSaved(owner.page);
		await typeParagraph(collaborator.page, "Bad line");
		await expectSaved(collaborator.page);
		await expect(writerEditor(owner.page)).toContainText("Bad line");

		// Held pulls let the collaborator's next push be the one that learns its session was closed
		let letPullsThrough = () => {};

		const pullsHeld = new Promise<void>((resolve) => {
			letPullsThrough = resolve;
		});
		async function holdPulls(route: Route) {
			if (route.request().method() === "GET") {
				await pullsHeld;
			}

			await route.fallback();
		}

		await collaborator.page.route("**/api/suite/content/*/updates**", holdPulls);
		await quarantineLast(testApi, node, "checker_failed");
		await expect(writerEditor(owner.page)).not.toContainText("Bad line");

		await typeParagraph(collaborator.page, "After the cut");
		await expect(
			collaborator.page.getByText(
				"Your last edits couldn't be saved here and were kept as a recovery copy.",
			),
		).toBeVisible();
		letPullsThrough();
		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "true");
		await expectConverged(testApi, node, [owner.page, collaborator.page], ["Kept line"]);
	});

	test("a document a newer Writer edited is read-only here and asks for a reload", async ({
		owner,
		collaborator,
		testApi,
	}) => {
		const banner = "This document was edited in a newer version of Writer. Reload to edit it.";
		await openWriterDocument(owner.page, node);
		await typeParagraph(owner.page, "Before the newer Writer");
		await expectSaved(owner.page);

		await writeNewerSchema(testApi, node);
		// The hook writes no row to hear live, so the tab pulls as it does on coming back online
		await owner.page.evaluate(() => window.dispatchEvent(new Event("online")));
		await expect(owner.page.getByText(banner)).toBeVisible();
		await expect(writerEditor(owner.page)).toHaveAttribute("contenteditable", "false");

		await openWriterDocument(collaborator.page, node);
		await expect(collaborator.page.getByText(banner)).toBeVisible();
		await expect(writerEditor(collaborator.page)).toHaveAttribute("contenteditable", "false");
		await expectConverged(
			testApi,
			node,
			[owner.page, collaborator.page],
			["Before the newer Writer"],
		);
	});
});
