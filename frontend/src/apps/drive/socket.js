import { createSiteSocket } from '@/realtime'

let socketInstance = null

export function initSocket() {
  if (socketInstance) return socketInstance

  socketInstance = createSiteSocket()
  socketInstance.on('connect_error', (data) => {
    console.log(data)
  })
  return socketInstance
}

// For non-component code (plain utils) that needs the same connection
// DriveLayout already opened and `provide`d — call after the app has mounted.
export function getSocket() {
  return socketInstance
}
