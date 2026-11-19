// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('HR Calendar Sync Settings', {
	refresh(frm) {
		frm.add_custom_button(__('Test Connection'), () => frm.trigger('test_connection'))
		frm.add_custom_button(__('Sync Now'), () => frm.trigger('sync_now'))
	},

	async test_connection(frm) {
		await saveFirst(frm)
		const { message } = await frm.call({ doc: frm.doc, method: 'test_connection', freeze: true })
		if (!message) return
		// The names are HR's: escaped before any of it is markup.
		const lists = frappe.utils.escape_html(message.holiday_lists.join(', ') || '—')
		const unknown = frappe.utils.escape_html(message.unknown_holiday_lists.join(', '))
		frappe.msgprint({
			title: __('What the settings can see'),
			indicator: 'blue',
			message: `
				<p>${__('Active employees')}: <b>${message.employees}</b>
				(${__('with a birth date')}: ${message.with_birth_date},
				${__('with a joining date')}: ${message.with_joining_date})</p>
				<p>${__('Holiday lists')}: ${lists}</p>
				${unknown && `<p class="text-danger">${__('Named above but not in HR, so never synced')}: ${unknown}</p>`}
			`,
		})
	},

	async sync_now(frm) {
		await saveFirst(frm)
		await frm.call({ doc: frm.doc, method: 'sync_now', freeze: true })
		frappe.msgprint({
			title: __('Sync started'),
			indicator: 'blue',
			message: __(
				'It runs in the background. Reload this page in a minute: what it did shows as Last Sync, and anything that went wrong as Last Error. Then choose who sees each calendar in External Calendar.',
			),
		})
	},
})

// Both buttons act on what is saved, so anything typed and not yet saved is saved first.
async function saveFirst(frm) {
	if (frm.is_dirty()) await frm.save()
}
