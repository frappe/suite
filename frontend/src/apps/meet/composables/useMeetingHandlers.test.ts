import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { useMeetingHandlers } from "./useMeetingHandlers";

describe("useMeetingHandlers", () => {
	it("cleans up the failed manager before returning to preview", async () => {
		const cleanup = vi.fn().mockResolvedValue(undefined);
		const sfuManager = ref({ cleanup });
		const connectionState = {
			connectionError: "Recovery exhausted",
			isInPreview: false,
		};
		const handlers = useMeetingHandlers({
			connectionState,
			sfuConnection: { sfuManager },
		} as never);

		await handlers.resetToPreview();

		expect(cleanup).toHaveBeenCalledOnce();
		expect(sfuManager.value).toBeNull();
		expect(connectionState.connectionError).toBeNull();
		expect(connectionState.isInPreview).toBe(true);
	});
});
