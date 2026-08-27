import { describe, expect, it } from "vitest";
import {
  adjustScheduleEndTime,
  adjustScheduleStartTime,
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

  it("keeps corrected times within day boundaries", () => {
    expect(adjustScheduleEndTime("23:30", "22:00")).toBe("23:45");
    expect(adjustScheduleStartTime("01:00", "00:15")).toBe("00:00");
  });
});
