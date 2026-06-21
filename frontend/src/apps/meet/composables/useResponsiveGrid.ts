import {
	type ComputedRef,
	computed,
	onMounted,
	onUnmounted,
	type Ref,
	ref,
} from "vue";

type AvatarSizeTier = "xs" | "sm" | "md" | "lg";

interface Breakpoints {
	sm: number;
	md: number;
	lg: number;
	xl: number;
}

interface UseResponsiveGridReturn {
	windowWidth: Ref<number>;
	maxColumns: ComputedRef<number>;
	sidebarMaxColumns: ComputedRef<number>;
	avatarSizeTier: ComputedRef<AvatarSizeTier>;
	BREAKPOINTS: Readonly<Breakpoints>;
}

/**
 * Composable for responsive grid layout based on screen width
 * Returns the maximum number of columns allowed for the current viewport
 */
export function useResponsiveGrid(): UseResponsiveGridReturn {
	const BREAKPOINTS: Readonly<Breakpoints> = {
		sm: 640,
		md: 768,
		lg: 1024,
		xl: 1280,
	} as const;

	const windowWidth = ref<number>(window.innerWidth || 1280);

	const updateWidth = (): void => {
		windowWidth.value = window.innerWidth;
	};

	onMounted(() => {
		window.addEventListener("resize", updateWidth);
	});

	onUnmounted(() => {
		window.removeEventListener("resize", updateWidth);
	});

	// Mobile: min 2 columns, Tablet: max 3 columns, Desktop: max 4 columns
	const maxColumns = computed<number>(() => {
		if (windowWidth.value < BREAKPOINTS.sm) {
			return 2;
		}
		if (windowWidth.value < BREAKPOINTS.md) {
			return 2;
		}
		if (windowWidth.value < BREAKPOINTS.lg) {
			return 3;
		}
		return 4;
	});

	// For sidebar during screen share
	// Mobile: max 1 column, Tablet: max 2 columns
	const sidebarMaxColumns = computed<number>(() => {
		if (windowWidth.value < BREAKPOINTS.md) {
			return 1;
		}
		return 2;
	});

	const avatarSizeTier = computed<AvatarSizeTier>(() => {
		if (windowWidth.value < BREAKPOINTS.sm) {
			return "xs";
		}
		if (windowWidth.value < BREAKPOINTS.md) {
			return "sm";
		}
		if (windowWidth.value < BREAKPOINTS.lg) {
			return "md";
		}
		return "lg";
	});

	return {
		windowWidth,
		maxColumns,
		sidebarMaxColumns,
		avatarSizeTier,
		BREAKPOINTS,
	};
}
