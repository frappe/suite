import { DEMO_DOMAIN, DEMO_URL } from "../demo";
import type { Credentials } from "../../shared/auth";
import type { BaseScene } from "../scene";
import { benchPython, siteOf } from "./setup-helpers";

/**
 * People added to the demo site after setup, for the welcome and for an empty
 * Home. Administrator creates each one with the bench's Python, the way an
 * Admin's direct creation leaves them, and the scene removes them with their
 * Drive when it closes.
 */

export interface NewPerson {
	firstName: string;
	lastName: string;
	/**
	 * The password is temporary: the server reports `must_change_password`,
	 * as after an Admin's Replace temporary password.
	 */
	temporary?: boolean;
	/** Still owes the welcome (`suite_needs_welcome`), as everyone added after setup does. */
	welcome?: boolean;
}

const PASSWORD = "Harbor-Lights-2026";

const CREATE = `
def run(data):
    from frappe.utils import add_to_date, now_datetime
    from suite.composition.welcome import NEEDS_WELCOME
    from suite.suite_core.account_state import write
    frappe.set_user("Administrator")
    user = frappe.get_doc({
        "doctype": "User",
        "email": data["email"],
        "first_name": data["first_name"],
        "last_name": data["last_name"],
        "enabled": 1,
        "send_welcome_email": 0,
        "new_password": data["password"],
    })
    user.insert(ignore_permissions=True)
    user.reload()
    user.add_roles("Suite User")
    if data["temporary"]:
        write(
            data["email"],
            must_change_password=1,
            temporary_expires_at=add_to_date(now_datetime(), days=7),
            status="Password change required",
        )
    if not data["welcome"]:
        frappe.defaults.clear_user_default(NEEDS_WELCOME, data["email"])
    return data["email"]
`;

const REMOVE = `
def run(data):
    from suite.drive._core.roots import archive_personal_root, personal_root_for, purge_root
    from suite.drive.framework import principals_for
    frappe.set_user("Administrator")
    email = data["email"]
    if not frappe.db.exists("User", email):
        return False
    root = personal_root_for(email)
    if root:
        archive_personal_root(email)
        purge_root(root, principals_for("Administrator"))
    frappe.delete_doc("User", email, ignore_permissions=True, force=True)
    frappe.db.delete("Suite Account State", {"user": email})
    frappe.defaults.clear_default(parent=email)
    return True
`;

/** Creates a person on the demo site and removes them, with their Drive, when the scene closes. */
export function addPerson(scene: BaseScene, person: NewPerson): Credentials {
	const site = siteOf(DEMO_URL);
	const slug = scene.name(`${person.firstName}.${person.lastName}`).toLowerCase().replace(/[^a-z0-9.]+/g, ".");
	const email = `${slug}@${DEMO_DOMAIN}`;
	benchPython(site, CREATE, {
		email,
		first_name: person.firstName,
		last_name: person.lastName,
		password: PASSWORD,
		temporary: person.temporary ?? false,
		welcome: person.welcome ?? true,
	});
	scene.defer(async () => benchPython(site, REMOVE, { email }));
	return { email, password: PASSWORD };
}

/** Signs the scene's page in as `user`, replacing whoever it was signed in as. */
export async function signInAs(scene: BaseScene, user: Credentials): Promise<void> {
	await scene.api.post("/api/method/logout");
	const response = await scene.api.post("/api/method/login", { form: { usr: user.email, pwd: user.password } });
	if (!response.ok()) throw new Error(`Login failed for ${user.email} with status ${response.status()}`);
}

/** Signs the scene's page out, for the pages a guest sees. */
export async function signOut(scene: BaseScene): Promise<void> {
	await scene.api.post("/api/method/logout");
}
