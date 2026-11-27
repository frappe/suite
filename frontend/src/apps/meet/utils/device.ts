import type { Platform } from '../types'

export function getPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()

  if (ua.indexOf('win') > -1) {
    return 'win'
  }
  if (ua.indexOf('mac') > -1) {
    return 'mac'
  }
  if (ua.indexOf('x11') > -1 || ua.indexOf('linux') > -1) {
    return 'linux'
  }

  return 'unknown'
}

export function isMobileDevice(): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
}

export function canScreenShare(): boolean {
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

export function isFirefoxDesktop(): boolean {
  return /Firefox\//.test(navigator.userAgent) && !isMobileDevice()
}

export function supportsAutomaticMeetingPip(): boolean {
  return (
    'documentPictureInPicture' in window &&
    !isFirefoxDesktop() &&
    typeof navigator.mediaSession?.setActionHandler === 'function'
  )
}
