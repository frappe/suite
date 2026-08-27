const LAST_TIME_MINUTES = 24 * 60 - 15;

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const adjustScheduleEndTime = (startTime: string, endTime: string) => {
  if (!startTime || !endTime || toMinutes(endTime) > toMinutes(startTime))
    return endTime;
  return toTime(Math.min(toMinutes(startTime) + 60, LAST_TIME_MINUTES));
};

export const adjustScheduleStartTime = (startTime: string, endTime: string) => {
  if (!startTime || !endTime || toMinutes(endTime) > toMinutes(startTime))
    return startTime;
  return toTime(Math.max(toMinutes(endTime) - 60, 0));
};
