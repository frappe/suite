// Folders build into a zip via a background job, then download; single files
// download directly. Both are served range/resume-capable off storage. The
// build's terminal state (ready/failed) arrives over the socket DriveLayout
// already opened — no interval polling.

import { call } from 'frappe-ui'
import { toast } from '@/apps/drive/utils/toasts.js'
import { getSocket } from '@/apps/drive/socket'

export function entitiesDownload(entities, transfer = false) {
  if (entities.length === 1 && !entities[0].is_folder) {
    window.location.href = `/api/method/suite.drive.api.files.get_file_content?entity_name=${
      entities[0].name
    }&trigger_download=1${transfer ? '&transfer=1' : ''}`
    return
  }

  prepareArchive(entities)
}

async function prepareArchive(entities) {
  const names = JSON.stringify(entities.map((entity) => entity.name))
  let token
  try {
    ;({ token } = await call('suite.drive.api.files.download_folder', { entities: names }))
  } catch (error) {
    toast.error(error?.message || 'Download failed')
    return
  }

  try {
    await toast
      .promise(waitForArchive(token), {
        loading: 'Preparing download…',
        success: 'Download prepared',
        error: (error) => error?.message || 'Could not prepare this download',
      })
      .unwrap()
  } catch {
    return // toast.promise already rendered the error toast in place
  }

  window.location.href = `/api/method/suite.drive.api.files.download_archive?token=${encodeURIComponent(
    token
  )}`
}

// timeout must outlast the job's 1h timeout, or we give up on builds that
// would still succeed
function waitForArchive(token, { timeout = 70 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = getSocket()
    let settled = false
    let timer

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket?.off('drive-download-status', onStatus)
      fn(value)
    }

    const settle = (data) => {
      if (data.status === 'ready') finish(resolve, data)
      else finish(reject, new Error(data.error || 'Could not prepare this download'))
    }

    const onStatus = (data) => {
      if (data.token === token) settle(data)
    }
    socket?.on('drive-download-status', onStatus)

    // covers the build finishing between the enqueue call and this listener
    // attaching, and the (rare) case the socket drops the event entirely
    call('suite.drive.api.files.download_status', { token })
      .then((res) => {
        if (res.status === 'ready' || res.status === 'failed') settle(res)
      })
      .catch(() => {}) // the socket path still covers a transient failure here

    timer = setTimeout(() => finish(reject, new Error('Timed out preparing download')), timeout)
  })
}
