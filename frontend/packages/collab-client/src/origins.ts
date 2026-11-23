// Updates applied from the server; everything else in the doc is this tab's own work
export const REMOTE = Symbol('collab-remote')
// Another tab's unsent work, applied here so this tab shows and sends it
export const ADOPT = Symbol('collab-adopt')
// This tab's restore of a version, which only the restore's push carries
export const RESTORE = Symbol('collab-restore')
// Transaction meta: each update a pull applied, a row apiece, so an app can tell what each row named
export const APPLIED_UPDATE = Symbol('collab-applied-update')
// Transaction meta: the one update an adopt applied, merged from the rows in APPLIED_UPDATE
export const MERGED_UPDATE = Symbol('collab-merged-update')
