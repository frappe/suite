import { afterEach, expect, it, vi } from 'vitest'

import type { AudioDiagnosticSample, ConnectionDiagnostics } from '../SFUMeetingManager'
import { buildProblemReportMailto, openProblemReportEmail } from './problemReport'

vi.mock('./consoleBuffer', () => ({
  getConsoleLogLines: () =>
    Array.from({ length: 20 }, (_, index) => `log-${index} ${'details '.repeat(30)}`),
  getConsoleLogSummary: () => ({ total: 20, error: 0, warn: 0 }),
}))

function sample(second: number, packets: number): AudioDiagnosticSample {
  return {
    capturedAt: `2026-11-02T00:00:0${second}Z`,
    streams: [
      {
        id: 'mic',
        direction: 'send',
        kind: 'audio',
        source: 'microphone',
        paused: false,
        muted: false,
        trackEnabled: true,
        trackState: 'live',
        reports: [
          {
            id: 'rtp',
            type: 'outbound-rtp',
            packetsSent: packets,
            bytesSent: packets * 100,
            totalAudioEnergy: 0.5,
          },
        ],
      },
    ],
    playback: [],
  }
}

const diagnostics: ConnectionDiagnostics = {
  connectionStatus: {
    connected: true,
    socketId: 'socket',
    meetingId: 'room',
    userId: 'reporter',
  },
  transportStats: {
    sendTransport: { id: 'send', state: 'connected' },
    recvTransport: { id: 'recv', state: 'connected' },
  },
  networkStats: null,
  audioSamples: [sample(0, 100), sample(1, 100)],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps evidence of a live mic sending no packets and trims logs to the encoded URI budget', async () => {
  const url = await buildProblemReportMailto({
    meetingId: 'room',
    diagnostics,
  })
  const body = new URL(url).searchParams.get('body')!
  expect(body).toContain('Audio changes over 1.0s:')
  expect(body).toContain('Mic: enabled, live; paused=false; muted=false')
  expect(body).toContain('Packets sent: 0; bytes: 0; energy: 0')
  expect(body).toContain('[Report shortened to fit email link]')
  expect(body).not.toContain('log-19')
  expect(body).not.toContain('JSON')
  expect(url.length).toBeLessThanOrEqual(2000)
})

it('distinguishes unsupported counters and replaced streams from zero transmission', async () => {
  const before = sample(0, 100)
  const after = {
    ...sample(1, 20),
    streams: [
      {
        ...sample(1, 20).streams[0],
        reports: [{ type: 'outbound-rtp', id: 'rtp', packetsSent: 20 }],
      },
    ],
  }
  const url = await buildProblemReportMailto({
    meetingId: 'room',
    diagnostics: { ...diagnostics, audioSamples: [before, after] },
  })
  expect(new URL(url).searchParams.get('body')).toContain(
    'Packets sent: unavailable; bytes: unavailable; energy: unavailable',
  )
  const replaced = {
    ...after,
    streams: [{ ...after.streams[0], id: 'new-mic' }],
  }
  const replacedUrl = await buildProblemReportMailto({
    meetingId: 'room',
    diagnostics: { ...diagnostics, audioSamples: [before, replaced] },
  })
  expect(new URL(replacedUrl).searchParams.get('body')).toContain('Packets sent: unavailable')
})

it('shows incoming packets alongside paused playback', async () => {
  const incoming = (packets: number): AudioDiagnosticSample['streams'][number] => ({
    id: 'remote',
    participantId: 'Tanmoy',
    direction: 'receive',
    kind: 'audio',
    source: 'remote audio',
    paused: false,
    muted: false,
    trackEnabled: true,
    trackState: 'live',
    reports: [
      {
        id: 'inbound',
        type: 'inbound-rtp',
        packetsReceived: packets,
        bytesReceived: packets * 100,
        totalSamplesReceived: packets * 960,
        concealedSamples: 0,
        packetsLost: 0,
      },
      {
        id: 'ice',
        type: 'candidate-pair',
        packetsReceived: packets * 2,
        bytesReceived: packets * 200,
      },
    ],
  })
  const before = { ...sample(0, 0), streams: [incoming(100)] }
  const after = {
    ...sample(1, 0),
    streams: [incoming(148)],
    playback: [
      {
        participantId: 'Tanmoy',
        paused: true,
        muted: false,
        volume: 1,
        readyState: 4,
        currentTime: 10,
        error: null,
      },
    ],
  }
  const url = await buildProblemReportMailto({
    meetingId: 'room',
    diagnostics: { ...diagnostics, audioSamples: [before, after] },
  })
  const body = new URL(url).searchParams.get('body')
  expect(body).toContain('From Tanmoy:')
  expect(body).toContain('Packets received: 48; bytes: 4800')
  expect(body).toContain('Playback: paused=true; muted=false; volume=100%')
})

it('opens an email containing the summary without downloading a file', async () => {
  const location = {
    href: 'https://meet.example/room',
    hostname: 'meet.example',
  }
  vi.stubGlobal('window', { location })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
  await openProblemReportEmail({ meetingId: 'room', diagnostics })
  expect(new URL(location.href).searchParams.get('body')).toContain('Packets sent: 0')
  expect(click).not.toHaveBeenCalled()
})

it('bounds escaped Unicode and handles missing audio statistics', async () => {
  vi.stubGlobal('window', {
    location: {
      href: `https://meet.example/${'🎤'.repeat(1000)}`,
      hostname: 'meet.example',
    },
  })
  const url = await buildProblemReportMailto({ meetingId: 'room' })
  expect(new URL(url).searchParams.get('body')).toContain('Audio: statistics unavailable')
  expect(url.length).toBeLessThanOrEqual(2000)
})

it("uses only the microphone's referenced capture source for audio energy", async () => {
  const before = sample(0, 100)
  const after = sample(1, 110)
  const capture = (base: AudioDiagnosticSample, energy: number): AudioDiagnosticSample => ({
    ...base,
    streams: [
      {
        ...base.streams[0],
        reports: [
          {
            id: 'rtp',
            type: 'outbound-rtp',
            packetsSent: 100,
            mediaSourceId: 'mic-source',
          },
        ],
      },
    ],
    transportReports: [
      [
        { id: 'mic-source', type: 'media-source', totalAudioEnergy: energy },
        {
          id: 'other-source',
          type: 'media-source',
          totalAudioEnergy: energy * 100,
        },
      ],
    ],
  })
  const url = await buildProblemReportMailto({
    meetingId: 'room',
    diagnostics: {
      ...diagnostics,
      audioSamples: [capture(before, 1), capture(after, 1.25)],
    },
  })
  expect(new URL(url).searchParams.get('body')).toContain('energy: 0.250')
})
