import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, provide, reactive, shallowRef } from 'vue'

import { provideMeetingContext } from '../composables/useMeetingContext'
import {
  automaticPictureInPicture,
  loadMediaPreferences,
  setAutomaticPictureInPicture,
} from '../data/mediaPreferences'
import MeetingPictureInPicture from './MeetingPictureInPicture.vue'

vi.mock('frappe-ui', () => ({
  Avatar: defineComponent({
    props: ['label', 'image'],
    setup: (props) => () => h('img', { alt: props.label, src: props.image }),
  }),
  Button: defineComponent({
    props: ['label'],
    emits: ['click'],
    setup:
      (props, { emit }) =>
      () =>
        h('button', { onClick: () => emit('click') }, props.label),
  }),
}))
class TestStream {
  constructor(private tracks: MediaStreamTrack[] = []) {}
  getTracks() {
    return [...this.tracks]
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
}
const track = (id: string) =>
  fromPartial<MediaStreamTrack>({
    id,
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(),
  })
function videoStream(video: HTMLVideoElement): TestStream {
  if (!(video.srcObject instanceof TestStream)) throw new Error('No video stream attached')
  return video.srcObject
}
const apps: ReturnType<typeof createApp>[] = []
let handlers: Map<string, (() => void) | null>
let setActionHandler: ReturnType<typeof vi.fn>
function fakeWindow() {
  const events = new EventTarget()
  const doc = document.implementation.createHTMLDocument('PiP')
  return {
    document: doc,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    close: vi.fn(() => events.dispatchEvent(new Event('pagehide'))),
  }
}
function mount(
  options: {
    active?: boolean
    requestWindow?: ReturnType<typeof vi.fn>
    remote?: MediaStreamTrack | null
    local?: MediaStreamTrack
    standard?: boolean
    webkit?: boolean
  } = {},
) {
  if (options.requestWindow)
    vi.stubGlobal('documentPictureInPicture', {
      requestWindow: options.requestWindow,
    })
  Object.defineProperty(document, 'pictureInPictureEnabled', {
    configurable: true,
    value: !!options.standard,
  })
  if (options.standard)
    Object.defineProperty(HTMLVideoElement.prototype, 'requestPictureInPicture', {
      configurable: true,
      value: vi.fn().mockResolvedValue({}),
    })
  if (options.webkit) {
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitSupportsPresentationMode', {
      configurable: true,
      value: () => true,
    })
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitSetPresentationMode', {
      configurable: true,
      value: vi.fn(),
    })
  }
  const state = reactive({
    active: options.active ?? true,
    micOn: true,
    cameraOn: true,
    isScreenSharing: false,
  })
  const participantStore = reactive({
    activeSpeakerIds: ['remote'],
    participants: {
      remote: { video_enabled: true, user_name: 'Remote speaker', avatar: '/remote-avatar.png' },
    },
  })
  const mediaState = reactive({
    isCameraOn: !!options.local,
    localStream: options.local ? new TestStream([options.local]) : null,
    processedStream: null,
    screenShareStream: fromPartial<TestStream | null>(null),
    screenShareStreams: fromPartial<Record<string, TestStream>>({}),
  })
  const pinnedTiles = shallowRef<{ type: 'participant' | 'screenshare'; id: string }[]>([])
  const displayScreenShares = shallowRef<{ source: 'remote' | 'local'; participantId: string }[]>(
    [],
  )
  const remote = shallowRef(options.remote ?? null)
  const manager = {
    getRemoteVideoTrack: vi.fn(() => remote.value),
    setPictureInPictureParticipant: vi.fn(),
  }
  const toggle = vi.fn()
  const toggleCamera = vi.fn()
  const share = vi.fn()
  const leave = vi.fn()
  let pip!: {
    supported: boolean
    open: () => Promise<void>
    close: () => void
  }
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup() {
      provideMeetingContext(
        fromPartial({
          participantStore,
          mediaState,
          gridLayout: { displayScreenShares, pinnedTiles },
        }),
      )
      provide('sfuManager', shallowRef(manager))
      return () =>
        h(MeetingPictureInPicture, {
          ...state,
          ref: (value: unknown) => {
            if (value) pip = fromPartial<typeof pip>(value)
          },
          onToggleMicrophone: toggle,
          onToggleCamera: toggleCamera,
          onToggleScreenShare: share,
          onLeave: leave,
        })
    },
  })
  app.mount(root)
  apps.push(app)
  return {
    get pip() {
      return pip
    },
    app,
    root,
    state,
    participantStore,
    mediaState,
    displayScreenShares,
    pinnedTiles,
    remote,
    manager,
    toggle,
    share,
    toggleCamera,
    leave,
  }
}
async function flush() {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}
beforeEach(() => {
  setAutomaticPictureInPicture(true)
  vi.useFakeTimers()
  vi.stubGlobal('MediaStream', TestStream)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  handlers = new Map()
  setActionHandler = vi.fn((name, callback) => handlers.set(name, callback))
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: { setActionHandler },
  })
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  for (const key of [
    'requestPictureInPicture',
    'webkitSupportsPresentationMode',
    'webkitSetPresentationMode',
  ])
    Reflect.deleteProperty(HTMLVideoElement.prototype, key)
  Reflect.deleteProperty(document, 'pictureInPictureEnabled')
  Reflect.deleteProperty(navigator, 'mediaSession')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('MeetingPictureInPicture browser behavior', () => {
  it.each([
    ['Linux', { altKey: true }],
    ['Macintosh', { ctrlKey: true }],
  ])('opens Firefox PiP on %s even with automatic entry disabled', async (platform, modifiers) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      `Mozilla/5.0 (${platform}) Firefox/151.0`,
    )
    setAutomaticPictureInPicture(false)
    const win = fakeWindow()
    const requestWindow = vi.fn().mockResolvedValue(win)
    mount({ requestWindow })
    const shortcut = () =>
      new KeyboardEvent('keydown', { code: 'KeyM', ...modifiers, shiftKey: true, bubbles: true })
    const field = document.body.appendChild(document.createElement('textarea'))
    field.dispatchEvent(shortcut())
    expect(requestWindow).not.toHaveBeenCalled()
    window.dispatchEvent(shortcut())
    await flush()
    expect(requestWindow).toHaveBeenCalledOnce()
    expect(win.document.querySelector('[role=toolbar]')).not.toBeNull()
    expect(setActionHandler).not.toHaveBeenCalled()
  })
  it('keeps the pinned camera visible above an active presentation', async () => {
    const win = fakeWindow()
    const test = mount({ requestWindow: vi.fn().mockResolvedValue(win), remote: track('camera') })
    await test.pip.open()
    await flush()
    const refresh = async () => {
      await vi.advanceTimersByTimeAsync(500)
      await flush()
    }
    const lowerLabel = () => win.document.querySelectorAll('[role=status]')[1]?.textContent
    Object.assign(test.participantStore.participants, {
      presenter: { user_name: 'Presenter', video_enabled: false, audio_enabled: false },
    })
    test.participantStore.activeSpeakerIds = ['presenter']
    await refresh()
    expect(lowerLabel()).toBe('Remote speaker')
    expect(win.document.querySelector('[aria-label="Pin participant"]')).toBeNull()
    test.pinnedTiles.value = [{ type: 'participant', id: 'remote' }]
    await refresh()
    expect(lowerLabel()).toBe('Remote speaker')

    const screen = track('screen')
    test.mediaState.screenShareStreams.presenter = new TestStream([screen])
    test.displayScreenShares.value = [{ source: 'remote', participantId: 'presenter' }]
    await refresh()
    expect(lowerLabel()).toBe('Remote speaker')
    const shareLabel = () => win.document.querySelectorAll('[role=status]')[2]?.textContent
    expect(shareLabel()).toBe('Presenter’s screen')
    expect(videoStream(win.document.querySelectorAll('video')[2]).getVideoTracks()).toEqual([
      screen,
    ])

    test.displayScreenShares.value = []
    await refresh()
    expect(shareLabel()).toBeUndefined()
    test.pinnedTiles.value = []
    await refresh()
    expect(lowerLabel()).toBe('Presenter')
    expect(win.document.querySelector('[aria-label="Muted"]')).not.toBeNull()
    test.participantStore.activeSpeakerIds = ['remote']
    await refresh()
    expect(lowerLabel()).toBe('Presenter')
    await refresh()
    expect(lowerLabel()).toBe('Remote speaker')
  })
  it('covers the local presentation with the main meeting blur overlay', async () => {
    const win = fakeWindow()
    const test = mount({ requestWindow: vi.fn().mockResolvedValue(win), remote: track('camera') })
    test.mediaState.screenShareStream = new TestStream([track('own screen')])
    test.displayScreenShares.value = [{ source: 'local', participantId: 'self' }]
    await test.pip.open()
    await flush()

    expect(win.document.body.textContent).toContain('You are sharing your screen')
    expect(win.document.querySelector('[class~="backdrop-blur-md"]')).toBeNull()
    expect([...win.document.querySelectorAll('video.blur-md')]).toEqual([
      win.document.querySelectorAll('video')[2],
    ])
    expect(win.document.querySelectorAll('video')).toHaveLength(3)
  })

  it('closes PiP when the meeting tab becomes visible again', async () => {
    const win = fakeWindow()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const test = mount({ requestWindow: vi.fn().mockResolvedValue(win) })
    await test.pip.open()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(win.close).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(win.close).toHaveBeenCalledOnce()
    expect(test.leave).not.toHaveBeenCalled()
  })

  it('does not offer unsupported PiP or open any window', async () => {
    const test = mount()
    await flush()
    expect(test.pip.supported).toBe(false)
    await test.pip.open()
    expect(test.root.querySelector('[role=status]')).toBeNull()
  })
  it('allows Document PiP without a camera and exposes meeting controls', async () => {
    const win = fakeWindow()
    const test = mount({ requestWindow: vi.fn().mockResolvedValue(win) })
    await test.pip.open()
    await flush()
    expect(test.pip.supported).toBe(true)
    expect(
      [...win.document.querySelectorAll('[role=status]')].map((label) => label.textContent?.trim()),
    ).toEqual(['You', 'Remote speaker'])
    expect(win.document.querySelector('img[alt="You"]')).not.toBeNull()
    const buttons = win.document.querySelectorAll('[role=toolbar] button')
    buttons[0].click()
    expect(test.toggle).toHaveBeenCalledOnce()
    test.state.micOn = false
    await flush()
    expect(buttons[0].textContent).toBe('Unmute')
    buttons[1].click()
    expect(test.toggleCamera).toHaveBeenCalledOnce()
    test.state.cameraOn = false
    await flush()
    expect(buttons[1].textContent).toBe('Turn camera on')
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true')
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    buttons[buttons.length - 1].click()
    await flush()
    expect(win.close).toHaveBeenCalledOnce()
    expect(test.leave).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })
  it('shows local video above the remote camera and reuses muted video-only tracks', async () => {
    const win = fakeWindow()
    const remote = track('remote')
    const local = track('local')
    const test = mount({
      requestWindow: vi.fn().mockResolvedValue(win),
      remote,
      local,
    })
    await test.pip.open()
    await flush()
    const videos = [
      ...test.root.querySelectorAll('video'),
      ...win.document.querySelectorAll('video'),
    ]
    expect(videos).toHaveLength(3)
    for (const video of videos) {
      expect(video.muted).toBe(true)
      const stream = videoStream(video)
      expect(stream.getAudioTracks()).toEqual([])
      expect(stream.getVideoTracks()).toEqual([video === videos[2] ? remote : local])
    }
    expect(
      [...win.document.querySelectorAll('[role=status]')].map((label) => label.textContent?.trim()),
    ).toEqual(['You', 'Remote speaker'])
    test.pip.close()
    await flush()
    expect(test.manager.setPictureInPictureParticipant).toHaveBeenLastCalledWith(null)
    expect(remote.stop).not.toHaveBeenCalled()
    expect(local.stop).not.toHaveBeenCalled()
  })
  it('replaces a remote track and falls back to local camera when remote camera ends', async () => {
    const win = fakeWindow()
    const local = track('local')
    const test = mount({
      requestWindow: vi.fn().mockResolvedValue(win),
      remote: track('old'),
      local,
    })
    await test.pip.open()
    await flush()
    const next = track('replacement')
    test.remote.value = next
    await vi.advanceTimersByTimeAsync(500)
    await flush()
    expect(videoStream(win.document.querySelectorAll('video')[1]).getVideoTracks()).toEqual([next])
    test.participantStore.participants.remote.video_enabled = false
    await vi.advanceTimersByTimeAsync(500)
    await flush()
    expect(videoStream(win.document.querySelector('video')!).getVideoTracks()).toEqual([local])
    expect(win.document.body.textContent).toContain('You')
    expect(win.document.querySelector('video')?.classList.contains('-scale-x-100')).toBe(true)
    expect(win.document.querySelector('img[alt="Remote speaker"]')?.getAttribute('src')).toBe(
      '/remote-avatar.png',
    )
  })
  it('uses video PiP only with a live video and handles browser exit', async () => {
    const test = mount({ standard: true })
    await flush()
    expect(test.pip.supported).toBe(false)
    test.remote.value = track('remote')
    await vi.advanceTimersByTimeAsync(500)
    await flush()
    expect(test.pip.supported).toBe(true)
    await test.pip.open()
    expect(HTMLVideoElement.prototype.requestPictureInPicture).toHaveBeenCalledOnce()
    test.root.querySelector('video')!.dispatchEvent(new Event('leavepictureinpicture'))
    expect(test.manager.setPictureInPictureParticipant).toHaveBeenLastCalledWith(null)
    await test.pip.open()
    expect(HTMLVideoElement.prototype.requestPictureInPicture).toHaveBeenCalledTimes(2)
  })
  it('uses Safari presentation mode when standard PiP is unavailable', async () => {
    const test = mount({ webkit: true, remote: track('remote') })
    await flush()
    expect(test.pip.supported).toBe(true)
    await test.pip.open()
    expect(
      fromPartial<{
        webkitSetPresentationMode: unknown
      }>(HTMLVideoElement.prototype).webkitSetPresentationMode,
    ).toHaveBeenCalledWith('picture-in-picture')
  })
  it('registers automatic entry only while active and clears it on teardown', async () => {
    const requestWindow = vi.fn().mockImplementation(async () => fakeWindow())
    const test = mount({ active: false, requestWindow })
    expect(handlers.get('enterpictureinpicture')).toBeNull()
    test.state.active = true
    await flush()
    expect(typeof handlers.get('enterpictureinpicture')).toBe('function')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(requestWindow).not.toHaveBeenCalled()
    handlers.get('enterpictureinpicture')!()
    await flush()
    expect(requestWindow).toHaveBeenCalledOnce()
    test.state.active = false
    await flush()
    expect(handlers.get('enterpictureinpicture')).toBeNull()
    test.app.unmount()
    apps.splice(apps.indexOf(test.app), 1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('turning automatic PiP off closes it and prevents a stale browser action reopening it', async () => {
    const win = fakeWindow()
    const requestWindow = vi.fn().mockResolvedValue(win)
    const test = mount({ requestWindow })
    const browserAction = handlers.get('enterpictureinpicture')!
    browserAction()
    await flush()
    setAutomaticPictureInPicture(false)
    await flush()
    expect(win.close).toHaveBeenCalledOnce()
    expect(handlers.get('enterpictureinpicture')).toBeNull()
    browserAction()
    await test.pip.open()
    expect(requestWindow).toHaveBeenCalledOnce()
    setAutomaticPictureInPicture(true)
    await flush()
    handlers.get('enterpictureinpicture')!()
    await flush()
    expect(requestWindow).toHaveBeenCalledTimes(2)
  })
  it('remembers an opted-out preference when meeting media preferences reload', async () => {
    setAutomaticPictureInPicture(false)
    automaticPictureInPicture.value = true
    loadMediaPreferences()
    const requestWindow = vi.fn()
    const test = mount({ requestWindow })
    expect(automaticPictureInPicture.value).toBe(false)
    expect(handlers.get('enterpictureinpicture')).toBeNull()
    await test.pip.open()
    expect(requestWindow).not.toHaveBeenCalled()
  })
  it('stops an active share in place and returns to Meet to start a new share', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: vi.fn() },
    })
    const win = fakeWindow()
    const test = mount({ requestWindow: vi.fn().mockResolvedValue(win) })
    await test.pip.open()
    await flush()
    vi.spyOn(window, 'focus').mockImplementation(() => {})
    test.state.isScreenSharing = true
    await flush()
    const button = win.document.querySelectorAll('[role=toolbar] button')[2]
    expect(button.textContent).toBe('Stop sharing')
    button.click()
    expect(win.close).not.toHaveBeenCalled()
    test.state.isScreenSharing = false
    await flush()
    expect(button.textContent).toBe('Share screen')
    button.click()
    expect(test.share).toHaveBeenCalledTimes(2)
    await flush()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(win.close).toHaveBeenCalledOnce()
    expect(test.leave).not.toHaveBeenCalled()
  })
  it('survives an unsupported MediaSession action and a denied request, allowing retry', async () => {
    setActionHandler.mockImplementation(() => {
      throw new Error('unsupported action')
    })
    const requestWindow = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(fakeWindow())
    const test = mount({ requestWindow })
    await test.pip.open()
    await flush()
    expect(test.root.textContent).toContain('Could not open picture-in-picture')
    await test.pip.open()
    await flush()
    expect(requestWindow).toHaveBeenCalledTimes(2)
    expect(test.root.textContent).not.toContain('Could not open picture-in-picture')
  })
  it.each(['inactive', 'unmount', 'disabled'] as const)(
    'closes a window that resolves after %s and suppresses duplicate pending requests',
    async (mode) => {
      let resolve!: (win: unknown) => void
      const requestWindow = vi.fn(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      )
      const test = mount({ requestWindow })
      const opening = test.pip.open()
      await test.pip.open()
      expect(requestWindow).toHaveBeenCalledOnce()
      if (mode === 'disabled') {
        setAutomaticPictureInPicture(false)
        await flush()
      } else if (mode === 'inactive') {
        test.state.active = false
        await flush()
      } else {
        test.app.unmount()
        apps.splice(apps.indexOf(test.app), 1)
      }
      const win = fakeWindow()
      resolve(win)
      await opening
      await flush()
      expect(win.close).toHaveBeenCalledOnce()
      expect(win.document.querySelector('video')).toBeNull()
    },
  )
  it('closing the native window leaves the meeting intact and permits reopening', async () => {
    const first = fakeWindow()
    const second = fakeWindow()
    const requestWindow = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const test = mount({ requestWindow })
    await test.pip.open()
    await flush()
    first.dispatchEvent(new Event('pagehide'))
    await flush()
    expect(test.leave).not.toHaveBeenCalled()
    expect(first.document.querySelector('section')).toBeNull()
    await test.pip.open()
    await flush()
    expect(second.document.querySelector('section')).not.toBeNull()
    window.dispatchEvent(new Event('pagehide'))
    await flush()
    expect(second.close).toHaveBeenCalledOnce()
  })
})

