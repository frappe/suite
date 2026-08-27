const TIME_STEP_MINUTES = 15;
const LAST_TIME_MINUTES = 24 * 60 - TIME_STEP_MINUTES;

const toMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const toOption = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  return {
    label: `${hours % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`,
    value: toTime(minutes),
  };
};

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

export const scheduleTimeOptions = Array.from(
  { length: (24 * 60) / TIME_STEP_MINUTES },
  (_, index) => toOption(index * TIME_STEP_MINUTES),
);

export const getScheduleTimeOptions = (time?: string) => {
  if (!time || scheduleTimeOptions.some((option) => option.value === time))
    return scheduleTimeOptions;
  return [...scheduleTimeOptions, toOption(toMinutes(time))].sort((a, b) =>
    a.value.localeCompare(b.value),
  );
};

export const sameDayStartTimeOptions = scheduleTimeOptions.slice(0, -1);
export const sameDayEndTimeOptions = scheduleTimeOptions.slice(1);
