import { type ComputedRef, computed, onMounted, onUnmounted, ref } from "vue";

interface UseResponsiveGridReturn {
	isMobile: ComputedRef<boolean>;
	maxColumns: ComputedRef<number>;
	sidebarMaxColumns: ComputedRef<number>;
}

export function useResponsiveGrid(): UseResponsiveGridReturn {
	const isMedium = ref(window.matchMedia("(min-width: 768px)").matches);
	const isLarge = ref(window.matchMedia("(min-width: 1024px)").matches);
	let mediaQueries: MediaQueryList[] = [];

	const updateBreakpoints = (): void => {
		isMedium.value = window.matchMedia("(min-width: 768px)").matches;
		isLarge.value = window.matchMedia("(min-width: 1024px)").matches;
	};

	onMounted(() => {
		mediaQueries = [
			window.matchMedia("(min-width: 768px)"),
			window.matchMedia("(min-width: 1024px)"),
		];
		updateBreakpoints();
		for (const query of mediaQueries) {
			query.addEventListener("change", updateBreakpoints);
		}
	});

	onUnmounted(() => {
		for (const query of mediaQueries) {
			query.removeEventListener("change", updateBreakpoints);
		}
	});

	const isMobile = computed(() => !isMedium.value);

	const maxColumns = computed<number>(() => {
		if (isLarge.value) return 4;
		if (isMedium.value) return 3;
		return 2;
	});

	const sidebarMaxColumns = computed<number>(() => (isMobile.value ? 1 : 2));

	return {
		isMobile,
		maxColumns,
		sidebarMaxColumns,
	};
}
