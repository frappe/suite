import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, nextTick, ref } from "vue";
import { useTileAdaptiveStreaming } from "../useTileAdaptiveStreaming";

class ResizeObserverStub {
	static instances: ResizeObserverStub[] = [];
	disconnect = vi.fn();
	observe = vi.fn();

	constructor(readonly callback: ResizeObserverCallback) {
		ResizeObserverStub.instances.push(this);
	}
}

class IntersectionObserverStub {
	static instances: IntersectionObserverStub[] = [];
	disconnect = vi.fn();
	observe = vi.fn();

	constructor(readonly callback: IntersectionObserverCallback) {
		IntersectionObserverStub.instances.push(this);
	}
}

function createManager(consumerId: string) {
	let listener: ((event: Event) => void) | null = null;
	const unsubscribe = vi.fn();
	return {
		getVideoConsumerId: vi.fn(() => consumerId),
		updateConsumerStreamPreferences: vi.fn().mockResolvedValue(undefined),
		onRemoteConsumerReady: vi.fn((nextListener: (event: Event) => void) => {
			listener = nextListener;
			return unsubscribe;
		}),
		getListener: () => listener,
		unsubscribe,
	};
}

function mountComposable(managerRef: ReturnType<typeof ref>) {
	let registerTile!: ReturnType<typeof useTileAdaptiveStreaming>["registerTile"];
	const app = createApp(
		defineComponent({
			setup() {
				({ registerTile } = useTileAdaptiveStreaming());
				return () => null;
			},
		}),
	);
	app.provide("sfuManager", managerRef);
	app.mount(document.createElement("div"));
	return { app, registerTile };
}

function visibleVideoElement() {
	const element = document.createElement("video");
	Object.defineProperties(element, {
		readyState: { configurable: true, value: 1 },
		clientWidth: { configurable: true, value: 640 },
		clientHeight: { configurable: true, value: 360 },
	});
	element.getBoundingClientRect = vi.fn(() => ({
		bottom: 360,
		height: 360,
		left: 0,
		right: 640,
		top: 0,
		width: 640,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	}));
	return element;
}

describe("useTileAdaptiveStreaming", () => {
	beforeEach(() => {
		ResizeObserverStub.instances = [];
		IntersectionObserverStub.instances = [];
		vi.stubGlobal("ResizeObserver", ResizeObserverStub);
		vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
		Object.defineProperties(window, {
			innerWidth: { configurable: true, value: 1280 },
			innerHeight: { configurable: true, value: 720 },
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("rebinds existing tiles and refreshes preferences when the manager changes", async () => {
		const firstManager = createManager("first-consumer");
		const secondManager = createManager("second-consumer");
		const managerRef = ref(firstManager);
		const { app, registerTile } = mountComposable(managerRef);
		registerTile("participant-1", visibleVideoElement());
		await nextTick();

		expect(firstManager.updateConsumerStreamPreferences).toHaveBeenCalledWith(
			"first-consumer",
			{ visible: true, width: 640, height: 360 },
		);

		managerRef.value = secondManager;
		await nextTick();
		await Promise.resolve();

		expect(firstManager.unsubscribe).toHaveBeenCalledOnce();
		expect(secondManager.onRemoteConsumerReady).toHaveBeenCalledOnce();
		expect(secondManager.updateConsumerStreamPreferences).toHaveBeenCalledWith(
			"second-consumer",
			{ visible: true, width: 640, height: 360 },
		);

		app.unmount();
	});

	it("cleans up the current manager listener and tile observers", () => {
		const manager = createManager("consumer-1");
		const { app, registerTile } = mountComposable(ref(manager));
		registerTile("participant-1", visibleVideoElement());

		app.unmount();

		expect(manager.unsubscribe).toHaveBeenCalledOnce();
		expect(ResizeObserverStub.instances[0]?.disconnect).toHaveBeenCalledOnce();
		expect(
			IntersectionObserverStub.instances[0]?.disconnect,
		).toHaveBeenCalledOnce();
	});
});
