// Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Presentation", {
	refresh: function (frm) {
		if (!frm.doc.__islocal) {
			const slug = frm.doc.slug ? `/${encodeURIComponent(frm.doc.slug)}` : "";
			frm.add_web_link(`/slides/presentation/${frm.doc.name}${slug}`, __("Open Presentation"));
		}
	},
});
