import { describe, expect, it } from "vitest";
import {
  adjustScheduleEndTime,
  adjustScheduleStartTime,
  getScheduleTimeOptions,
  sameDayEndTimeOptions,
  sameDayStartTimeOptions,
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

  it("provides 15-minute AM/PM options backed by 24-hour values", () => {
    expect(scheduleTimeOptions).toContainEqual({
      label: "10:15 AM",
      value: "10:15",
    });
    expect(scheduleTimeOptions).toContainEqual({
      label: "1:45 PM",
      value: "13:45",
    });
  });

  it("retains an existing event time outside the 15-minute intervals", () => {
    expect(getScheduleTimeOptions("10:07")).toContainEqual({
      label: "10:07 AM",
      value: "10:07",
    });
  });

  it("keeps same-day start and end choices valid at day boundaries", () => {
    expect(sameDayStartTimeOptions.at(-1)?.value).toBe("23:30");
    expect(sameDayEndTimeOptions[0]?.value).toBe("00:15");
    expect(adjustScheduleEndTime("23:30", "22:00")).toBe("23:45");
    expect(adjustScheduleStartTime("01:00", "00:15")).toBe("00:00");
  });
});
