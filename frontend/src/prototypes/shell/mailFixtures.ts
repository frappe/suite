// PROTOTYPE — remove. Fake mail data for the throwaway shell prototype.
// Nothing here persists or talks to the backend.
//
// The threads are reactive because the prototype writes to them: opening a
// thread clears its unread flag, and the sidebar counts and the rail badge are
// derived from the same rows, so they have to follow.
//
// A thread owns its messages, so the reading pane can show a real conversation
// instead of one snippet. The list line is derived from the last message, which
// is what keeps the two panes from disagreeing.

import { reactive, ref } from 'vue'

import { PEOPLE, USER } from './fixtures'

export interface Mailbox {
  id: string
  label: string
  icon: string
}

export interface MailAttachment {
  name: string
  size: string
  icon: string
}

export interface MailMessage {
  id: string
  from: string
  fromEmail: string
  /** Display names, "Me" included. Drives the "to …" line. */
  to: string[]
  /** Short label for the list and the collapsed message row. */
  time: string
  /** Full stamp for the expanded message header. */
  sentAt: string
  body: string[]
  attachments?: MailAttachment[]
}

export type MailLabel = 'Work' | 'Support' | 'Billing' | 'Automated' | 'Personal'

export interface MailThread {
  id: string
  mailbox: string
  subject: string
  labels: MailLabel[]
  unread: boolean
  starred: boolean
  messages: MailMessage[]
}

const PDF = 'lucide-file-text'
const SHEET = 'lucide-table'
const DECK = 'lucide-presentation'
const IMG = 'lucide-image'

