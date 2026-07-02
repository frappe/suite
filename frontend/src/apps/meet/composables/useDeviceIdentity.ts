// E2EE device identity accessor.
//
// Thin wrapper over the DeviceIdentityProvider port. Production callers
// receive the IndexedDB-backed singleton; tests can construct a
// MemoryDeviceIdentityProvider directly via the port module.
//
// Callers destructure `{ getIdentity, clearCache }` and call them
// as bare functions, so the returned view must bind the methods
// (the underlying provider is a class with `#cached` state and
// loses `this` if the methods are pulled off the instance).

import {
	type DeviceIdentityProvider,
	IndexedDBDeviceIdentityProvider,
} from "../utils/identity/DeviceIdentityProvider";

let defaultProvider: DeviceIdentityProvider | null = null;
let defaultView: DeviceIdentityProvider | null = null;

function getDefaultProvider(): DeviceIdentityProvider {
	if (!defaultProvider) {
		defaultProvider = new IndexedDBDeviceIdentityProvider();
	}
	return defaultProvider;
}

export function useDeviceIdentity(): DeviceIdentityProvider {
	if (!defaultView) {
		const provider = getDefaultProvider();
		defaultView = {
			getIdentity: () => provider.getIdentity(),
			clearCache: () => provider.clearCache(),
		};
	}
	return defaultView;
}
