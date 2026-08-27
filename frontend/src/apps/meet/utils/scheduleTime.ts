const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const adjustScheduleEndTime = (startTime: string, endTime: string) => {
  if (!startTime || !endTime || toMinutes(endTime) > toMinutes(startTime))
    return endTime;
  return toTime(Math.min(toMinutes(startTime) + 60, 23 * 60 + 30));
};

export const adjustScheduleStartTime = (startTime: string, endTime: string) => {
  if (!startTime || !endTime || toMinutes(endTime) > toMinutes(startTime))
    return startTime;
  return toTime(Math.max(toMinutes(endTime) - 60, 0));
};

export const scheduleTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const minutes = index * 30;
  const hours = Math.floor(minutes / 60);
  return {
    label: `${hours % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`,
    value: toTime(minutes),
  };
});

export const scheduleStartTimeOptions = scheduleTimeOptions.slice(0, -1);
export const scheduleEndTimeOptions = scheduleTimeOptions.slice(1);
