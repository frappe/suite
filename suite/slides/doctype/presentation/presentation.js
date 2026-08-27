// Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Presentation", {
	refresh: function (frm) {
		if (!frm.doc.__islocal) {
			const slug = frm.doc.slug ? `/${encodeURIComponent(frm.doc.slug)}` : "";
			frm.add_web_link(`/slides/presentation/${frm.doc.name}${slug}`, __("Open Presentation"));
		}
		frm.add_custom_button("Optimize Images", function () {
			frappe.call({
				method: "suite.slides.doctype.presentation.presentation.optimize_images",
				args: {
					name: frm.doc.name,
				},
				callback: function (r) {
					if (r.message) {
						frappe.msgprint("Image optimization completed successfully.");
					}
				},
			});
		});
	},
});
