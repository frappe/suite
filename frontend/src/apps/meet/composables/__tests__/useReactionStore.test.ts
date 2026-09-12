import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReactionStore } from "../useReactionStore";

describe("useReactionStore", () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("cancels pending reaction timers when reset", () => {
		const store = useReactionStore();
		store.showReactionForUser("user-1", "old", 1000);

		store.$reset();
		store.showReactionForUser("user-1", "new", 2000);
		vi.advanceTimersByTime(1000);

		expect(store.reactions["user-1"]?.emoji).toBe("new");
	});
});
