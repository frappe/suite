// Copyright (c) 2026, Frappe and contributors
// For license information, please see license.txt

frappe.ui.form.on('Suite Settings', {
	refresh(frm) {
		frm.add_custom_button(
			__('Validate Suite Cloud Credentials'),
			() => frm.trigger('validate_suite_cloud_credentials'),
			__('Actions'),
		)
	},

	validate_suite_cloud_credentials(frm) {
		if (frm.is_dirty()) {
			frappe.msgprint(__('Save Suite Settings first; the saved credentials are the ones checked.'))
			return
		}
		frappe.call({
			doc: frm.doc,
			method: 'validate_suite_cloud_credentials',
			freeze: true,
			freeze_message: __('Contacting Suite Cloud…'),
		})
	},
})