export const MAIL_THREADS: MailThread[] = reactive([
  {
    id: 't1',
    mailbox: 'inbox',
    subject: 'Suite shell direction',
    labels: ['Work'],
    unread: true,
    starred: true,
    messages: [
      {
        id: 't1m1',
        from: 'Arjun Menon',
        fromEmail: 'arjun@frappe.io',
        to: ['Me', 'Neha Kulkarni'],
        time: 'Fri',
        sentAt: 'Fri, 14 Aug 2026 at 18:20',
        body: [
          'I looked at both shells again after the call. The rail plus contextual panel reads better than the two-level sidebar, mostly because the panel can be empty without the page looking broken.',
          'One thing I am not sure about: does the workspace switcher belong in the panel, or above the rail?',
        ],
      },
      {
        id: 't1m2',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Arjun Menon', 'Neha Kulkarni'],
        time: 'Fri',
        sentAt: 'Fri, 14 Aug 2026 at 19:04',
        body: [
          'Panel, for now. Above the rail it competes with the product mark and there is no room for the subtitle line.',
          'I will put both in the prototype so we can click them instead of arguing about them.',
        ],
      },
      {
        id: 't1m3',
        from: 'Arjun Menon',
        fromEmail: 'arjun@frappe.io',
        to: ['Me', 'Neha Kulkarni'],
        time: '09:41',
        sentAt: 'Today at 09:41',
        body: [
          'The contextual swap feels closer to what we discussed. Two things before this goes further:',
          '1. Mail needs a reading pane that survives a long thread: collapsed older messages, not a wall of text.\n2. The unread indicator has to sit on the sender line. On the subject line it reads like a label.',
          'Rest looks good. Ship the prototype to the team channel and let people poke at it.',
        ],
      },
    ],
  },
  {
    id: 't2',
    mailbox: 'inbox',
    subject: '[frappe/suite] PR #482 merged: unified workspace sidebar',
    labels: ['Automated'],
    unread: true,
    starred: false,
    messages: [
      {
        id: 't2m1',
        from: 'GitHub',
        fromEmail: 'notifications@github.com',
        to: ['Me'],
        time: '09:12',
        sentAt: 'Today at 09:12',
        body: [
          'faris merged 14 commits into develop from prototype/suite-shell.',
          '18 files changed, 1,204 additions, 337 deletions. All 6 checks passed.',
        ],
      },
    ],
  },
  {
    id: 't3',
    mailbox: 'inbox',
    subject: 'Recurring events duplicate after a timezone change',
    labels: ['Work'],
    unread: true,
    starred: false,
    messages: [
      {
        id: 't3m1',
        from: 'Priya Nair',
        fromEmail: 'priya@frappe.io',
        to: ['Me', 'Aditya Verma'],
        time: 'Thu',
        sentAt: 'Thu, 13 Aug 2026 at 11:32',
        body: [
          'Three customers reported it this week. Move a recurring event across a DST boundary and every future instance is written twice.',
          'I can reproduce it on the staging site with any weekly series. Steps and a trace are attached.',
        ],
        attachments: [
          { name: 'recurring-duplicate-trace.pdf', size: '412 KB', icon: PDF },
          { name: 'repro-steps.png', size: '188 KB', icon: IMG },
        ],
      },
      {
        id: 't3m2',
        from: 'Aditya Verma',
        fromEmail: 'aditya@frappe.io',
        to: ['Priya Nair', 'Me'],
        time: 'Thu',
        sentAt: 'Thu, 13 Aug 2026 at 15:10',
        body: [
          'The expansion runs in local time but the stored rule is UTC, so the shifted instance no longer matches the one already written. It is not a duplicate insert, it is a failed match.',
          'Fix is to compare on the series id, not on the start time. Small patch, but it needs a migration for rows already doubled.',
        ],
      },
      {
        id: 't3m3',
        from: 'Priya Nair',
        fromEmail: 'priya@frappe.io',
        to: ['Aditya Verma', 'Me'],
        time: '08:55',
        sentAt: 'Today at 08:55',
        body: [
          'Patch is up. The migration found 1,842 duplicated rows on staging and cleaned all of them.',
          'Can one of you review before the Friday release cut? It blocks the calendar beta.',
        ],
      },
    ],
  },
  {
    id: 't4',
    mailbox: 'inbox',
    subject: 'SSO login fails for our team on suite.frappe.cloud',
    labels: ['Support'],
    unread: true,
    starred: false,
    messages: [
      {
        id: 't4m1',
        from: 'Meera Iyer',
        fromEmail: 'meera.iyer@northwind.co',
        to: ['Support'],
        time: 'Wed',
        sentAt: 'Wed, 12 Aug 2026 at 16:44',
        body: [
          'Since Tuesday, nobody at Northwind can sign in with Okta. We get "invalid audience" and land back on the login page.',
          'Around 60 people are affected. Everything worked before the weekend and we changed nothing on our side.',
        ],
      },
      {
        id: 't4m2',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Meera Iyer'],
        time: 'Wed',
        sentAt: 'Wed, 12 Aug 2026 at 17:20',
        body: [
          'Thanks for the detail. The audience string is built from the site URL, and your site moved to a custom domain on Saturday. That is almost certainly it.',
          'Could you send the Okta application audience value so I can confirm before I change anything?',
        ],
      },
      {
        id: 't4m3',
        from: 'Meera Iyer',
        fromEmail: 'meera.iyer@northwind.co',
        to: ['Me'],
        time: '07:38',
        sentAt: 'Today at 07:38',
        body: [
          'Attached the Okta config export. The audience is still the old suite.frappe.cloud value.',
          'Please tell us which side should change it. We have a board demo on Monday.',
        ],
        attachments: [{ name: 'okta-app-config.pdf', size: '96 KB', icon: PDF }],
      },
    ],
  },
  {
    id: 't5',
    mailbox: 'inbox',
    subject: 'Design tokens audit, round two',
    labels: ['Work'],
    unread: true,
    starred: false,
    messages: [
      {
        id: 't5m1',
        from: 'Neha Kulkarni',
        fromEmail: 'neha@frappe.io',
        to: ['Me', 'Aditya Verma'],
        time: 'Yesterday',
        sentAt: 'Yesterday at 14:02',
        body: [
          'All seven frontends now use the semantic ramps, except Slides, which still has 34 raw hex values in the theme editor.',
          'The sheet lists every remaining offender with the token it should map to. Most are one-line replacements.',
        ],
        attachments: [{ name: 'token-audit-aug.xlsx', size: '184 KB', icon: SHEET }],
      },
      {
        id: 't5m2',
        from: 'Neha Kulkarni',
        fromEmail: 'neha@frappe.io',
        to: ['Me', 'Aditya Verma'],
        time: 'Yesterday',
        sentAt: 'Yesterday at 14:19',
        body: [
          'One decision needed from you: dark mode for Slides. Do we invert the canvas, or keep the deck light inside a dark chrome?',
          'Every other app answered this the same way, so I would rather not invent a third answer here.',
        ],
      },
    ],
  },
  {
    id: 't6',
    mailbox: 'inbox',
    subject: 'Invoice INV-2026-0812 for suite.frappe.cloud',
    labels: ['Billing'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 't6m1',
        from: 'Frappe Cloud',
        fromEmail: 'billing@frappe.cloud',
        to: ['Me'],
        time: 'Yesterday',
        sentAt: 'Yesterday at 06:00',
        body: [
          'Your invoice for August is ready. Amount due: $248.00, charged on 25 August to the card ending 4412.',
          'Usage this period: 3 sites, 12 GB storage, 1.4 M requests.',
        ],
        attachments: [{ name: 'INV-2026-0812.pdf', size: '58 KB', icon: PDF }],
      },
    ],
  },
  {
    id: 't7',
    mailbox: 'inbox',
    subject: 'Re: Auth spec, comments on section 4',
    labels: ['Work'],
    unread: false,
    starred: true,
    messages: [
      {
        id: 't7m1',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Aditya Verma'],
        time: 'Wed',
        sentAt: 'Wed, 12 Aug 2026 at 10:05',
        body: [
          'Section 4 still assumes one session per user. With the shell, a person can have Mail open on a phone and Files on a laptop, and revoking one should not sign out the other.',
        ],
      },
      {
        id: 't7m2',
        from: 'Aditya Verma',
        fromEmail: 'aditya@frappe.io',
        to: ['Me'],
        time: 'Wed',
        sentAt: 'Wed, 12 Aug 2026 at 12:41',
        body: [
          'Agreed. I rewrote 4.2 around a session list with a device label and a last-seen stamp. Revoking is per row.',
          'That also gives Settings something real to render, which it did not have before.',
        ],
      },
      {
        id: 't7m3',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Aditya Verma'],
        time: 'Wed',
        sentAt: 'Wed, 12 Aug 2026 at 13:02',
        body: ['Good. Send it to Arjun once the diagram is in.'],
      },
    ],
  },
  {
    id: 't8',
    mailbox: 'inbox',
    subject: 'Weekly mail report for frappe.io',
    labels: ['Automated'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 't8m1',
        from: 'Stalwart',
        fromEmail: 'reports@stalwart.frappe.io',
        to: ['Me'],
        time: 'Wed',
        sentAt: 'Wed, 12 Aug 2026 at 05:00',
        body: [
          '312 messages delivered, 4 greylisted, 0 bounced. DMARC alignment held at 100% for the seventh week.',
          'One outbound queue spike on Tuesday cleared in 11 minutes without intervention.',
        ],
      },
    ],
  },
  {
    id: 't9',
    mailbox: 'inbox',
    subject: 'Offsite agenda, September',
    labels: ['Work'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 't9m1',
        from: 'Arjun Menon',
        fromEmail: 'arjun@frappe.io',
        to: ['Me', 'Priya Nair', 'Neha Kulkarni', 'Aditya Verma'],
        time: 'Tue',
        sentAt: 'Tue, 11 Aug 2026 at 09:15',
        body: [
          'Draft agenda for the September offsite is in the deck. Two days, one afternoon kept free on purpose.',
          'Comments welcome until Friday. After that I book the rooms.',
        ],
        attachments: [{ name: 'offsite-agenda-sept.key', size: '4.2 MB', icon: DECK }],
      },
      {
        id: 't9m2',
        from: 'Priya Nair',
        fromEmail: 'priya@frappe.io',
        to: ['Arjun Menon', 'Me'],
        time: 'Tue',
        sentAt: 'Tue, 11 Aug 2026 at 11:47',
        body: [
          'Can we move the roadmap block to the morning? By 16:00 on day two nobody will argue with anything.',
        ],
      },
    ],
  },
  {
    id: 't10',
    mailbox: 'inbox',
    subject: 'New issue in suite-frontend: TypeError in MailArea',
    labels: ['Automated'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 't10m1',
        from: 'Sentry',
        fromEmail: 'alerts@sentry.io',
        to: ['Me'],
        time: 'Mon',
        sentAt: 'Mon, 10 Aug 2026 at 22:14',
        body: [
          "TypeError: Cannot read properties of undefined (reading 'id')",
          'First seen 4 hours ago, 37 events, 12 users affected. Release suite@2026.8.1, environment production.',
        ],
      },
    ],
  },
  {
    id: 't11',
    mailbox: 'inbox',
    subject: 'Partnership enquiry, Bluepeak',
    labels: ['Work'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 't11m1',
        from: 'Sanjay Rao',
        fromEmail: 'sanjay@bluepeak.in',
        to: ['Me'],
        time: 'Mon',
        sentAt: 'Mon, 10 Aug 2026 at 15:30',
        body: [
          'We resell workplace tools to about 400 mid-size firms in India and keep getting asked for a self-hosted suite.',
          'Is there a partner programme, or should we go through the standard cloud plans?',
        ],
      },
    ],
  },
  {
    id: 't12',
    mailbox: 'inbox',
    subject: '48 strings ready for review, German and French',
    labels: ['Automated'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 't12m1',
        from: 'Crowdin',
        fromEmail: 'no-reply@crowdin.com',
        to: ['Me'],
        time: '9 Aug',
        sentAt: 'Sun, 9 Aug 2026 at 13:05',
        body: [
          'Project Frappe Suite: 48 new strings translated and awaiting proofreading. German is at 94%, French at 88%.',
        ],
      },
    ],
  },

  // Sent
  {
    id: 's1',
    mailbox: 'sent',
    subject: 'Prototype is up: shell, mail and calendar',
    labels: ['Work'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 's1m1',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Arjun Menon', 'Neha Kulkarni', 'Priya Nair'],
        time: '10:12',
        sentAt: 'Today at 10:12',
        body: [
          'The shell prototype now covers Home, Files, Mail and Calendar. Nothing talks to the backend, so click anything.',
          'What I want feedback on: the rail, the contextual panel, and whether Mail needs a third pane.',
        ],
      },
    ],
  },
  {
    id: 's2',
    mailbox: 'sent',
    subject: 'Re: SSO login fails for our team on suite.frappe.cloud',
    labels: ['Support'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 's2m1',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Meera Iyer'],
        time: 'Wed',
        sentAt: 'Wed, 12 Aug 2026 at 17:20',
        body: [
          'Thanks for the detail. The audience string is built from the site URL, and your site moved to a custom domain on Saturday.',
        ],
      },
    ],
  },
  {
    id: 's3',
    mailbox: 'sent',
    subject: 'August invoice approved',
    labels: ['Billing'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 's3m1',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Accounts'],
        time: 'Yesterday',
        sentAt: 'Yesterday at 09:30',
        body: ['Approved, please pay on the usual cycle. Invoice attached.'],
        attachments: [{ name: 'INV-2026-0812.pdf', size: '58 KB', icon: PDF }],
      },
    ],
  },

  // Drafts
  {
    id: 'dr1',
    mailbox: 'drafts',
    subject: 'Re: Partnership enquiry, Bluepeak',
    labels: ['Work'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'dr1m1',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Sanjay Rao'],
        time: '11:04',
        sentAt: 'Today at 11:04',
        body: [
          'Hi Sanjay, thanks for reaching out. We do run a partner programme, and for 400 firms it would',
        ],
      },
    ],
  },
  {
    id: 'dr2',
    mailbox: 'drafts',
    subject: 'Q3 retro notes',
    labels: ['Work'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'dr2m1',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: [],
        time: 'Yesterday',
        sentAt: 'Yesterday at 17:41',
        body: ['What went well:', 'What did not:'],
      },
    ],
  },

  // Archive
  {
    id: 'a1',
    mailbox: 'archive',
    subject: 'Meet SFU capacity test, results',
    labels: ['Work'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'a1m1',
        from: 'Aditya Verma',
        fromEmail: 'aditya@frappe.io',
        to: ['Me'],
        time: '2 Aug',
        sentAt: 'Sun, 2 Aug 2026 at 12:20',
        body: [
          'The SFU held 48 participants on one node before frames started dropping. CPU, not bandwidth, is the ceiling.',
        ],
        attachments: [{ name: 'sfu-load-test.xlsx', size: '221 KB', icon: SHEET }],
      },
    ],
  },
  {
    id: 'a2',
    mailbox: 'archive',
    subject: 'Office lease renewal, signed copy',
    labels: ['Personal'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'a2m1',
        from: 'Arjun Menon',
        fromEmail: 'arjun@frappe.io',
        to: ['Me', 'Priya Nair'],
        time: '28 Jul',
        sentAt: 'Tue, 28 Jul 2026 at 10:00',
        body: ['Signed and filed. Nothing to do, keeping you both on the thread for the record.'],
        attachments: [{ name: 'office-lease-2026.pdf', size: '2.0 MB', icon: PDF }],
      },
    ],
  },

  // Spam
  {
    id: 'sp1',
    mailbox: 'spam',
    subject: 'Your domain frappe.io is about to expire!!',
    labels: [],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'sp1m1',
        from: 'Domain Registry Services',
        fromEmail: 'renewals@domain-registry-alerts.info',
        to: ['Me'],
        time: 'Yesterday',
        sentAt: 'Yesterday at 03:12',
        body: ['FINAL NOTICE. Renew within 24 hours to avoid permanent loss of your domain.'],
      },
    ],
  },
  {
    id: 'sp2',
    mailbox: 'spam',
    subject: 'We can 10x your SaaS pipeline this quarter',
    labels: [],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'sp2m1',
        from: 'Growth Partners',
        fromEmail: 'outreach@growthpartners-hq.biz',
        to: ['Me'],
        time: 'Mon',
        sentAt: 'Mon, 10 Aug 2026 at 08:47',
        body: ['Quick question, are you the right person to talk to about outbound at Frappe?'],
      },
    ],
  },

  // Trash
  {
    id: 'tr1',
    mailbox: 'trash',
    subject: 'Standup notes, 4 Aug',
    labels: ['Work'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'tr1m1',
        from: 'Priya Nair',
        fromEmail: 'priya@frappe.io',
        to: ['Me'],
        time: '4 Aug',
        sentAt: 'Tue, 4 Aug 2026 at 09:45',
        body: ['Notes from standup, superseded by the doc.'],
      },
    ],
  },
  {
    id: 'tr2',
    mailbox: 'trash',
    subject: 'Lunch order Friday',
    labels: ['Personal'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'tr2m1',
        from: 'Neha Kulkarni',
        fromEmail: 'neha@frappe.io',
        to: ['Me'],
        time: '31 Jul',
        sentAt: 'Fri, 31 Jul 2026 at 11:30',
        body: ['Counting heads for Friday. Reply with veg or non-veg.'],
      },
    ],
  },
  // Custom folders — mail the user filed themselves, so the folder names are
  // personal rather than system nouns.
  {
    id: 'rc1',
    mailbox: 'receipts',
    subject: 'Your AWS bill for July 2026',
    labels: ['Billing'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'rc1m1',
        from: 'AWS Billing',
        fromEmail: 'no-reply@aws.amazon.com',
        to: ['Me'],
        time: '3 Aug',
        sentAt: 'Mon, 3 Aug 2026 at 04:02',
        body: [
          'Total for July: $612.44. The largest line is EC2 at $381.10, up 14% on June.',
          'Cost Explorer attributes the rise to the two SFU load-test nodes left running over the weekend.',
        ],
        attachments: [{ name: 'aws-invoice-july-2026.pdf', size: '74 KB', icon: PDF }],
      },
    ],
  },
  {
    id: 'rc2',
    mailbox: 'receipts',
    subject: 'Receipt for Figma Organization, 12 seats',
    labels: ['Billing'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'rc2m1',
        from: 'Figma',
        fromEmail: 'receipts@figma.com',
        to: ['Me'],
        time: '1 Aug',
        sentAt: 'Sat, 1 Aug 2026 at 09:00',
        body: ['$540.00 charged to the card ending 4412 for the annual Organization plan.'],
        attachments: [{ name: 'figma-receipt-aug.pdf', size: '41 KB', icon: PDF }],
      },
    ],
  },
  {
    id: 'tv1',
    mailbox: 'travel',
    subject: 'Booking confirmed: BLR to NRT, 14 September',
    labels: ['Personal'],
    unread: true,
    starred: true,
    messages: [
      {
        id: 'tv1m1',
        from: 'ANA',
        fromEmail: 'bookings@ana.co.jp',
        to: ['Me'],
        time: 'Yesterday',
        sentAt: 'Yesterday at 20:11',
        body: [
          'Booking reference 7HQ2LM. NH826 departs Bengaluru 01:05 on 14 September and arrives Tokyo Narita 12:40.',
          'Check-in opens 24 hours before departure. Baggage allowance is 2 x 23 kg.',
        ],
        attachments: [{ name: 'e-ticket-7HQ2LM.pdf', size: '128 KB', icon: PDF }],
      },
    ],
  },
  {
    id: 'tv2',
    mailbox: 'travel',
    subject: 'Re: Tokyo hotel, which one?',
    labels: ['Personal'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'tv2m1',
        from: 'Me',
        fromEmail: 'faris@frappe.io',
        to: ['Priya Nair'],
        time: '6 Aug',
        sentAt: 'Thu, 6 Aug 2026 at 18:22',
        body: ['Shinjuku or Shibuya? Shinjuku is closer to the venue, Shibuya is cheaper by about 30%.'],
      },
      {
        id: 'tv2m2',
        from: 'Priya Nair',
        fromEmail: 'priya@frappe.io',
        to: ['Me'],
        time: '6 Aug',
        sentAt: 'Thu, 6 Aug 2026 at 19:05',
        body: ['Shinjuku. We will be walking back late every night and nobody will want the train.'],
      },
    ],
  },
  {
    id: 'nl1',
    mailbox: 'newsletters',
    subject: 'The state of self-hosted developer tools',
    labels: ['Automated'],
    unread: true,
    starred: false,
    messages: [
      {
        id: 'nl1m1',
        from: 'The Pragmatic Engineer',
        fromEmail: 'newsletter@pragmaticengineer.com',
        to: ['Me'],
        time: 'Tue',
        sentAt: 'Tue, 11 Aug 2026 at 13:00',
        body: [
          'This week: why self-hosting is back, what changed in the licence models, and the three teams that moved off SaaS and regretted it.',
        ],
      },
    ],
  },
  {
    id: 'nl2',
    mailbox: 'newsletters',
    subject: 'Vue.js weekly, issue 412',
    labels: ['Automated'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'nl2m1',
        from: 'Vue.js News',
        fromEmail: 'weekly@vuejsnews.com',
        to: ['Me'],
        time: 'Mon',
        sentAt: 'Mon, 10 Aug 2026 at 07:30',
        body: ['Vapor mode lands in 3.6 beta, plus a deep dive on reactive props destructuring.'],
      },
    ],
  },
  {
    id: 'hr1',
    mailbox: 'recruiting',
    subject: 'Application: Senior Frontend Engineer',
    labels: ['Work'],
    unread: true,
    starred: false,
    messages: [
      {
        id: 'hr1m1',
        from: 'Ananya Desai',
        fromEmail: 'ananya.desai@gmail.com',
        to: ['Careers'],
        time: 'Thu',
        sentAt: 'Thu, 13 Aug 2026 at 09:18',
        body: [
          'Six years on design systems, the last two building a component library used by nine internal apps.',
          'I have followed frappe-ui since the token rewrite and would like to work on it full time. CV attached.',
        ],
        attachments: [{ name: 'ananya-desai-cv.pdf', size: '212 KB', icon: PDF }],
      },
    ],
  },
  {
    id: 'hr2',
    mailbox: 'recruiting',
    subject: 'Referral: backend candidate from the Pune meetup',
    labels: ['Work'],
    unread: false,
    starred: false,
    messages: [
      {
        id: 'hr2m1',
        from: 'Aditya Verma',
        fromEmail: 'aditya@frappe.io',
        to: ['Me', 'Priya Nair'],
        time: 'Tue',
        sentAt: 'Tue, 11 Aug 2026 at 21:40',
        body: [
          'Met someone at the Pune meetup who has run Postgres logical replication at a size we have not. Worth a call.',
        ],
      },
    ],
  },
])

