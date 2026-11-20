import { ref } from 'vue'

import { translate } from '@/boot/translation'
import { onTransportFailure } from '@/platform/transport'

/** An outage remains visible until the person explicitly reloads Mail. */
export const mailServerUnavailable = ref(false)
onTransportFailure((error) => {
  if (error.type !== 'MailServerUnavailableError') return
  error.message = translate(
    'The mail server is temporarily unavailable. Please try again in a few minutes.',
  )
  mailServerUnavailable.value = true
})
