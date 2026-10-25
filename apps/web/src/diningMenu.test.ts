import { describe, expect, it } from "vitest";
import { hallIsOpen, isOpenAt, type DiningHall, type DiningStation } from "./diningMenu.ts";

const pines: DiningStation = {
  name: "Pines",
  locId: "1",
  locDetId: "1",
  hours: [
    { day: "SUN", open: "Closed", close: "Closed" },
    { day: "MON", open: "7:00 AM", close: "11:00 PM" },
    { day: "FRI", open: "10:00 PM", close: "2:00 AM" },
    { day: "SAT", open: "11:00 AM", close: "8:00 PM" },
  ],
};

const hall: DiningHall = {
  name: "Pines",
  locId: "1",
  stations: [
    pines,
    {
      name: "Breeze",
      locId: "1",
      locDetId: "2",
      hours: [{ day: "MON", open: "11:00 AM", close: "2:00 PM" }],
    },
  ],
};

describe("isOpenAt", () => {
  it("uses the weekday hours and treats the closing time as closed", () => {
    expect(isOpenAt(pines, "2026-10-26", new Date(2026, 9, 26, 7, 0))).toBe(true);
    expect(isOpenAt(pines, "2026-10-26", new Date(2026, 9, 26, 6, 59))).toBe(false);
    expect(isOpenAt(pines, "2026-10-26", new Date(2026, 9, 26, 23, 0))).toBe(false);
    expect(isOpenAt(pines, "2026-10-25", new Date(2026, 9, 25, 12, 0))).toBe(false);
  });

  it("keeps a close after midnight on the next morning", () => {
    expect(isOpenAt(pines, "2026-10-30", new Date(2026, 9, 30, 23, 30))).toBe(true);
    expect(isOpenAt(pines, "2026-10-31", new Date(2026, 9, 31, 1, 0))).toBe(true);
    expect(isOpenAt(pines, "2026-10-31", new Date(2026, 9, 31, 3, 0))).toBe(false);
  });
});

describe("hallIsOpen", () => {
  it("is open when a station is, even if the hall clock is not", () => {
    expect(hallIsOpen(hall, "2026-10-26", new Date(2026, 9, 26, 8, 0))).toBe(true);
    expect(hallIsOpen(hall, "2026-10-26", new Date(2026, 9, 26, 6, 0))).toBe(false);
  });
});
