import type { GeneratedSpot, TimeOfDay } from "~/domain/spot/spot";
import type { ScheduledStop } from "~/domain/plan/plan";
import { estimateTravel } from "~/domain/plan/travel";

/** 既定の出発時刻（10:00）。 */
export const DEFAULT_START_MINUTES = 10 * 60;

const MINUTES_PER_DAY = 24 * 60;

/** "HH:MM" を 0:00 からの分に変換する。不正値は null。 */
export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 0:00 からの分を "H:MM" 表記にする。 */
export function formatClock(totalMinutes: number): string {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}`;
}

/** 時刻（分）を時間帯バケットに分類する。 */
export function timeOfDayOf(totalMinutes: number): Exclude<TimeOfDay, "anytime"> {
  const wrapped = ((totalMinutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  if (wrapped < 11 * 60) return "morning";
  if (wrapped < 14 * 60) return "lunch";
  if (wrapped < 17 * 60) return "afternoon";
  return "evening";
}

/**
 * 出発時刻から順路に沿って各スポットの予定を組む。
 * 開店前なら待機し、見学が閉店に間に合わなければ closedConflict を立てる。
 */
export function buildSchedule(
  orderedSpots: GeneratedSpot[],
  startMinutes: number,
): ScheduledStop[] {
  const stops: ScheduledStop[] = [];
  let clock = startMinutes;

  orderedSpots.forEach((spot, index) => {
    if (index > 0) {
      clock += estimateTravel(orderedSpots[index - 1], spot).minutes;
    }

    let waitMinutes = 0;
    let serviceStart = clock;
    let closedConflict = false;

    const hours = spot.openingHours;
    if (hours) {
      const open = parseClock(hours.open);
      const close = parseClock(hours.close);
      if (open !== null && close !== null && close > open) {
        if (serviceStart < open) {
          waitMinutes = open - serviceStart;
          serviceStart = open;
        }
        if (serviceStart + spot.durationMinutes > close) {
          closedConflict = true;
        }
      }
    }

    const departureMinutes = serviceStart + spot.durationMinutes;
    stops.push({
      spotId: spot.id,
      arrivalMinutes: serviceStart,
      departureMinutes,
      waitMinutes,
      closedConflict,
    });
    clock = departureMinutes;
  });

  return stops;
}

/** スポットの希望時間帯と実際の見学時間帯のミスマッチ度（0=一致）。 */
export function timeOfDayMismatch(
  spot: GeneratedSpot,
  arrivalMinutes: number,
): number {
  const ideal = spot.idealTimeOfDay;
  if (!ideal || ideal === "anytime") return 0;
  return ideal === timeOfDayOf(arrivalMinutes) ? 0 : 1;
}
