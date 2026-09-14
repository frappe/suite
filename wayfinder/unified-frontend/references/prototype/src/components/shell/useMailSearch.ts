// What is typed into Mail's search box.
//
// It lives here rather than in MailArea because the box and the list it
// filters are now in different components: the input sits at the top of the
// mail panel, above Inbox, and the thread list reads the same ref from the
// pane beside it.
import { ref } from 'vue'

export const mailSearch = ref('')
