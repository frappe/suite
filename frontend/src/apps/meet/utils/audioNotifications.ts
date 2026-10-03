/**
 * Audio Notification Utility
 * Generates notification tones using Web Audio API
 */

import { notificationChimesEnabled } from '../data/notificationPreferences'
import notificationContextManager from './notificationContext'

type FrequencyPoint = [number, number] // [frequency, timeOffset]
type FrequencyInput = number | FrequencyPoint[]

class AudioNotificationManager {
  private audioContext: AudioContext | null = null
  private isInitialized = false

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    try {
      this.audioContext = new (
        window.AudioContext ||
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      )()
      this.isInitialized = true
    } catch (error) {
      console.warn('AudioContext not supported:', error)
    }
  }

  async playTone(frequencies: FrequencyInput, duration = 0.3, volume = 0.3): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize()
    }

    if (!this.audioContext) return

    try {
      const oscillator = this.audioContext.createOscillator()
      const gainNode = this.audioContext.createGain()

      oscillator.type = 'sine'

      // Handle single frequency or frequency sweep
      if (Array.isArray(frequencies)) {
        for (const [freq, time] of frequencies) {
          const startTime = this.audioContext?.currentTime + (time || 0)
          if (startTime !== undefined) {
            oscillator.frequency.setValueAtTime(freq, startTime)
          }
        }
      } else {
        oscillator.frequency.setValueAtTime(frequencies, this.audioContext.currentTime)
      }

      // prevent speaker popping using smooth attack and decay
      const attackTime = 0.01 // 10ms fade-in
      gainNode.gain.setValueAtTime(0, this.audioContext.currentTime)
      gainNode.gain.linearRampToValueAtTime(volume, this.audioContext.currentTime + attackTime)
      gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime + attackTime)
      gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + duration)

      oscillator.connect(gainNode)
      gainNode.connect(this.audioContext.destination)

      oscillator.start(this.audioContext.currentTime)
      oscillator.stop(this.audioContext.currentTime + duration)
    } catch (error) {
      console.warn('Failed to play notification tone:', error)
    }
  }

  async playJoinNotification(userId?: string): Promise<void> {
    if (!notificationChimesEnabled.value) return
    if (!notificationContextManager.shouldPlayNotification('join', { userId })) {
      return
    }
    await this.playTone(
      [
        [262, 0], // C4 (warmer start)
        [392, 0.08], // G4
        [659, 0.16], // E5
        [523, 0.24], // C5 (resolution)
      ],
      0.5,
      0.075,
    )
  }

  async playLeaveNotification(isLocalUser = false): Promise<void> {
    if (!notificationChimesEnabled.value) return
    if (
      !notificationContextManager.shouldPlayNotification('leave', {
        isLocalUser,
      })
    ) {
      return
    }
    await this.playTone(
      [
        [392, 0], // G4
        [330, 0.1], // E4
        [262, 0.2], // C4
      ],
      0.4,
      0.075,
    )
  }

  async playJoinRequestNotification(): Promise<void> {
    if (!notificationChimesEnabled.value) return
    if (!notificationContextManager.shouldPlayNotification('joinRequest')) {
      return
    }
    await this.playTone(
      [
        [349, 0], // F4
        [440, 0.1], // A4
        [349, 0.2], // F4 (back)
        [523, 0.3], // C5 (final)
      ],
      0.6,
      0.25,
    )
  }

  async playChatNotification(): Promise<void> {
    if (!notificationChimesEnabled.value) return
    if (!notificationContextManager.shouldPlayNotification('chat')) {
      return
    }
    await this.playTone(
      [
        [330, 0], // E4
        [392, 0.1], // G4
      ],
      0.25,
      0.2,
    )
  }

  async playRaiseHandNotification(): Promise<void> {
    if (!notificationChimesEnabled.value) return
    if (!notificationContextManager.shouldPlayNotification('raiseHand')) {
      return
    }
    await this.playTone(
      [
        [523.25, 0], // C5
        [659.25, 0.08], // E5
        [783.99, 0.16], // G5
      ],
      0.5,
      0.2,
    )
  }

  async cleanup(): Promise<void> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close()
    }
    this.audioContext = null
    this.isInitialized = false
  }
}

const audioNotificationManager = new AudioNotificationManager()

export default audioNotificationManager
