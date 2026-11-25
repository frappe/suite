import {
  IndexedDBDeviceIdentityProvider,
  type DeviceIdentityProvider,
} from '../utils/identity/DeviceIdentityProvider'

let defaultProvider: DeviceIdentityProvider | null = null
let defaultView: DeviceIdentityProvider | null = null

function getDefaultProvider(): DeviceIdentityProvider {
  if (!defaultProvider) {
    defaultProvider = new IndexedDBDeviceIdentityProvider()
  }
  return defaultProvider
}

export function useDeviceIdentity(): DeviceIdentityProvider {
  if (!defaultView) {
    const provider = getDefaultProvider()
    defaultView = {
      getIdentity: () => provider.getIdentity(),
      clearCache: () => provider.clearCache(),
    }
  }
  return defaultView
}
