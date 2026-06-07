import type { GeneratedSpot } from "~/domain/spot/spot";

export type TravelMode = "walk" | "train" | "car";

export type TravelLeg = {
  fromSpotId: string;
  toSpotId: string;
  distanceKm: number;
  minutes: number;
  mode: TravelMode;
};

export type PlanConstraints = {
  maxDurationMinutes?: number;
  maxBudgetYen?: number;
  /** 出発時刻（0:00 からの分）。未指定なら既定値を使う。 */
  startMinutes?: number;
};

/** 各スポットの到着〜出発の予定。spots と同じ並び順。 */
export type ScheduledStop = {
  spotId: string;
  /** 到着（開店待ちがあれば待機後の見学開始）時刻。0:00 からの分。 */
  arrivalMinutes: number;
  /** 出発時刻。0:00 からの分。 */
  departureMinutes: number;
  /** 開店までの待機時間（分）。 */
  waitMinutes: number;
  /** 営業時間外で見学を完了できない場合 true。 */
  closedConflict: boolean;
};

export type OptimizedPlan = {
  spots: GeneratedSpot[];
  travelLegs: TravelLeg[];
  scheduledStops: ScheduledStop[];
  totalStayMinutes: number;
  totalTravelMinutes: number;
  totalWaitMinutes: number;
  totalDurationMinutes: number;
  /** 出発時刻（0:00 からの分）。 */
  startMinutes: number;
  /** 帰着（最終スポット出発）時刻。0:00 からの分。 */
  endMinutes: number;
  totalBudgetYen: { min: number; max: number };
  averageDetourLevel: number;
  categoryCount: number;
  durationExceeded: boolean;
  budgetExceeded: boolean;
  hasClosedConflict: boolean;
  pinnedSpotIds: Set<string>;
};
