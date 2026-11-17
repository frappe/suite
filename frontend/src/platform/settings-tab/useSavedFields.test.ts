import { expect, it } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'

import { useSavedFields } from './useSavedFields'

type Regional = { locale: string; time_zone: string }

// A server that takes both fields at once, as Mail's regional preferences do. Each write waits for
// the test to answer it.
function setup() {
  const stored: Regional = { locale: 'en-US', time_zone: 'UTC' }
  const server = reactive({ data: stored })
  const sent: Regional[] = []
  const answers: { resolve: () => void; reject: (error: Error) => void }[] = []
  const fields = effectScope().run(() =>
    useSavedFields(
      () => server.data,
      (change) => (confirmed) => {
        sent.push({ ...confirmed, ...change })
        return new Promise<void>((resolve, reject) => answers.push({ resolve, reject }))
      },
    ),
  )!
  return { server, sent, answers, ...fields }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

it('does not send a change of one field with the save of another', async () => {
  const { sent, answers, shown, save } = setup()
  const locale = save('locale', 'fr-FR')
  const timeZone = save('time_zone', 'Europe/Paris')
  expect(shown.value).toEqual({ locale: 'fr-FR', time_zone: 'Europe/Paris' })
  answers[0]!.reject(new Error('Server refused'))
  await locale
  await settle()
  expect(sent[1]).toEqual({ locale: 'en-US', time_zone: 'Europe/Paris' })
  answers[1]!.resolve()
  await timeZone
  expect(shown.value).toEqual({ locale: 'en-US', time_zone: 'Europe/Paris' })
})

it('sends a landed change of one field with the save of another', async () => {
  const { sent, answers, save } = setup()
  const locale = save('locale', 'fr-FR')
  void save('time_zone', 'Europe/Paris')
  answers[0]!.resolve()
  await locale
  await settle()
  expect(sent[1]).toEqual({ locale: 'fr-FR', time_zone: 'Europe/Paris' })
})

it('keeps a change on its way when the server copy reloads', async () => {
  const { server, answers, shown, save } = setup()
  const locale = save('locale', 'fr-FR')
  server.data = { locale: 'en-US', time_zone: 'Asia/Kolkata' }
  await nextTick()
  expect(shown.value).toEqual({ locale: 'fr-FR', time_zone: 'Asia/Kolkata' })
  answers[0]!.reject(new Error('Server refused'))
  await locale
  expect(shown.value).toEqual({ locale: 'en-US', time_zone: 'Asia/Kolkata' })
})
