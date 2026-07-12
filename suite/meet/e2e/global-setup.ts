import type { FullConfig } from "@playwright/test";

async function waitForService(url: string, name: string): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			const response = await fetch(url, { method: "GET" });
			if (response.ok || response.status < 500) {
				return;
			}
		} catch {}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	throw new Error(`${name} did not become ready: ${url}`);
}

export default async function globalSetup(config: FullConfig): Promise<void> {
	const projectUse = config.projects[0]?.use ?? {};
	const baseURL = String(
		projectUse.baseURL ?? process.env.BASE_URL ?? "http://localhost:8098",
	);
	const sfuBaseURL = process.env.SFU_URL ?? "http://localhost:3000";
	const sfuHealthURL = sfuBaseURL.endsWith("/health")
		? sfuBaseURL
		: `${sfuBaseURL.replace(/\/$/, "")}/health`;

	// Meetings are created per-test for worker isolation; only health-check here.
	await waitForService(baseURL, "Frappe Meet");
	await waitForService(sfuHealthURL, "SFU server");
}
