import { expect, test } from "../../helpers/flips";

test("account menu opens and closes settings in the unified shell", async ({ page }) => {
	await page.goto("/drive");
	await page.getByRole("button", { name: "Account" }).click();
	await page.getByRole("menuitem", { name: "Settings" }).click();

	const settings = page.getByRole("dialog", { name: "Settings" });
	await expect(settings).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(settings).toBeHidden();
});
