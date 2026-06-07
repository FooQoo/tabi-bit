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
};

export type OptimizedPlan = {
  spots: GeneratedSpot[];
  travelLegs: TravelLeg[];
  totalStayMinutes: number;
  totalTravelMinutes: number;
  totalDurationMinutes: number;
  totalBudgetYen: { min: number; max: number };
  averageDetourLevel: number;
  categoryCount: number;
  durationExceeded: boolean;
  budgetExceeded: boolean;
  pinnedSpotIds: Set<string>;
};
