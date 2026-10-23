// The page lengths the desk list view offers, with the same default.
export const PAGE_LENGTHS = [20, 100, 500] as const
export type PageLength = (typeof PAGE_LENGTHS)[number]
export const DEFAULT_PAGE_LENGTH: PageLength = 100
