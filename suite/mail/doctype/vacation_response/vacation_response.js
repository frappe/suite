// Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Vacation Response', {
	refresh(frm) {
		frm.trigger('set_account_options')
	},

	user(frm) {
		frm.set_value('account', null)
		frm.trigger('set_account_options')
	}
})