/** Last message decides the list line, so the two panes cannot disagree. */
export function lastMessage(thread: MailThread): MailMessage {
  return thread.messages[thread.messages.length - 1]
}

/** Sender shown in the list. Drafts and Sent read by recipient, like every mail client. */
export function threadFrom(thread: MailThread): string {
  const last = lastMessage(thread)
  if (thread.mailbox === 'sent' || thread.mailbox === 'drafts') {
    return last.to.length ? `To: ${last.to.join(', ')}` : 'No recipients'
  }
  return last.from
}

export function threadSnippet(thread: MailThread): string {
  return lastMessage(thread).body[0]
}

/** Starred cuts across every mailbox, so it is a view rather than a place. */
export function threadsIn(mailboxId: string): MailThread[] {
  if (mailboxId === 'starred') return MAIL_THREADS.filter((thread) => thread.starred)
  return MAIL_THREADS.filter((thread) => thread.mailbox === mailboxId)
}

/** Derived, so the sidebar count, the rail badge and the list can never drift. */
export function unreadIn(mailboxId: string): number {
  return threadsIn(mailboxId).filter((thread) => thread.unread).length
}

export const MAILBOXES: Mailbox[] = [
  { id: 'inbox', label: 'Inbox', icon: 'lucide-inbox' },
  { id: 'starred', label: 'Starred', icon: 'lucide-star' },
  { id: 'sent', label: 'Sent', icon: 'lucide-send' },
  { id: 'drafts', label: 'Drafts', icon: 'lucide-pencil-line' },
  { id: 'archive', label: 'Archive', icon: 'lucide-archive' },
  { id: 'spam', label: 'Spam', icon: 'lucide-octagon-alert' },
  { id: 'trash', label: 'Trash', icon: 'lucide-trash-2' },
]

