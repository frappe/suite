// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on('Booking Page', {
  // The zones come from the same list the User form offers.
  async before_load(frm) {
    if (!frappe.all_timezones) {
      const r = await frappe.call('frappe.core.doctype.user.user.get_timezones')
      frappe.all_timezones = r.message.timezones
    }
    frm.fields_dict.time_zone.set_data(frappe.all_timezones)
  },
})
