// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Contacts Exchange', {
	refresh(frm) {
		if (!frm.doc.__islocal) {
			frm.trigger('add_actions')
		}
	},

	user(frm) {
		frm.set_value('account', null)
	},

	add_actions(frm) {
		if (frm.doc.docstatus != 1) return
		if (!frappe.user_roles.includes('System Manager')) return

		if (['Failed'].includes(frm.doc.status)) {
			frm.add_custom_button(__('Retry'), () => frm.trigger('retry'), __('Actions'))
		}
	},

	retry(frm) {
		frappe.call({
			doc: frm.doc,
			method: 'retry',
			freeze: true,
			freeze_message: __('Retrying...'),
			callback: (r) => {
				if (!r.exc) {
					frm.refresh()
				}
			},
		})
	},
})