// Folders the user made, so they sit in their own sidebar section under the
// system mailboxes and carry a colour instead of a meaning-bearing icon.
export const MAIL_FOLDERS: Mailbox[] = [
  { id: 'receipts', label: 'Receipts', icon: 'lucide-folder' },
  { id: 'travel', label: 'Travel', icon: 'lucide-folder' },
  { id: 'newsletters', label: 'Newsletters', icon: 'lucide-folder' },
  { id: 'recruiting', label: 'Recruiting', icon: 'lucide-folder' },
]

// The Screener is a decision queue, not a mailbox: a first-time sender waits
// here until the user says yes or no, and that answer is about the *person*,
// not the message. Nothing else in Mail works that way, which is why it gets
// its own screen instead of another list.
export interface ScreenerSender {
  id: string
  name: string
  email: string
  avatar: string
  /** What they are writing about, so the decision is not made on a name alone. */
  subject: string
  snippet: string
  time: string
  /** Messages already waiting from this sender. */
  waiting: number
  /** Prior contact the user can lean on. Empty when there is none. */
  context: string
}

export const SCREENER_SENDERS: ScreenerSender[] = reactive([
  {
    id: 'sc1',
    name: 'Tanvi Shah',
    email: 'tanvi@orbitlabs.dev',
    avatar: 'https://avatars.githubusercontent.com/u/45?v=4',
    subject: 'Frappe Suite at Orbit, 40 seats',
    snippet:
      'We are moving off Google Workspace in October and Suite is the only self-hosted option my team liked.',
    time: '08:20',
    waiting: 2,
    context: 'Replied to your post on the self-hosting thread',
  },
  {
    id: 'sc2',
    name: 'Devcon India',
    email: 'speakers@devconindia.org',
    avatar: 'https://avatars.githubusercontent.com/u/3?v=4',
    subject: 'Invitation to speak, November track',
    snippet:
      'We would like you to open the developer-tools track with the Suite shell talk you gave internally.',
    time: 'Yesterday',
    waiting: 1,
    context: 'Neha Kulkarni is also on this thread',
  },
  {
    id: 'sc3',
    name: 'Vercel',
    email: 'no-reply@vercel.com',
    avatar: 'https://github.com/vercel.png',
    subject: 'Your preview deployment is ready',
    snippet: 'suite-prototype-git-shell.vercel.app finished building in 42 seconds.',
    time: 'Yesterday',
    waiting: 6,
    context: 'Automated, 6 messages in 2 days',
  },
  {
    id: 'sc4',
    name: 'Karan Bhatia',
    email: 'karan@peakoutbound.io',
    avatar: 'https://avatars.githubusercontent.com/u/5?v=4',
    subject: 'Quick 15 minutes next week?',
    snippet:
      'I help open-source companies triple their enterprise pipeline. Are you the right person to speak to?',
    time: 'Wed',
    waiting: 3,
    context: 'No prior contact',
  },
  {
    id: 'sc5',
    name: 'Lila Fernandes',
    email: 'lila.fernandes@auroraschool.edu',
    avatar: 'https://avatars.githubusercontent.com/u/30?v=4',
    subject: 'Using Suite for a school of 600',
    snippet:
      'We run everything on donated hardware. Is there a plan for schools, or should we self-host?',
    time: 'Tue',
    waiting: 1,
    context: 'No prior contact',
  },
])

