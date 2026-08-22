// PROTOTYPE — remove. Fake calendar data for the throwaway shell prototype.
// Nothing here persists or talks to the backend.
//
// Kept out of fixtures.ts on purpose: the Calendar screen needs start/end
// times and a calendar colour, which the flat `UPCOMING_EVENTS` list on Home
// does not carry.
//
// Every date is generated from the real today, so the week grid always opens on
// a live week and "today" highlights correctly.
import dayjs from 'dayjs'

import { ISO, toMinutes } from './calendarDates'

export type CalendarId = 'work' | 'personal' | 'frappeverse'

// Ink-first: an event carries no fill of its own, so the calendar's colour has
// to survive in a 6px dot. `dot` and `text` are literal classes, not built
// strings — Tailwind only ships the classes it can see in the source.
export const CALENDARS: {
  id: CalendarId
  label: string
  dot: string
  text: string
}[] = [
  { id: 'work', label: 'Work', dot: 'bg-surface-blue-5', text: 'text-ink-blue-6' },
  { id: 'personal', label: 'Personal', dot: 'bg-surface-green-5', text: 'text-ink-green-6' },
  { id: 'frappeverse', label: 'Frappeverse', dot: 'bg-surface-pink-5', text: 'text-ink-pink-6' },
]

const DOT: Record<CalendarId, string> = Object.fromEntries(
  CALENDARS.map((c) => [c.id, c.dot]),
) as Record<CalendarId, string>

export interface CalEvent {
  id: string
  title: string
  calendar: CalendarId
  dot: string
  /** First day, 'YYYY-MM-DD'. */
  start: string
  /** Last day, inclusive. Same as `start` for a timed event. */
  end: string
  /** Minutes from midnight. `null` on both marks an all-day event. */
  startMin: number | null
  endMin: number | null
  venue: string
  participant: string
}

export function isAllDay(event: CalEvent): boolean {
  return event.startMin === null
}

interface EventSeed {
  id: string
  title: string
  calendar: CalendarId
  /**
   * Weekday in the current week, 0 = Sunday. Use this for anything that has to
   * land inside the week grid: an offset from today would slide the whole week
   * along as the real weekday changes, and leave the early columns empty.
   */
  dow?: number
  /** Weeks from the current week; negative is the past. Needs `dow`. */
  weeks?: number
  /** Fixed 'YYYY-MM-DD', for a real event that owns its dates. */
  date?: string
  /** Days from today; negative is the past. Used for the year view. */
  day?: number
  /** 'HH:mm'. Omit both times for an all-day event. */
  from?: string
  to?: string
  /** Length in days for an all-day event. 1 = a single day. */
  days?: number
  venue?: string
  participant?: string
}

/** Sunday of the current week, matching the Sunday-first grids. */
function weekStart() {
  return dayjs().subtract(dayjs().day(), 'day')
}

function build(seed: EventSeed): CalEvent {
  const start = seed.date
    ? dayjs(seed.date)
    : seed.dow === undefined
      ? dayjs().add(seed.day ?? 0, 'day')
      : weekStart().add((seed.weeks ?? 0) * 7 + seed.dow, 'day')
  const allDay = !seed.from

  return {
    id: seed.id,
    title: seed.title,
    calendar: seed.calendar,
    dot: DOT[seed.calendar],
    start: start.format(ISO),
    end: start.add(allDay ? (seed.days ?? 1) - 1 : 0, 'day').format(ISO),
    startMin: allDay ? null : toMinutes(seed.from as string),
    endMin: allDay ? null : toMinutes(seed.to as string),
    venue: seed.venue ?? '',
    participant: seed.participant ?? '',
  }
}

