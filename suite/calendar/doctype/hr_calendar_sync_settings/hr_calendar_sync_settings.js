// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('HR Calendar Sync Settings', {
	refresh(frm) {
		frm.add_custom_button(__('Test Connection'), () => frm.trigger('test_connection'))
		frm.add_custom_button(__('Sync Now'), () => frm.trigger('sync_now'))
	},

	// Both act on what is saved, so anything typed and not yet saved is saved first.
	async save_first(frm) {
		if (frm.is_dirty()) await frm.save()
	},

	async test_connection(frm) {
		await frm.events.save_first(frm)
		frm.call({ doc: frm.doc, method: 'test_connection', freeze: true }).then(({ message }) => {
			if (!message) return
			// The names are HR's: escaped here, as one string, before any of it is markup.
			const followers = frappe.utils.escape_html(
				Object.entries(message.followers)
					.map(([list, people]) => `${list} (${people})`)
					.join(', '),
			)
			frappe.msgprint({
				title: __('What the settings can see'),
				indicator: 'blue',
				message: `
					<p>${__('Employees')}: <b>${message.employees}</b>
					(${__('with birth date')}: ${message.with_birth_date},
					${__('with joining date')}: ${message.with_joining_date},
					${__('with a mail address')}: ${message.with_mail_address})</p>
					<p>${__('Holiday lists')}: ${frappe.utils.escape_html(message.holiday_lists.join(', ') || '—')}</p>
					<p>${__('Who follows which, by Holiday List Assignment')}: ${followers || '—'}</p>
					<p>${__("The service account's calendars")}: ${frappe.utils.escape_html(message.calendars.join(', ') || '—')}</p>
				`,
			})
		})
	},

	async sync_now(frm) {
		await frm.events.save_first(frm)
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
