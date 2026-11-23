import { toast } from 'frappe-ui'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation } from '@/api'
import { translate as __ } from '@/platform/translation'

import { useConnectionState } from './useConnectionState'

type MeetingType = 'open' | 'restricted'

export const useStartMeeting = () => {
  const router = useRouter()
  const connectionState = useConnectionState()
  const createMeeting = useMutation(api.meet.rooms.create, { silent: true })

  const copyMeetingLink = (meetingCode: string) => {
    const path = router.resolve({
      name: 'meet-meeting',
      params: { meetingId: meetingCode },
    }).href
    navigator.clipboard.writeText(new URL(path, window.location.origin).href)
  }

  const startMeeting = async (meetingType: MeetingType) => {
    const creatingToastId = toast.loading(__('Creating meeting…'))
    let meetingCode: string
    try {
      ;({ code: meetingCode } = await createMeeting.run({ type: meetingType }))
    } catch (error) {
      toast.dismiss(creatingToastId)
      console.error('Error creating meeting:', error)
      toast.error(__('Could not create the meeting. Try again.'))
      return
    }

    toast.dismiss(creatingToastId)
    connectionState.justCreated = true
    try {
      await router.push({
        name: 'meet-meeting',
        params: { meetingId: meetingCode },
      })
    } catch (error) {
      console.error('Error opening meeting:', error)
      toast.error(__('Could not open the newly created meeting'), {
        duration: 8000,
        action: {
          label: __('Copy link'),
          onClick: () => copyMeetingLink(meetingCode),
        },
      })
      return
    }

    toast.success(__('Meeting created'), {
      duration: 8000,
      action: {
        label: __('Copy link'),
        onClick: () => copyMeetingLink(meetingCode),
      },
    })
  }

  return {
    isStartingMeeting: computed(() => createMeeting.isPending),
    startMeeting,
  }
}
