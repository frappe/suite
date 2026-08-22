import { createResource } from 'frappe-ui'

/**
 * Per-presentation access level ('edit' | 'view' | anything else = no access).
 * Read by the slides route guard and, when the editor is mounted outside the
 * /slides routes, by the editor itself since no guard runs there.
 */
export const getEditorAccess = async (presentationId: string) => {
	try {
		const response = await createResource({
			url: 'suite.slides.doctype.presentation.presentation.get_editor_access',
			method: 'GET',
		}).submit({
			doctype: 'Presentation',
			presentation_id: presentationId,
		})
		return response
	} catch (error) {
		console.error('Failed to fetch presentation access level:', error)
		return false
	}
}
