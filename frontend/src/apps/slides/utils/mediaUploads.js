import { FileUploadHandler, toast, call } from 'frappe-ui'

import { presentationId, isPublicPresentation, presentationDoc } from '../stores/presentation'
import { addMediaElement, replaceMediaElement } from '../stores/element'

import { session } from '@/boot/session'

const fileUploadHandler = new FileUploadHandler()

export const SLIDES_MEDIA_PARAM = 'slides_media=1'

const performPostUploadActions = async (fileDoc, fileType, targetElement) => {
	if (fileType === 'image') {
		fileDoc = await getWebPDoc(fileDoc)
	}

	if (targetElement) {
		await replaceMediaElement(targetElement, fileDoc, fileType)
		return fileDoc
	}

	await addMediaElement(fileDoc, fileType)
	return fileDoc
}

const uploadMedia = (file, fileType, targetElement) => {
	return new Promise((resolve, reject) => {
		fileUploadHandler
			.upload(file, {
				doctype: 'Presentation',
				docname: presentationId.value,
				private: true,
			})
			.then((fileDoc) => performPostUploadActions(fileDoc, fileType, targetElement))
			.then(resolve)
			.catch((error) => {
				reject(error)
			})
	})
}

const isDataTransferItem = (obj) => {
	return obj && typeof obj === 'object' && 'kind' in obj && 'getAsFile' in obj
}

const isFile = (obj) => {
	return obj instanceof File
}

const getFileObject = (file) => {
	if (isDataTransferItem(file)) {
		return file.getAsFile()
	} else if (isFile(file)) {
		return file
	}
}

const getWebPDoc = async (fileDoc) => {
	return await call('suite.slides.doctype.presentation.presentation.get_webp_doc', {
		presentation_name: presentationId.value,
		file_doc: fileDoc,
	})
}

const handleFile = (file, toastProps, targetElement) => {
	file = getFileObject(file)
	if (!file) return

	const fileType = file.type.split('/')[0]
	if (!['image', 'video'].includes(fileType)) return

	if (targetElement && targetElement.type != fileType) targetElement = null

	toast.promise(uploadMedia(file, fileType, targetElement), toastProps)
}

const getToastProps = (file, index, length) => {
	return {
		loading: `Uploading (${index + 1}/${length})${file.name ? `: ${file.name}` : ' ...'}`,
		success: `Uploaded (${index + 1}/${length})${file.name ? `: ${file.name}` : ''}`,
		error: 'Upload failed. Please try again.',
	}
}

export const handleUploadedMedia = (files, targetElement) => {
	files = Array.from(files)

	let toastProps = {}

	if (files.length == 1) {
		toastProps = getToastProps(files[0], 0, 1)
		return handleFile(files[0], toastProps, targetElement)
	}

	files.forEach((file, index) => {
		toastProps = getToastProps(file, index, files.length)
		handleFile(file, toastProps)
	})
}

export const getAttachmentUrl = (fileUrl) => {
	if (!fileUrl) return ''

	// if starts with data: or /assets return as it is
	if (fileUrl.startsWith('data:') || fileUrl.startsWith('/assets')) return fileUrl

	// if it starts with /files add /private prefix
	if (fileUrl.startsWith('/files')) fileUrl = `/private${fileUrl}`

	if (fileUrl.startsWith('/private')) {
		// if owner is trying to access just send static path
		const user = session.user?.sessionUser
		if (presentationDoc.value?.owner === user || user === 'Administrator') {
			// Tag the request so the slides service worker can cache it without
			// touching other apps' /private/files/ traffic (Drive, Mail, ...).
			// Non-owner media already goes through the slides-namespaced proxy below.
			return `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}${SLIDES_MEDIA_PARAM}`
		}
		return `/api/method/suite.slides.api.file.get_media_file?src=${fileUrl}&public=${isPublicPresentation.value}`
	}
}
