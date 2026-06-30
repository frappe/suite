// Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Calendar', {
	before_load: (frm) => {
		const update_tz_options = () => {
			frm.fields_dict.time_zone.set_data(frappe.all_timezones)
		}

		if (!frappe.all_timezones) {
			frappe.call({
				method: 'frappe.core.doctype.user.user.get_timezones',
				callback: function (r) {
					frappe.all_timezones = r.message.timezones
					update_tz_options()
				},
			})
		} else {
			update_tz_options()
		}
	},

	refresh(frm) {
		frm.trigger('set_account_options')
	},

	user(frm) {
		frm.set_value('account_id', null)
		frm.trigger('set_account_options')
	},

	set_account_options(frm) {
		if (frm.doc.user) {
			frappe.call({
				method: 'suite.mail.jmap.get_user_account_ids',
				args: {
					user: frm.doc.user,
				},
				callback: (r) => {
					frm.set_df_property('account_id', 'options', r.message || [])
					frm.refresh_field('account_id')
				},
			})
		} else {
			frm.set_df_property('account_id', 'options', [])
			frm.refresh_field('account_id')
		}
	},
})
