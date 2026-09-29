import { onMounted, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

export const ADD_QUERY = { add: '1' }

// A list page opened with ?add=1 (the overview's quick actions) shows its add dialog right
// away, then drops the flag from the URL so a reload or the back button does not reopen it.
export function useAddOnArrival(show: Ref<boolean>) {
	const route = useRoute()
	const router = useRouter()
	onMounted(() => {
		if (route.query.add !== '1') return
		show.value = true
		const { add: _add, ...query } = route.query
		router.replace({ query })
	})
}
