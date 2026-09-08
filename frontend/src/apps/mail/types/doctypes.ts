interface DocType {
    name: string;
    creation: string;
    modified: string;
    owner: string;
    modified_by: string;
  }

  interface ChildDocType extends DocType {
    parent?: string;
    parentfield?: string;
    parenttype?: string;
    idx?: number;
  }

// Last updated: 2025-11-20 15:22:07.630230
interface EmailAddress extends ChildDocType {
	/** Display Name: Data */
	display_name?: string
	/** Email: Data */
	email: string
}

// Last updated: 2026-04-15 19:56:45.317786
export interface File extends DocType {
  /** File Name: Data */
  file_name?: string;
  /** Is Private: Check */
  is_private: 0 | 1;
  /** Is Home Folder: Check */
  is_home_folder: 0 | 1;
  /** Is Attachments Folder: Check */
  is_attachments_folder: 0 | 1;
  /** File Size: Int */
  file_size?: number;
  /** File URL: Code */
  file_url?: string;
  /** Thumbnail URL: Small Text */
  thumbnail_url?: string;
  /** Folder: Link (File) */
  folder?: string;
  /** Is Folder: Check */
  is_folder: 0 | 1;
  /** Attached To DocType: Link (DocType) */
  attached_to_doctype?: string;
  /** Attached To Name: Data */
  attached_to_name?: string;
  /** Attached To Field: Data */
  attached_to_field?: string;
  /** old_parent: Data */
  old_parent?: string;
  /** Content Hash: Data */
  content_hash?: string;
  /** Uploaded To Dropbox: Check */
  uploaded_to_dropbox: 0 | 1;
  /** Uploaded To Google Drive: Check */
  uploaded_to_google_drive: 0 | 1;
  /** File Type: Data */
  file_type?: string;
}

// Last updated: 2026-04-17 13:35:58.399195
export interface Identity extends DocType {
  /** May Delete: Check */
  may_delete: 0 | 1;
  /** Identity ID: Data */
  id?: string;
  /** Name: Data */
  _name?: string;
  /** Email: Data */
  email: string;
  /** Bcc: Table (Email Address) */
  bcc: EmailAddress[];
  /** Reply To: Table (Email Address) */
  reply_to: EmailAddress[];
  /** HTML: HTML Editor */
  html_signature?: any;
  /** Text: Code */
  text_signature?: string;
  /** Account: Select */
  account: any;
  /** User: Link (User) */
  user?: string;
}

// Last updated: 2026-04-16 12:20:38.930196
export interface MailSignature extends DocType {
  /** Signature Name: Data */
  signature_name: string;
  /** HTML: Code */
  html_body?: string;
  /** User: Link (User) */
  user: string;
}

// Last updated: 2026-04-17 14:12:49.529770
export interface VacationResponse extends DocType {
  /** Enabled: Check */
  enabled: 0 | 1;
  /** From Date: Datetime */
  from_date?: string;
  /** To Date: Datetime */
  to_date?: string;
  /** Subject: Data */
  subject?: string;
  /** Text: Code */
  text_body?: string;
  /** HTML: Text Editor */
  html_body?: string;
  /** Account: Select */
  account: any;
  /** User: Link (User) */
  user?: string;
}

// Last updated: 2026-04-17 13:38:14.276046
export interface SieveScript extends DocType {
  /** Sieve Script ID: Data */
  id?: string;
  /** Name: Data */
  _name: string;
  /** Blob ID: Data */
  blob_id?: string;
  /** Active: Check */
  active: 0 | 1;
  /** Content: Code */
  content: string;
  /** Read Only: Check */
  read_only: 0 | 1;
  /** Account: Select */
  account: any;
  /** User: Link (User) */
  user?: string;
}

// Last updated: 2026-04-15 08:27:17.244854
export interface UserAccount extends DocType {
  /** User: Link (User) */
  user: string;
  /** Name: Data */
  _name: string;
  /** Personal: Check */
  is_personal: 0 | 1;
  /** Readonly: Check */
  is_read_only: 0 | 1;
  /** Account ID: Data */
  id: string;
  /** Capabilities: JSON */
  capabilities?: any;
}
