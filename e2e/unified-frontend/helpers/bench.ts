import { execFileSync } from "node:child_process";

const BENCH = process.env.BENCH_PATH ?? "/home/faris/benches/suite-bench";
const PYTHON = `${BENCH}/env/bin/python`;
const SITES = `${BENCH}/sites`;
const SITE = process.env.BENCH_SITE ?? "slides.localhost";

/**
 * Notification fixtures, written straight to the site.
 *
 * Nothing creates a Drive Notification over HTTP yet: sharing is ticket 008.
 * The bell journey therefore seeds real rows through the bench interpreter,
 * reads them back, and removes them again.
 */
const PROGRAM = `
import json, sys
import frappe

frappe.init(site=${JSON.stringify(SITE)})
frappe.connect()
action, payload = sys.argv[1], sys.argv[2]

if action == "seed":
    made = []
    for index in range(2):
        activity = frappe.get_doc({
            "doctype": "Drive Activity",
            "node": payload,
            "action": "share_add",
            "actor": "Administrator",
            "at": frappe.utils.now_datetime(),
            "detail": json.dumps({"role": "editor"}),
        }).insert(ignore_permissions=True)
        notification = frappe.get_doc({
            "doctype": "Drive Notification",
            "activity": activity.name,
            "to_user": "Administrator",
            "from_user": "Administrator",
            "read": 0,
            "type": "Share",
            "message": f"shared a file with you ({index})",
        }).insert(ignore_permissions=True)
        made.append(notification.name)
    frappe.db.commit()
    answer = json.dumps(made)
elif action == "state":
    answer = json.dumps(frappe.get_all(
        "Drive Notification",
        filters={"name": ["in", json.loads(payload)]},
        fields=["name", "read"],
    ))
elif action == "unread":
    answer = json.dumps(frappe.get_all(
        "Drive Notification", filters={"to_user": "Administrator", "read": 0}, pluck="name"
    ))
elif action == "restore":
    for name in json.loads(payload):
        if frappe.db.exists("Drive Notification", name):
            frappe.db.set_value("Drive Notification", name, "read", 0, update_modified=False)
    frappe.db.commit()
    answer = "ok"
elif action == "drop":
    # The Drive Activity controller refuses delete_doc, so its rows go through
    # frappe.db.delete.
    activities = []
    for name in json.loads(payload):
        if not frappe.db.exists("Drive Notification", name):
            continue
        activities.append(frappe.db.get_value("Drive Notification", name, "activity"))
        frappe.delete_doc("Drive Notification", name, force=True, ignore_permissions=True)
    activities = [name for name in activities if name]
    if activities:
        frappe.db.delete("Drive Activity", {"name": ["in", activities]})
    frappe.db.commit()
    answer = "ok"
else:
    raise SystemExit(f"unknown action {action}")

print("RESULT " + answer)
frappe.destroy()
`;

function call(action: string, payload: string): string {
	const output = execFileSync(PYTHON, ["-c", PROGRAM, action, payload], {
		cwd: SITES,
		encoding: "utf8",
	});
	const line = output.split("\n").find((row) => row.startsWith("RESULT "));
	if (!line) throw new Error(`the ${action} fixture produced no result:\n${output}`);
	return line.slice("RESULT ".length).trim();
}

/** Seed two unread notifications that point at one existing node. */
export function seedNotifications(node: string): string[] {
	return JSON.parse(call("seed", node)) as string[];
}

export function notificationState(names: string[]): Array<{ name: string; read: number }> {
	return JSON.parse(call("state", JSON.stringify(names))) as Array<{ name: string; read: number }>;
}

export function dropNotifications(names: string[]): void {
	call("drop", JSON.stringify(names));
}

/** The account's unread rows before a journey seeds its own. */
export function unreadNotificationNames(): string[] {
	return JSON.parse(call("unread", "")) as string[];
}

/** Put the account's own unread rows back the way the journey found them. */
export function restoreUnread(names: string[]): void {
	call("restore", JSON.stringify(names));
}
