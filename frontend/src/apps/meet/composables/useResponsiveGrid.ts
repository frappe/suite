import { useMediaQuery } from "@vueuse/core";
import { type ComputedRef, computed } from "vue";

interface UseResponsiveGridReturn {
	isMobile: ComputedRef<boolean>;
	maxColumns: ComputedRef<number>;
	sidebarMaxColumns: ComputedRef<number>;
}

export function useResponsiveGrid(): UseResponsiveGridReturn {
	const isMedium = useMediaQuery("(min-width: 768px)");
	const isLarge = useMediaQuery("(min-width: 1024px)");

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
