interface DocType {
  name: string
  creation: string
  modified: string
  owner: string
  modified_by: string
}

// Last updated: 2026-08-03 00:00:00.000000
export interface ParticipantIdentity extends DocType {
  /** Identity ID: Data */
  id?: string
  /** Name: Data */
  _name?: string
  /** Email: Data */
  email: string
  /** Set as default Participant Identity: Check */
  default: 0 | 1
  /** Account: Link (JMAP Account) */
  account: string
}

// Last updated: 2026-04-15 08:27:17.244854
export interface UserAccount extends DocType {
  /** User: Link (User) */
  user: string
  /** Name: Data */
  _name: string
  /** Personal: Check */
  is_personal: 0 | 1
  /** Readonly: Check */
  is_read_only: 0 | 1
  /** Account ID: Data */
  id: string
  /** Capabilities: JSON */
  capabilities?: any
}