// Every sender has a face. A letter-initial fallback reads as "we have no data
// on this person", which is the wrong signal in a screen whose whole job is to
// tell people apart at a glance.
export const MAIL_AVATARS: Record<string, string> = {
  ...PEOPLE,
  Me: USER.avatar,
  'Arjun Menon': 'https://avatars.githubusercontent.com/u/22?v=4',
  'Meera Iyer': 'https://avatars.githubusercontent.com/u/17?v=4',
  'Sanjay Rao': 'https://avatars.githubusercontent.com/u/18?v=4',
  'Ananya Desai': 'https://avatars.githubusercontent.com/u/19?v=4',
  ANA: 'https://avatars.githubusercontent.com/u/20?v=4',
  'Domain Registry Services': 'https://avatars.githubusercontent.com/u/21?v=4',
  'Growth Partners': 'https://avatars.githubusercontent.com/u/25?v=4',
  GitHub: 'https://github.com/github.png',
  'Frappe Cloud': 'https://github.com/frappe.png',
  Sentry: 'https://github.com/getsentry.png',
  Crowdin: 'https://github.com/crowdin.png',
  Stalwart: 'https://github.com/stalwartlabs.png',
  Figma: 'https://github.com/figma.png',
  'AWS Billing': 'https://github.com/aws.png',
  'Vue.js News': 'https://github.com/vuejs.png',
  'The Pragmatic Engineer': 'https://github.com/gergelyorosz.png',
}

