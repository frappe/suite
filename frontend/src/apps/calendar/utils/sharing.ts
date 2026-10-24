/**
 * How much of a calendar a sharee sees: every event on it. JMAP has a narrower right —
 * free/busy — but on Stalwart a reader granted only that is shown nothing at all, so it is
 * not offered; a grant made elsewhere reads back as Custom.
 */
export type ShareRole = 'view'

/** A sharee as `get_calendar_sharing` sends it. */
export type Sharee = {
	principal_id: string
	/**
	 * What their rights amount to, or `null` where they amount to neither role — granted by
	 * another CalDAV client, or by an administrator. Those are shown and left alone.
	 */
	role: ShareRole | null
	name?: string | null
	email?: string | null
	type?: string | null
}

/** Somebody the picker offers, as `search_principals` sends them. */
export type Principal = {
	principal_id: string
	name?: string | null
	email?: string | null
	type?: string | null
}

/**
 * What a sharee is called in a row: the principal's name, unless that is the address over
 * again — the mail server often names a principal after its address, and a row that reads
 * "akash@frappe.io" twice says nothing the second time.
 */
export const shareeName = (sharee: Principal | Sharee): string => {
	const name = (sharee.name || '').trim()
	const email = (sharee.email || '').trim()
	return name && name.toLowerCase() !== email.toLowerCase() ? name : email || sharee.principal_id
}

/**
 * What a save sends: the sharees this app has a role for. One whose rights match no role is
 * left out, and the server keeps it — saving two roles is no reason to take away a third.
 */
export const managedSharees = (sharees: Sharee[]): { principal_id: string; role: ShareRole }[] =>
	sharees
		.filter((sharee): sharee is Sharee & { role: ShareRole } => !!sharee.role)
		.map(({ principal_id, role }) => ({ principal_id, role }))

/**
 * Whether somebody is already on the calendar, so the picker can say so rather than offering
 * a second row for them. Custom sharees count: they are on it, however they got there.
 */
export const isShared = (sharees: Sharee[], principal_id: string): boolean =>
	sharees.some((sharee) => sharee.principal_id === principal_id)