describe('PiP denial and teardown regressions', () => {
  it('prefers Document PiP over video PiP and opens only one window', async () => {
    const requestWindow = vi.fn().mockResolvedValue(fakeWindow())
    const test = mount({
      requestWindow,
      standard: true,
      remote: track('remote'),
    })
    await test.pip.open()
    await test.pip.open()
    await flush()
    expect(requestWindow).toHaveBeenCalledOnce()
    expect(HTMLVideoElement.prototype.requestPictureInPicture).not.toHaveBeenCalled()
  })
  it('survives denied video PiP and releases the source reference on meeting exit', async () => {
    const source = track('remote')
    const test = mount({ standard: true, remote: source })
    vi.mocked(HTMLVideoElement.prototype.requestPictureInPicture).mockRejectedValueOnce(
      new DOMException('Denied', 'NotAllowedError'),
    )
    await test.pip.open()
    await flush()
    expect(test.root.textContent).toContain('Could not open picture-in-picture')
    expect(test.manager.setPictureInPictureParticipant).not.toHaveBeenCalledWith('remote')
    test.state.active = false
    await flush()
    expect(test.root.querySelector('video')!.srcObject).toBeNull()
    expect(source.stop).not.toHaveBeenCalled()
  })
  it('does not invoke the native video API before video metadata is ready', async () => {
    const test = mount({ standard: true, remote: track('remote') })
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(0)
    await test.pip.open()
    await flush()
    expect(HTMLVideoElement.prototype.requestPictureInPicture).not.toHaveBeenCalled()
    expect(test.root.textContent).toContain('Could not open picture-in-picture')
  })
  it('unmounts an active PiP, unregisters automatic entry, and invalidates its stale callback', async () => {
    const win = fakeWindow()
    const requestWindow = vi.fn().mockResolvedValue(win)
    const test = mount({ requestWindow, remote: track('remote') })
    const callback = handlers.get('enterpictureinpicture')!
    await test.pip.open()
    await flush()
    test.app.unmount()
    apps.splice(apps.indexOf(test.app), 1)
    expect(win.close).toHaveBeenCalledOnce()
    expect(handlers.get('enterpictureinpicture')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    expect(test.manager.setPictureInPictureParticipant).toHaveBeenLastCalledWith(null)
    // A browser callback queued before unregistering must not reopen after teardown.
    callback()
    await flush()
    expect(requestWindow).toHaveBeenCalledOnce()
  })
})
