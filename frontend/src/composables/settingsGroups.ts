import { computed, type Ref } from 'vue'

/**
 * What a settings list renders, and what it can still find.
 *
 * Both apps' lists take an `exclude` — the Profile page drops the Profile row,
 * because the identity card at the top of it is what leads there — and both
 * still have to open an excluded tab from somewhere, so `findTab` resolves
 * against the whole list. Conditions still apply: a tab the account cannot
 * have is in neither.
 */
export const settingsGroups = <T extends { value: string }, G extends { items: T[] }>(
	allGroups: Ref<G[]>,
	exclude: string[],
) => {
	const groups = computed(() =>
		allGroups.value
			.map((group) => ({ ...group, items: group.items.filter((tab) => !exclude.includes(tab.value)) }))
			.filter((group) => group.items.length),
	)

	const findTab = (value: string) =>
		allGroups.value.flatMap((group) => group.items).find((tab) => tab.value === value)

	return { groups, findTab }
}
