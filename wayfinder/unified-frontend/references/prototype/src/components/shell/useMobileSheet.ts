// The sidebar's content (workspace switcher, plus folders, mailboxes or
// calendars depending on the area) lives in a BottomSheet on mobile. Areas
// open it through this shared ref instead of each owning a sheet of their own.
import { ref } from 'vue'

export const mobileSheetOpen = ref(false)
