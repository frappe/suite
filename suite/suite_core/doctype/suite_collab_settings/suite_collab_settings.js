frappe.ui.form.on("Suite Collab Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Run collaboration self-test"), () =>
			frappe
				.xcall("suite.suite_core.content.selftest.run_self_test")
				.then(() => frappe.show_alert(__("Self-test queued; reload to see its result")))
		);
	},
});
