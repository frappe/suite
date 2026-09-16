import { ref } from 'vue'

// The view switcher is opened from two places — the header's hamburger and a
// re-tap of the Calendar tab, which live in different trees — so the sheet is
// mounted once by the tab bar and its open state is shared here. Mail shares
// its folder sheet the same way.
const isViewSheetOpen = ref(false)

export const useViewSheet = () => {
	const openViewSheet = () => (isViewSheetOpen.value = true)
	const closeViewSheet = () => (isViewSheetOpen.value = false)

	return { isViewSheetOpen, openViewSheet, closeViewSheet }
}
