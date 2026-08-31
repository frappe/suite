import { call } from 'frappe-ui'

const VIDEO_FILE_KIND = JSON.stringify(['Video'])

// Drive's own permission model, not core File perms — this is the same
// endpoint Drive's own <video> preview streams from, so playback stays
// gated by whatever access the viewer actually has in Drive.
export const getDriveVideoStreamUrl = (entityName) =>
	`/api/method/suite.drive.api.files.stream_file_content?entity_name=${entityName}`

// no search: recently touched videos. with search: whole-tree search, per
// suite.drive.api.list's own contract.
export const listDriveVideos = (search) => {
	const method = search ? 'suite.drive.api.list.files' : 'suite.drive.api.list.recents'
	return call(method, { search: search || undefined, file_kinds: VIDEO_FILE_KIND })
}
