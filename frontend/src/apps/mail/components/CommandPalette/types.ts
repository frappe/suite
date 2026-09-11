export interface MailSearchFilterBadge {
  key: string;
  value: string;
  displayValue: string;
}

export interface MailContactSuggestion {
  resultType: "mail-contact";
  value: string;
  label: string;
  email: string;
  name?: string;
  user_image?: string;
}

export interface MailFilterSuggestion {
  resultType: "mail-filter-suggestion";
  value: string;
  label: string;
  filterKey: string;
  filterValue: string;
  icon: string;
  iconClass?: string;
}

export interface MailSearchResult {
  resultType: "mail";
  account: string;
  thread_id: string;
  subject?: string;
  from_name?: string;
  from_email: string;
  recipients?: Recipient[];
  mailboxes?: Mailbox[];
  attachments?: Attachment[];
  received_at?: string;
}
import type { Attachment, Mailbox, Recipient } from "@/apps/mail/types";
