import { z } from "zod";

export const SPOT_BATCH_SIZE = 10;
export const SPOT_PREFETCH_THRESHOLD = 3;
export const MAX_SPOTS_PER_SESSION = 100;
export const SPOT_GENERATION_MODEL = "gemini-3.5-flash";

export const spotCategories = [
  "nature",
  "food",
  "cafe",
  "culture",
  "history",
  "shopping",
  "activity",
  "view",
  "relax",
  "hidden",
] as const;

export const spotCategoryLabels: Record<SpotCategory, string> = {
  nature: "自然",
  food: "食事",
  cafe: "カフェ",
  culture: "文化",
  history: "歴史",
  shopping: "買い物",
  activity: "体験",
  view: "眺望",
  relax: "休憩",
  hidden: "穴場",
};

export const spotSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  highlights: z.array(z.string().min(1)).min(1).max(2),
  detourLevel: z.number().int().min(1).max(3),
  latitude: z.number().min(20).max(46),
  longitude: z.number().min(122).max(154),
  durationMinutes: z.number().int().min(15).max(480),
  budgetYen: z.object({
    min: z.number().int().min(0).max(300000),
    max: z.number().int().min(0).max(300000),
  }),
  category: z.enum(spotCategories),
  country: z.literal("Japan"),
  prefecture: z.string().min(1),
  municipality: z.string().min(1).optional(),
});

export const generateSpotsRequestSchema = z.object({
  travelImage: z.string().trim().min(1).max(300),
  prefecture: z.object({
    code: z.string().min(1),
    label: z.string().min(1),
  }),
  excludeNames: z.array(z.string()).default([]),
  count: z.number().int().min(1).max(SPOT_BATCH_SIZE).default(SPOT_BATCH_SIZE),
  alreadyGeneratedCount: z
    .number()
    .int()
    .min(0)
    .max(MAX_SPOTS_PER_SESSION)
    .default(0),
});

export type SpotCategory = (typeof spotCategories)[number];
export type GeneratedSpot = z.infer<typeof spotSchema>;
export type GenerateSpotsRequest = z.infer<typeof generateSpotsRequestSchema>;
