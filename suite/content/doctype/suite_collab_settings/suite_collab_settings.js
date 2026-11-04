frappe.ui.form.on("Suite Collab Settings", {
	refresh(frm) {
		const report = JSON.parse(frm.doc.self_test_report || "{}");
		if (report.node_checks === false) {
			frm.dashboard.set_headline_alert(
				__(
					"Node 24 or later isn't available, so only pycrdt checks what trimming deletes"
				),
				"orange"
			);
		}

		frm.add_custom_button(__("Run collaboration self-test"), async () => {
			await frappe.xcall("suite.content.selftest.run_self_test");
			frappe.show_alert(__("Self-test queued; reload to see its result"));
		});
	},
});
