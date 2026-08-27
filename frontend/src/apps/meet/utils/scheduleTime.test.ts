import { describe, expect, it } from "vitest";
import {
  adjustScheduleEndTime,
  adjustScheduleStartTime,
  scheduleEndTimeOptions,
  scheduleStartTimeOptions,
  scheduleTimeOptions,
} from "./scheduleTime";

describe("schedule time", () => {
  it("moves the end one hour ahead when the start overtakes it", () => {
    expect(adjustScheduleEndTime("10:00", "09:00")).toBe("11:00");
  });

  it("leaves a valid end time unchanged", () => {
    expect(adjustScheduleEndTime("10:00", "10:30")).toBe("10:30");
  });

  it("moves the start one hour earlier when the end overtakes it", () => {
    expect(adjustScheduleStartTime("10:00", "09:00")).toBe("08:00");
  });

  it("leaves a valid start time unchanged", () => {
    expect(adjustScheduleStartTime("10:00", "10:30")).toBe("10:00");
  });

  it("provides AM/PM labels backed by 24-hour values", () => {
    expect(scheduleTimeOptions).toContainEqual({
      label: "10:00 AM",
      value: "10:00",
    });
    expect(scheduleTimeOptions).toContainEqual({
      label: "1:00 PM",
      value: "13:00",
    });
  });

  it("keeps same-day start and end choices valid at day boundaries", () => {
    expect(scheduleStartTimeOptions.at(-1)?.value).toBe("23:00");
    expect(scheduleEndTimeOptions[0]?.value).toBe("00:30");
    expect(adjustScheduleEndTime("23:00", "22:00")).toBe("23:30");
    expect(adjustScheduleStartTime("01:00", "00:30")).toBe("00:00");
  });
});
