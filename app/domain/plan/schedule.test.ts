import { describe, expect, it } from "vitest";

import {
  buildSchedule,
  formatClock,
  parseClock,
  timeOfDayMismatch,
  timeOfDayOf,
} from "~/domain/plan/schedule";
import { makeSpot } from "~/domain/plan/__fixtures__/spot";

describe("parseClock / formatClock", () => {
  it("HH:MM を分に変換する", () => {
    expect(parseClock("10:00")).toBe(600);
    expect(parseClock("00:30")).toBe(30);
    expect(parseClock("23:59")).toBe(1439);
  });

  it("不正な値は null", () => {
    expect(parseClock("9:00")).toBeNull();
    expect(parseClock("24:00")).toBeNull();
    expect(parseClock("10:60")).toBeNull();
    expect(parseClock("abc")).toBeNull();
  });

  it("分を H:MM 表記にする", () => {
    expect(formatClock(600)).toBe("10:00");
    expect(formatClock(665)).toBe("11:05");
    expect(formatClock(9)).toBe("0:09");
  });
});

describe("timeOfDayOf", () => {
  it("時刻を時間帯に分類する", () => {
    expect(timeOfDayOf(600)).toBe("morning"); // 10:00
    expect(timeOfDayOf(720)).toBe("lunch"); // 12:00
    expect(timeOfDayOf(900)).toBe("afternoon"); // 15:00
    expect(timeOfDayOf(1100)).toBe("evening"); // 18:20
  });
});

describe("buildSchedule", () => {
  it("移動時間を挟んで到着・出発を積み上げる", () => {
    const a = makeSpot({ id: "a", durationMinutes: 30 });
    const b = makeSpot({ id: "b", durationMinutes: 45 });
    const schedule = buildSchedule([a, b], 600);

    expect(schedule[0]).toMatchObject({
      spotId: "a",
      arrivalMinutes: 600,
      departureMinutes: 630,
      waitMinutes: 0,
      closedConflict: false,
    });
    // 同一座標なので移動は徒歩 5 分（最小値）。
    expect(schedule[1]).toMatchObject({
      spotId: "b",
      arrivalMinutes: 635,
      departureMinutes: 680,
    });
  });

  it("開店前に着いたら待機する", () => {
    const spot = makeSpot({
      durationMinutes: 30,
      openingHours: { open: "11:00", close: "20:00" },
    });
    const [stop] = buildSchedule([spot], 600);
    expect(stop.waitMinutes).toBe(60);
    expect(stop.arrivalMinutes).toBe(660);
    expect(stop.departureMinutes).toBe(690);
    expect(stop.closedConflict).toBe(false);
  });

  it("閉店までに見学を終えられないと conflict", () => {
    const spot = makeSpot({
      durationMinutes: 60,
      openingHours: { open: "09:00", close: "10:30" },
    });
    const [stop] = buildSchedule([spot], 600);
    expect(stop.closedConflict).toBe(true);
  });
});

describe("timeOfDayMismatch", () => {
  it("希望時間帯と一致なら 0", () => {
    const spot = makeSpot({ idealTimeOfDay: "lunch" });
    expect(timeOfDayMismatch(spot, 720)).toBe(0);
  });

  it("ずれていたら 1", () => {
    const spot = makeSpot({ idealTimeOfDay: "morning" });
    expect(timeOfDayMismatch(spot, 720)).toBe(1);
  });

  it("anytime / 未指定はミスマッチなし", () => {
    expect(timeOfDayMismatch(makeSpot({ idealTimeOfDay: "anytime" }), 720)).toBe(0);
    expect(timeOfDayMismatch(makeSpot(), 720)).toBe(0);
  });
});
