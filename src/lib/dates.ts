const formatter = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Dates must not inherit the locale of the build machine. */
export const formatHebrewDate = (date: Date) => formatter.format(date);
export const isoDate = (date?: Date) => date?.toISOString().slice(0, 10) ?? "";
