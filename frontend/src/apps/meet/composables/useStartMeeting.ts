import { toast, useCall } from 'frappe-ui'
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { submit } from '../utils/request'
import { useConnectionState } from './useConnectionState'

type MeetingType = 'open' | 'restricted'

export const useStartMeeting = () => {
  const router = useRouter()
  const connectionState = useConnectionState()
  const createMeeting = useCall<{ code: string; url: string }, { type: MeetingType }>({
    url: '/api/suite/meet/rooms',
    method: 'POST',
    immediate: false,
  })

  const copyMeetingLink = (meetingCode: string) => {
    const path = router.resolve({
      name: 'meet-meeting',
      params: { meetingId: meetingCode },
    }).href
    navigator.clipboard.writeText(new URL(path, window.location.origin).href)
  }

  const startMeeting = async (meetingType: MeetingType) => {
    const creatingToastId = toast.loading('Creating meeting...')
    let meetingCode: string
    try {
      ;({ code: meetingCode } = await submit(createMeeting, { type: meetingType }))
    } catch (error) {
      toast.dismiss(creatingToastId)
      console.error('Error creating meeting:', error)
      toast.error('Failed to create meeting. Please try again.')
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
      toast.error('Meeting created, but could not open it.', {
        duration: 8000,
        action: {
          label: 'Copy link',
          onClick: () => copyMeetingLink(meetingCode),
        },
      })
      return
    }

    toast.success('Meeting created successfully!', {
      duration: 8000,
      action: {
        label: 'Copy link',
        onClick: () => copyMeetingLink(meetingCode),
      },
    })
  }

  return {
    isStartingMeeting: computed(() => createMeeting.loading),
    startMeeting,
  }
}