// Sunday to Thursday is the invented week: events spread over every column, one
// deliberate overlap on Thursday, weekday-anchored so the shape holds whatever
// day it is opened. Friday and Saturday belong to Frappeverse Mumbai 2026,
// which owns real dates and so is seeded with them. The weeks either side keep
// the Month grid filled; the far-out entries only feed the Year view.
const SEEDS: EventSeed[] = [
  // — Sunday —
  { id: 'c01', title: 'Gym', calendar: 'personal', dow: 0, from: '08:30', to: '09:30' },

  // — Monday —
  { id: 'c02', title: 'Standup', calendar: 'work', dow: 1, from: '09:30', to: '09:45' },
  { id: 'c03', title: 'Sprint planning', calendar: 'work', dow: 1, from: '10:00', to: '11:00', venue: 'Meet' },
  { id: 'c04', title: 'Deep work', calendar: 'work', dow: 1, from: '14:00', to: '16:00' },

  // — Tuesday —
  { id: 'c05', title: 'Design review', calendar: 'work', dow: 2, from: '11:00', to: '12:00', participant: 'Neha Kulkarni' },
  { id: 'c06', title: 'Dentist', calendar: 'personal', dow: 2, from: '17:00', to: '18:00', venue: 'Koramangala' },

  // — Wednesday —
  { id: 'c07', title: 'Standup', calendar: 'work', dow: 3, from: '09:30', to: '09:45' },
  { id: 'c08', title: 'Shell prototype walkthrough', calendar: 'work', dow: 3, from: '10:30', to: '11:30', participant: 'Rushabh Mehta', venue: 'Meet' },
  { id: 'c09', title: '1:1 Faris / Rushabh', calendar: 'work', dow: 3, from: '15:00', to: '15:30', participant: 'Rushabh Mehta', venue: 'Meet' },
  // Starts mid-week, so the all-day row carries a span rather than a single day.
  { id: 'c10', title: 'Design sprint', calendar: 'work', dow: 3, days: 2 },

  // — Thursday: the one overlap in the week —
  { id: 'c11', title: 'Deep work: calendar screen', calendar: 'work', dow: 4, from: '10:30', to: '12:30' },
  { id: 'c12', title: 'Token audit sync', calendar: 'work', dow: 4, from: '14:00', to: '15:00', participant: 'Aditya Verma' },
  { id: 'c13', title: 'Design critique', calendar: 'work', dow: 4, from: '14:30', to: '15:30', participant: 'Neha Kulkarni' },

  // — Frappeverse Mumbai 2026, day 1 (Fri 21 Aug) —
  { id: 'f01', title: 'Breakfast', calendar: 'frappeverse', date: '2026-08-21', from: '09:00', to: '10:00', venue: 'Track 1' },
  { id: 'f02', title: 'Introduction to Frappeverse 2026', calendar: 'frappeverse', date: '2026-08-21', from: '10:00', to: '10:10', venue: 'Track 1', participant: 'Rushabh Mehta' },
  { id: 'f03', title: 'Keynote: Framework and ERPNext', calendar: 'frappeverse', date: '2026-08-21', from: '10:10', to: '11:30', venue: 'Track 1', participant: 'Nikhil Kothari, Soham Kulkarni, Nishka Gosalia, Sumit Jain, Ejaaz Khan, Khushi Rawat, Ruthra Kumar, Sabu Siyad, Dipen Gala, Nabin Hait' },
  { id: 'f04', title: 'Tea break', calendar: 'frappeverse', date: '2026-08-21', from: '11:30', to: '12:00', venue: 'Track 1' },
  { id: 'f05', title: 'Keynote: ERPNext Compliance and Localization', calendar: 'frappeverse', date: '2026-08-21', from: '12:00', to: '12:15', venue: 'Track 1', participant: 'Umair Sayyed' },
  { id: 'f06', title: 'Keynote: HR, India Payroll and Lending', calendar: 'frappeverse', date: '2026-08-21', from: '12:15', to: '12:30', venue: 'Track 1', participant: 'Deepesh Garg' },
  { id: 'f07', title: 'Keynote: CRM, Helpdesk and Learning', calendar: 'frappeverse', date: '2026-08-21', from: '12:30', to: '13:15', venue: 'Track 1', participant: 'Pratham Sharma, Shahzeel Ansari, Ritvik Sardana, Raiza Safeel, Sydney Gomes' },
  { id: 'f08', title: 'Keynote: Raven', calendar: 'frappeverse', date: '2026-08-21', from: '13:15', to: '13:30', venue: 'Track 1', participant: 'Nikhil Kothari, Aditya Patil' },
  { id: 'f09', title: 'Lunch', calendar: 'frappeverse', date: '2026-08-21', from: '13:30', to: '14:50', venue: 'Track 1' },
  { id: 'f10', title: '5,000 Workers, 3 Tea Farms, One Source of Truth', calendar: 'frappeverse', date: '2026-08-21', from: '14:50', to: '15:10', venue: 'Track 1', participant: 'Jai Kejriwal' },
  { id: 'f11', title: 'Building a Business with Open Source', calendar: 'frappeverse', date: '2026-08-21', from: '14:50', to: '15:50', venue: 'Track 2', participant: 'Sarfaraz Shaikh, Faraz, Rohit Pandey' },
  { id: 'f12', title: "Scaling ERPNext for India's Largest Residential Solar Brand", calendar: 'frappeverse', date: '2026-08-21', from: '15:10', to: '15:30', venue: 'Track 1', participant: 'Krupal Vora' },
  { id: 'f13', title: 'Standing on the Shoulders of Giants', calendar: 'frappeverse', date: '2026-08-21', from: '15:30', to: '15:50', venue: 'Track 1', participant: 'Pratik Agarwal' },
  { id: 'f14', title: 'From Nouns to Verbs', calendar: 'frappeverse', date: '2026-08-21', from: '15:50', to: '16:10', venue: 'Track 1', participant: 'Nikhil Karkare, Chinmay Kulkarni' },
  { id: 'f15', title: 'The 15-Minute Go-Live That Cost Us Thousands of Pounds', calendar: 'frappeverse', date: '2026-08-21', from: '15:50', to: '16:10', venue: 'Track 2', participant: 'Shivam Ghosh, Rahul Agrawal' },
  { id: 'f16', title: 'Automating the Boring Stuff with Donna and Friends', calendar: 'frappeverse', date: '2026-08-21', from: '16:10', to: '16:30', venue: 'Track 1', participant: 'Hussain Nagaria' },
  { id: 'f17', title: 'Beyond Standard ERP: Solving Complex Retail Challenges', calendar: 'frappeverse', date: '2026-08-21', from: '16:10', to: '16:30', venue: 'Track 2', participant: 'Taranneet Kaur, Sudhanshu Badole, Abhishek Dakhole' },
  { id: 'f18', title: 'Tea break', calendar: 'frappeverse', date: '2026-08-21', from: '16:30', to: '17:00', venue: 'Both tracks' },
  { id: 'f19', title: 'Frappe Awards', calendar: 'frappeverse', date: '2026-08-21', from: '17:00', to: '17:30', venue: 'Track 1' },
  { id: 'f20', title: 'Flash Talks', calendar: 'frappeverse', date: '2026-08-21', from: '17:10', to: '18:00', venue: 'Track 2' },
  { id: 'f21', title: 'Frappe Fights: Will software be a part of the future?', calendar: 'frappeverse', date: '2026-08-21', from: '17:30', to: '18:30', venue: 'Track 1' },
  { id: 'f22', title: 'Music Show: Megha Rawoot', calendar: 'frappeverse', date: '2026-08-21', from: '18:30', to: '19:30', venue: 'Track 1' },
  { id: 'f23', title: 'Dinner', calendar: 'frappeverse', date: '2026-08-21', from: '19:30', to: '21:00', venue: 'Track 1' },

  // — Frappeverse Mumbai 2026, day 2 (Sat 22 Aug) —
  { id: 'f24', title: 'Breakfast', calendar: 'frappeverse', date: '2026-08-22', from: '09:00', to: '10:00', venue: 'Track 1' },
  { id: 'f25', title: 'Keynote: Frappe Cloud', calendar: 'frappeverse', date: '2026-08-22', from: '10:00', to: '11:00', venue: 'Track 1', participant: 'Aditya, Tanmoy Sarkar, Aradhya Tripathi, Ayush Chaudhari, Prathamesh Kurunkar, Saurabh Palande' },
  { id: 'f26', title: 'Keynote: Frappe Suite', calendar: 'frappeverse', date: '2026-08-22', from: '11:00', to: '11:30', venue: 'Track 1', participant: 'Faris Ansari, Muhammed Suhail, Gursheen Kaur Anand, Vibhav Katre' },
  { id: 'f27', title: 'Tea break', calendar: 'frappeverse', date: '2026-08-22', from: '11:30', to: '12:00', venue: 'Track 1' },
  { id: 'f28', title: 'Keynote: DevTools', calendar: 'frappeverse', date: '2026-08-22', from: '12:00', to: '13:00', venue: 'Track 1', participant: 'Faris Ansari, Rucha Mahabal, Suraj Shetty, Ankush Menat, Shrihari Mahabal' },
  { id: 'f29', title: 'Keynote: Agentic Product Developments by Non-devs', calendar: 'frappeverse', date: '2026-08-22', from: '12:00', to: '13:30', venue: 'Track 1', participant: 'Neha Sankhe, Vibhav Katre' },
  { id: 'f30', title: 'Lunch', calendar: 'frappeverse', date: '2026-08-22', from: '13:30', to: '14:50', venue: 'Track 1' },
  { id: 'f31', title: 'Escaping ERP Lock-In: How US Businesses Broke Free', calendar: 'frappeverse', date: '2026-08-22', from: '14:50', to: '15:10', venue: 'Track 1', participant: 'Manan Shah' },
  { id: 'f32', title: 'POSpire: Enterprise-Grade Retail POS on Frappe', calendar: 'frappeverse', date: '2026-08-22', from: '14:50', to: '15:10', venue: 'Track 2', participant: 'Rajit Kadami, Hari Madhavan' },
  { id: 'f33', title: 'Solo to Silver: Freelancer to Frappe Silver Partner', calendar: 'frappeverse', date: '2026-08-22', from: '15:10', to: '15:30', venue: 'Track 1', participant: 'Basawaraj' },
  { id: 'f34', title: 'Autopilot ERPNext: Native AI Agents for Marketing', calendar: 'frappeverse', date: '2026-08-22', from: '15:10', to: '15:30', venue: 'Track 2', participant: 'Mukesh Variyani' },
  { id: 'f35', title: 'Trivia', calendar: 'frappeverse', date: '2026-08-22', from: '15:30', to: '15:50', venue: 'Track 1' },
  { id: 'f36', title: 'The Role of ERPNext Partners in Growing the Ecosystem', calendar: 'frappeverse', date: '2026-08-22', from: '15:50', to: '16:10', venue: 'Track 1', participant: 'Kanhaiya Kale' },
  { id: 'f37', title: 'Migrating 1.4 million tickets from Zendesk to Helpdesk', calendar: 'frappeverse', date: '2026-08-22', from: '16:10', to: '16:30', venue: 'Track 1', participant: 'Niraj Gautam' },
  { id: 'f38', title: 'Tea break', calendar: 'frappeverse', date: '2026-08-22', from: '16:30', to: '17:10', venue: 'Both tracks' },
  { id: 'f39', title: 'Open Discussion & Group Photography', calendar: 'frappeverse', date: '2026-08-22', from: '17:10', to: '18:30', venue: 'Track 1' },

  // — The weeks either side, so the Month grid is not one dense row on an
  //   otherwise empty page. Two or three a week is enough at month size.
  { id: 'c18', title: 'Roadmap sync', calendar: 'work', weeks: -2, dow: 2, from: '15:00', to: '16:00' },
  { id: 'c19', title: 'Team lunch', calendar: 'personal', weeks: -2, dow: 5, from: '13:00', to: '14:00' },
  { id: 'c20', title: 'Vendor call', calendar: 'work', weeks: -1, dow: 2, from: '11:00', to: '11:30' },
  { id: 'c21', title: 'Hiring panel', calendar: 'work', weeks: -1, dow: 3, from: '16:00', to: '17:00', participant: 'Priya Nair' },
  { id: 'c22', title: 'Deep work', calendar: 'work', weeks: -1, dow: 4, from: '14:00', to: '16:00' },
  { id: 'c23', title: 'Quarterly review', calendar: 'work', weeks: 1, dow: 1, from: '15:00', to: '17:00' },
  { id: 'c24', title: 'Bengaluru → Delhi', calendar: 'work', weeks: 1, dow: 3, days: 3 },
  { id: 'c25', title: 'Customer workshop', calendar: 'work', weeks: 1, dow: 4, from: '10:00', to: '16:00', venue: 'Delhi' },
  { id: 'c26', title: 'Renew passport', calendar: 'personal', weeks: 2, dow: 2 },
  { id: 'c27', title: 'Board update', calendar: 'work', weeks: 2, dow: 4, from: '11:00', to: '12:00' },

  // — Across the year, so the Year view has something to show —
  { id: 'c28', title: 'Team offsite', calendar: 'work', day: -60, days: 3 },
  { id: 'c29', title: 'Conference', calendar: 'work', day: 45, days: 4 },
  { id: 'c30', title: 'Leave', calendar: 'personal', day: 120, days: 7 },
]

export const CALENDAR_EVENTS: CalEvent[] = SEEDS.map(build)

/** Events touching any day in `[from, to]`, both inclusive. */
export function eventsBetween(from: string, to: string): CalEvent[] {
  return CALENDAR_EVENTS.filter((e) => e.start <= to && e.end >= from)
}

/** Event count per 'YYYY-MM-DD'; a span counts on every day it covers. */
export const EVENT_COUNT_BY_DATE: Record<string, number> = (() => {
  const counts: Record<string, number> = {}
  for (const event of CALENDAR_EVENTS) {
    let day = dayjs(event.start)
    while (day.format(ISO) <= event.end) {
      const key = day.format(ISO)
      counts[key] = (counts[key] ?? 0) + 1
      day = day.add(1, 'day')
    }
  }
  return counts
})()
