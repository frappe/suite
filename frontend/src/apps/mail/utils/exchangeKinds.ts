import {
  CalendarPlus,
  CalendarRange,
  HardDriveDownload,
  HardDriveUpload,
  UserPlus,
  Users,
} from 'lucide-vue-next'

/**
 * Import and export jobs come in three kinds that share one list page and one detail page and
 * differ only in the doctype they read, their routes and their words. Each label stays a whole
 * sentence per kind so it translates on its own.
 */
export const EXCHANGE_KINDS = {
  mail: {
    doctype: 'Mail Exchange',
    listRoute: 'mail-exchanges',
    detailRoute: 'mail-exchange',
    deskPath: 'mail-exchange',
    listLabel: () => __('Mail Exchanges'),
    emptyLabel: () => __('No mail exchanges found.'),
    title: (operation: string) => __('Mail {0}', [__(operation)]),
    icons: { Import: HardDriveDownload, Export: HardDriveUpload },
  },
  contacts: {
    doctype: 'Contacts Exchange',
    listRoute: 'mail-contacts-exchanges',
    detailRoute: 'mail-contacts-exchange',
    deskPath: 'contacts-exchange',
    listLabel: () => __('Contacts Exchanges'),
    emptyLabel: () => __('No contacts exchanges found.'),
    title: (operation: string) => __('Contacts {0}', [__(operation)]),
    icons: { Import: UserPlus, Export: Users },
  },
  calendar: {
    doctype: 'Calendar Exchange',
    listRoute: 'mail-calendar-exchanges',
    detailRoute: 'mail-calendar-exchange',
    deskPath: 'calendar-exchange',
    listLabel: () => __('Calendar Exchanges'),
    emptyLabel: () => __('No calendar exchanges found.'),
    title: (operation: string) => __('Calendar {0}', [__(operation)]),
    icons: { Import: CalendarPlus, Export: CalendarRange },
  },
} as const

export type ExchangeKind = keyof typeof EXCHANGE_KINDS
