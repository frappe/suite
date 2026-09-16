import { expect, test, type APIRequestContext } from "@playwright/test";

import { adminApi } from "../../helpers/drive";

/** Ticket 002: the theme is a platform concern and persists to User.desk_theme. */

async function readDeskTheme(api: APIRequestContext): Promise<string> {
	const response = await api.post("/api/v2/method/frappe.client.get_value", {
		data: { doctype: "User", fieldname: "desk_theme", filters: "Administrator" },
	});
	const body = (await response.json()) as { data?: { desk_theme?: string }; message?: { desk_theme?: string } };
	return (body.data ?? body.message)?.desk_theme ?? "";
}

async function writeDeskTheme(api: APIRequestContext, theme: string): Promise<void> {
	await api.post("/api/v2/method/frappe.core.doctype.user.user.switch_theme", { data: { theme } });
}

async function chooseAppearance(page: import("@playwright/test").Page, label: string): Promise<void> {
	const trigger = page.getByRole("dialog").getByRole("combobox").first();
	await expect(trigger).toBeVisible();
	await trigger.click();
	await page.getByRole("option", { name: label, exact: true }).click();
}

test("the appearance choice persists to desk_theme and survives a reload", async ({ page, baseURL }) => {
	const api = await adminApi(baseURL!);
	const original = (await readDeskTheme(api)) || "Light";

	try {
		await page.goto("/home");
		await page.getByRole("button", { name: "Settings", exact: true }).first().click();
		await page.getByRole("dialog").getByText("Preferences", { exact: true }).click();

		await chooseAppearance(page, "Dark");

		await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await expect.poll(() => readDeskTheme(api), { timeout: 10_000 }).toBe("Dark");

		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "dark");

		await page.getByRole("button", { name: "Settings", exact: true }).first().click();
		await page.getByRole("dialog").getByText("Preferences", { exact: true }).click();
		await chooseAppearance(page, "Automatic");
		await expect(page.locator("html")).toHaveAttribute("data-theme-mode", "automatic");
		await expect.poll(() => readDeskTheme(api), { timeout: 10_000 }).toBe("Automatic");
	} finally {
		await writeDeskTheme(api, original);
		await api.dispose();
	}
});
