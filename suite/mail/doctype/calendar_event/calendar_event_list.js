// Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.listview_settings['Calendar Event'] = {
	refresh: (listview) => {
		add_bulk_delete_button_to_actions(listview)
		set_account_options(listview)
	},

	get_indicator: (doc) => {
		const status_colors = {
			Tentative: 'blue',
			Confirmed: 'green',
			Cancelled: 'red',
		}
		return [__(doc.status), status_colors[doc.status] || 'darkgrey', 'status,=,' + doc.status]
	},
}

function add_bulk_delete_button_to_actions(listview) {
	listview.page.add_actions_menu_item(__('Bulk Delete'), () => {
		const count = listview.get_checked_items().length

		frappe.confirm(
			__('Delete {0} {1} permanently?', [count, count === 1 ? 'item' : 'items']),
			() => {
				frappe.call({
					method: 'suite.mail.doctype.calendar_event.calendar_event.bulk_delete',
					args: {
						names: listview.get_checked_items(true),
					},
					callback: (r) => {
						if (!r.exc) {
							listview.refresh()
						}
					},
				})
			},
		)
	})
}

function set_account_options(listview) {
	const user_field = listview.page.fields_dict.user
	if (!user_field) return

	const user = user_field ? user_field.get_value() : null
	if (!user) return

	frappe.call({
		method: 'suite.mail.jmap.get_user_account_ids',
		args: {
			user: user,
		},
		callback: (r) => {
			const account_field = listview.page.fields_dict.account_id
			if (!account_field) return

			const options = r.message || []
			options.unshift('')
			account_field.df.options = options
			account_field.set_options()
		},
	})
}
