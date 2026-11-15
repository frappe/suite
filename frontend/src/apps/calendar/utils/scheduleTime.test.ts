import { describe, expect, it } from 'vitest'

import {
  adjustScheduleEndTime,
  adjustScheduleStartTime,
  defaultScheduleWindow,
} from './scheduleTime'

describe('schedule time', () => {
  it('moves the end one hour ahead when the start overtakes it', () => {
    expect(adjustScheduleEndTime('10:00', '09:00')).toBe('11:00')
  })

  it('leaves a valid end time unchanged', () => {
    expect(adjustScheduleEndTime('10:00', '10:30')).toBe('10:30')
  })

  it('moves the start one hour earlier when the end overtakes it', () => {
    expect(adjustScheduleStartTime('10:00', '09:00')).toBe('08:00')
  })

  it('leaves a valid start time unchanged', () => {
    expect(adjustScheduleStartTime('10:00', '10:30')).toBe('10:00')
  })

  it('keeps corrected times within day boundaries', () => {
    expect(adjustScheduleEndTime('23:30', '22:00')).toBe('23:45')
    expect(adjustScheduleStartTime('01:00', '00:15')).toBe('00:00')
  })

  it('opens a new meeting on the next full hour, an hour long', () => {
    expect(defaultScheduleWindow(new Date(2026, 10, 15, 14, 20))).toEqual({
      date: '2026-11-15',
      startTime: '15:00',
      endTime: '16:00',
    })
  })

  it('ends a late meeting at the last slot of the day, never before its start', () => {
    expect(defaultScheduleWindow(new Date(2026, 10, 15, 22, 30))).toEqual({
      date: '2026-11-15',
      startTime: '23:00',
      endTime: '23:45',
    })
  })

  it('moves to tomorrow once the next full hour is past midnight', () => {
    expect(defaultScheduleWindow(new Date(2026, 10, 15, 23, 10))).toEqual({
      date: '2026-11-16',
      startTime: '00:00',
      endTime: '01:00',
    })
  })
})