export type ScreenerVerdict = 'in' | 'out'

// The verdicts live beside the senders rather than inside the screen, so the
// sidebar count and the queue are the same fact. One entry per person: a
// second decision replaces the first, it never stacks.
export const screenerDecisions = ref<{ senderId: string; verdict: ScreenerVerdict }[]>([])

export function screenerWaiting(): ScreenerSender[] {
  return SCREENER_SENDERS.filter(
    (sender) => !screenerDecisions.value.some((d) => d.senderId === sender.id),
  )
}

export function screenerScreenedOut(): ScreenerSender[] {
  return screenerDecisions.value
    .filter((d) => d.verdict === 'out')
    .map((d) => SCREENER_SENDERS.find((sender) => sender.id === d.senderId)!)
}

export function screenerDecide(senderId: string, verdict: ScreenerVerdict) {
  // Re-deciding replaces the answer, so a person is never in two lists.
  const rest = screenerDecisions.value.filter((d) => d.senderId !== senderId)
  screenerDecisions.value = [...rest, { senderId, verdict }]
}

export function screenerUndo() {
  screenerDecisions.value = screenerDecisions.value.slice(0, -1)
}

/** Every place a thread can be, so a URL resolves to one title. */
export const MAIL_PLACES: Mailbox[] = [...MAILBOXES, ...MAIL_FOLDERS]
