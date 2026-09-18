// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('HR Calendar Sync Settings', {
	refresh(frm) {
		frm.add_custom_button(__('Test Connection'), () => frm.trigger('test_connection'))
		frm.add_custom_button(__('Sync Now'), () => frm.trigger('sync_now'))
	},

	test_connection(frm) {
		frm.call({ doc: frm.doc, method: 'test_connection', freeze: true }).then(({ message }) => {
			if (!message) return
			frappe.msgprint({
				title: __('What the settings can see'),
				indicator: 'blue',
				message: `
					<p>${__('Employees')}: <b>${message.employees}</b>
					(${__('with birth date')}: ${message.with_birth_date},
					${__('with joining date')}: ${message.with_joining_date},
					${__('with a mail address')}: ${message.with_mail_address})</p>
					<p>${__('Holiday lists')}: ${frappe.utils.escape_html(message.holiday_lists.join(', ') || '—')}</p>
					<p>${__("The service account's calendars")}: ${frappe.utils.escape_html(message.calendars.join(', ') || '—')}</p>
				`,
			})
		})
	},

	sync_now(frm) {
		frm.call({ doc: frm.doc, method: 'sync_now', freeze: true }).then(() => {
			frappe.msgprint({
				title: __('Sync started'),
				indicator: 'blue',
				message: __(
					'It runs in the background. Reload this page in a minute: what it did shows as Last Sync, and anything that went wrong as Last Error.',
				),
			})
		})
	},
})
