import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { deviceManager } from '../DeviceManager'

beforeEach(() => {
  deviceManager.cameras = []
  deviceManager.microphones = []
  deviceManager.speakers = []
  deviceManager.deviceChangeListeners = []
  deviceManager.isEnumerating = false
})

afterEach(() => {
  deviceManager.cameras = []
  deviceManager.microphones = []
  deviceManager.speakers = []
  deviceManager.deviceChangeListeners = []
})

describe('findDeviceById', () => {
  it('finds a camera by deviceId', () => {
    deviceManager.cameras = [
      { deviceId: 'cam1', label: 'Camera 1', groupId: 'g1' },
      { deviceId: 'cam2', label: 'Camera 2', groupId: 'g2' },
    ]
    const found = deviceManager.findDeviceById('cam2', 'camera')
    expect(found?.label).toBe('Camera 2')
  })

  it('finds a microphone by deviceId', () => {
    deviceManager.microphones = [{ deviceId: 'mic1', label: 'Mic 1', groupId: 'g1' }]
    const found = deviceManager.findDeviceById('mic1', 'microphone')
    expect(found?.label).toBe('Mic 1')
  })

  it('finds a speaker by deviceId', () => {
    deviceManager.speakers = [{ deviceId: 'spk1', label: 'Speaker 1', groupId: 'g1' }]
    const found = deviceManager.findDeviceById('spk1', 'speaker')
    expect(found?.label).toBe('Speaker 1')
  })

  it('returns undefined for unknown deviceId', () => {
    deviceManager.cameras = [{ deviceId: 'cam1', label: 'C1', groupId: 'g1' }]
    const found = deviceManager.findDeviceById('nope', 'camera')
    expect(found).toBeUndefined()
  })

  it('returns undefined for empty list', () => {
    const found = deviceManager.findDeviceById('cam1', 'camera')
    expect(found).toBeUndefined()
  })
})

describe('getDefaultDevice', () => {
  it('returns the first device', () => {
    deviceManager.cameras = [
      { deviceId: 'cam1', label: 'Camera 1', groupId: 'g1' },
      { deviceId: 'cam2', label: 'Camera 2', groupId: 'g2' },
    ]
    const defaultCam = deviceManager.getDefaultDevice('camera')
    expect(defaultCam?.deviceId).toBe('cam1')
  })

  it('returns null when no devices', () => {
    expect(deviceManager.getDefaultDevice('camera')).toBeNull()
  })
})

describe('isDeviceAvailable', () => {
  it('returns true when device exists', () => {
    deviceManager.cameras = [{ deviceId: 'cam1', label: 'C1', groupId: 'g1' }]
    expect(deviceManager.isDeviceAvailable('cam1', 'camera')).toBe(true)
  })

  it('returns false when device does not exist', () => {
    expect(deviceManager.isDeviceAvailable('cam1', 'camera')).toBe(false)
  })
})

describe('enumerateDevices', () => {
  it('lists devices without requesting media permission', async () => {
    const getUserMedia = vi.fn()
    const enumerateDevices = vi.fn().mockResolvedValue([
      { kind: 'videoinput', deviceId: 'cam1', label: 'Camera', groupId: 'g1' },
      { kind: 'audioinput', deviceId: 'mic1', label: 'Microphone', groupId: 'g1' },
      { kind: 'audiooutput', deviceId: 'spk1', label: 'Speaker', groupId: 'g1' },
    ])
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices, getUserMedia },
    })

    await deviceManager.enumerateDevices()

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(deviceManager.getCameras().map((device) => device.deviceId)).toEqual(['cam1'])
    expect(deviceManager.getMicrophones().map((device) => device.deviceId)).toEqual(['mic1'])
    expect(deviceManager.getSpeakers().map((device) => device.deviceId)).toEqual(['spk1'])
  })
})

describe('device change subscriptions', () => {
  it('notifies only active listeners after refreshing the device lists', async () => {
    let deviceChanged!: () => Promise<void>
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([
            { kind: 'videoinput', deviceId: 'cam-new', label: 'New camera', groupId: 'g1' },
          ]),
        addEventListener: (_event: string, listener: () => Promise<void>) => {
          deviceChanged = listener
        },
      },
    })
    deviceManager.setupDeviceChangeListener()
    const removed = vi.fn()
    const active = vi.fn(() => deviceManager.getCameras().map((device) => device.deviceId))
    deviceManager.addDeviceChangeListener(removed)
    deviceManager.addDeviceChangeListener(active)
    deviceManager.removeDeviceChangeListener(removed)
    deviceManager.removeDeviceChangeListener(vi.fn())

    await deviceChanged()

    expect(active).toHaveBeenCalledExactlyOnceWith()
    expect(active).toHaveReturnedWith(['cam-new'])
    expect(removed).not.toHaveBeenCalled()
  })
})
