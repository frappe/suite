/** Display-ready upcoming events; callers own filtering, time zones and navigation. */
export interface UpcomingEventRow {
  id: string
  title: string
  month: string
  day: string
  time: string
  actionLabel: string
  href?: string
  route?: string
  participants?: readonly {
    email: string
    name: string
    image?: string
  }[]
}
