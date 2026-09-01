// Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Mail Settings', {
	refresh(frm) {
		frm.trigger('add_actions')
	},

	add_actions(frm) {
		frm.add_custom_button(
			__('Generate JMAP Push Keys'),
			() => frm.trigger('generate_jmap_push_keys'),
			__('Actions'),
		)

		if (frappe.user.has_role('System Manager')) {
			frm.add_custom_button(
				__('Destroy Data Store'),
				() => frm.trigger('destroy_data_store'),
				__('Actions'),
			)

			frm.add_custom_button(
				__('Destroy Blob Store'),
				() => frm.trigger('destroy_blob_store'),
				__('Actions'),
			)

			frm.add_custom_button(
				__('Destroy Search Index'),
				() => frm.trigger('destroy_search_index'),
				__('Actions'),
			)

			frm.add_custom_button(
				__('Rebuild Email Address Index'),
				() => frm.trigger('rebuild_email_address_index'),
				__('Actions'),
			)
		}
	},

	generate_jmap_push_keys(frm) {
		frappe.confirm(
			__(
				'This will replace any existing JMAP Push keys. Existing push subscriptions must be recreated after generating new keys. Continue?',
			),
			() => {
				frappe.call({
					doc: frm.doc,
					method: 'generate_jmap_push_keys',
					freeze: true,
					freeze_message: __('Generating keys…'),
					callback: (r) => {
						if (!r.exc) frm.reload_doc()
					},
				})
			},
		)
	},

	destroy_data_store() {
		frappe.confirm(
			__(
				'This will permanently delete all data in the Data Store. This action cannot be undone. Do you want to continue?',
			),
			() => {
				frappe.call({
					method: 'suite.mail.store.destroy_data_store',
					freeze: true,
					freeze_message: __('Destroying Data Store…'),
					callback: (r) => {
						if (!r.exc) frappe.msgprint(__('Data Store destroyed successfully.'))
					},
				})
			},
		)
	},

	destroy_blob_store() {
		frappe.confirm(
			__(
				'This will permanently delete all data in the Blob Store. This action cannot be undone. Do you want to continue?',
			),
			() => {
				frappe.call({
					method: 'suite.mail.store.destroy_blob_store',
					freeze: true,
					freeze_message: __('Destroying Blob Store…'),
					callback: (r) => {
						if (!r.exc) frappe.msgprint(__('Blob Store destroyed successfully.'))
					},
				})
			},
		)
	},

	destroy_search_index() {
		frappe.confirm(
			__(
				'This will permanently delete all search indexes. This action cannot be undone. Do you want to continue?',
			),
			() => {
				frappe.call({
					method: 'suite.mail.store.destroy_search_index',
					freeze: true,
					freeze_message: __('Destroying Search Index…'),
					callback: (r) => {
						if (!r.exc) frappe.msgprint(__('Search Index destroyed successfully.'))
					},
				})
			},
		)
	},

	rebuild_email_address_index() {
		frappe.confirm(
			__(
				'This will rebuild the email address search index for all accounts from cached data in the background. Do you want to continue?',
			),
			() => {
				frappe.call({
					method: 'suite.mail.store.rebuild_all_email_address_indexes',
					freeze: true,
					freeze_message: __('Queuing rebuild…'),
					callback: (r) => {
						if (!r.exc) frappe.msgprint(__('Rebuilding the email address index in the background.'))
					},
				})
			},
		)
	},
})
