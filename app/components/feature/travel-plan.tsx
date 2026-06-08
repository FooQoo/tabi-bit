import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Armchair,
  Ban,
  Bike,
  Car,
  Coffee,
  Compass,
  ExternalLink,
  Footprints,
  Landmark,
  type LucideIcon,
  Mountain,
  Palette,
  Pin,
  ShoppingBag,
  TrainFront,
  Trees,
  Utensils,
} from "lucide-react";

import { Badge } from "~/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import type { OptimizedPlan } from "~/domain/plan/plan";
import type { PlanProfile } from "~/domain/plan/optimize-plan";
import { formatClock } from "~/domain/plan/schedule";
import {
  type GeneratedSpot,
  type SpotCategory,
  spotCategoryLabels,
  timeOfDayLabels,
} from "~/domain/spot/spot";
import { cn } from "~/lib/utils";

import { PlanMap } from "./plan-map";

export function PlanPanel({
  maxBudgetYen,
  maxDurationMinutes,
  onMaxBudgetYenChange,
  onMaxDurationMinutesChange,
  onSelectProfile,
  onSpotClick,
  onStartTimeChange,
  onTogglePin,
  plan,
  placeIds,
  profiles,
  selectedProfileId,
  startTime,
}: {
  maxBudgetYen: string;
  maxDurationMinutes: string;
  onMaxBudgetYenChange: (value: string) => void;
  onMaxDurationMinutesChange: (value: string) => void;
  onSelectProfile: (id: string) => void;
  onSpotClick: (id: string) => void;
  onStartTimeChange: (value: string) => void;
  onTogglePin: (id: string) => void;
  plan: OptimizedPlan;
  placeIds: Record<string, string>;
  profiles: Array<{ profile: PlanProfile; plan: OptimizedPlan }>;
  selectedProfileId: string;
  startTime: string;
}) {
  const activeProfile =
    profiles.find((p) => p.profile.id === selectedProfileId)?.profile ??
    profiles[0]?.profile;
  const budget =
    plan.totalBudgetYen.min === 0 && plan.totalBudgetYen.max === 0
      ? "無料"
      : `${plan.totalBudgetYen.min.toLocaleString()}-${plan.totalBudgetYen.max.toLocaleString()}円`;

  return (
    <Card className="border-border/70 bg-card/90 shadow-xl shadow-black/5 xl:rounded-none xl:border-0 xl:shadow-none xl:bg-transparent">
      <CardHeader>
        <Badge className="w-fit" variant="secondary">
          最適化プラン
        </Badge>
        <CardTitle className="tracking-normal">
          {activeProfile ? `${activeProfile.label}案` : "プラン案"}
        </CardTitle>
        <CardDescription className="block min-h-[2.5rem]">
          {activeProfile?.description ??
            "生成済みスポットから条件に合わせて組み立てます。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className="flex flex-wrap gap-1.5"
          role="tablist"
          aria-label="プランの方向性"
        >
          {profiles.map(({ profile }) => {
            const isActive = profile.id === selectedProfileId;
            return (
              <button
                aria-selected={isActive}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-background/60 text-muted-foreground hover:bg-muted/60",
                )}
                key={profile.id}
                onClick={() => onSelectProfile(profile.id)}
                role="tab"
                type="button"
              >
                {profile.label}
              </button>
            );
          })}
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            出発時刻
          </span>
          <Input
            className="h-10"
            onChange={(event) => onStartTimeChange(event.target.value)}
            type="time"
            value={startTime}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1.5">
            <span
              className={cn(
                "text-xs font-medium",
                plan.durationExceeded
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              所要時間上限(分)
            </span>
            <Input
              className={cn(
                "h-10",
                plan.durationExceeded &&
                  "border-destructive ring-1 ring-destructive focus-visible:ring-destructive",
              )}
              inputMode="numeric"
              min={1}
              onChange={(event) =>
                onMaxDurationMinutesChange(event.target.value)
              }
              placeholder="例 240"
              type="number"
              value={maxDurationMinutes}
            />
            {plan.durationExceeded && (
              <p className="text-xs text-destructive">上限を超えています</p>
            )}
          </label>
          <label className="space-y-1.5">
            <span
              className={cn(
                "text-xs font-medium",
                plan.budgetExceeded
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              予算上限(円)
            </span>
            <Input
              className={cn(
                "h-10",
                plan.budgetExceeded &&
                  "border-destructive ring-1 ring-destructive focus-visible:ring-destructive",
              )}
              inputMode="numeric"
              min={0}
              onChange={(event) => onMaxBudgetYenChange(event.target.value)}
              placeholder="例 5000"
              type="number"
              value={maxBudgetYen}
            />
            {plan.budgetExceeded && (
              <p className="text-xs text-destructive">上限を超えています</p>
            )}
          </label>
        </div>

        {plan.spots.length === 0 ? (
          <div className="space-y-3">
            <p className="rounded-lg border border-dashed bg-background/60 p-4 text-sm text-muted-foreground">
              条件に合うスポットを待っています。条件をゆるめるか、もう少し生成してください。
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <SummaryMetric
                label="行程"
                value={`${formatClock(plan.startMinutes)}〜${formatClock(plan.endMinutes)}`}
              />
              <SummaryMetric
                label="合計時間"
                value={`${plan.totalDurationMinutes}分`}
              />
              <SummaryMetric
                label="移動時間"
                value={`${plan.totalTravelMinutes}分`}
              />
              <SummaryMetric
                label="滞在時間"
                value={`${plan.totalStayMinutes}分`}
              />
              <SummaryMetric label="予算目安" value={budget} />
              <SummaryMetric
                label="寄り道度"
                value={plan.averageDetourLevel.toFixed(1)}
              />
            </div>

            {plan.hasClosedConflict && (
              <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                営業時間外になりそうなスポットがあります。出発時刻を早めるか、対象を外してください。
              </p>
            )}

            <ol className="space-y-0">
              {plan.spots.map((spot, index) => {
                const isPinned = plan.pinnedSpotIds.has(spot.id);
                const stop = plan.scheduledStops[index];
                const leg = index > 0 ? plan.travelLegs[index - 1] : null;
                const ModeIcon =
                  leg?.mode === "walk"
                    ? Footprints
                    : leg?.mode === "train"
                      ? TrainFront
                      : Car;
                const modeLabel =
                  leg?.mode === "walk"
                    ? "徒歩"
                    : leg?.mode === "train"
                      ? "電車"
                      : "車";
                return (
                  <li key={spot.id}>
                    {leg && (
                      <div className="flex items-stretch gap-3">
                        <div className="flex w-7 shrink-0 flex-col items-center">
                          <span className="w-0.5 flex-1 bg-border/70" />
                          <span className="flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
                            <ModeIcon className="size-3" />
                          </span>
                          <span className="w-0.5 flex-1 bg-border/70" />
                        </div>
                        <div className="flex flex-1 items-center gap-1.5 py-2 text-xs text-muted-foreground">
                          <span className="font-medium">
                            {modeLabel}で約{leg.minutes}分
                          </span>
                          <span className="opacity-60">
                            ({leg.distanceKm.toFixed(1)}km)
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <div className="flex w-7 shrink-0 justify-center pt-1">
                        <span
                          className={cn(
                            "flex size-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                            isPinned
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-muted-foreground",
                          )}
                        >
                          {index + 1}
                        </span>
                      </div>
                      <div
                        className={cn(
                          "min-w-0 flex-1 cursor-pointer rounded-lg border bg-background/60 p-3 transition-colors hover:bg-muted/60",
                          isPinned &&
                            "border-primary/40 bg-primary/5 hover:bg-primary/10",
                        )}
                        onClick={() => onSpotClick(spot.id)}
                      >
                        <div className="flex items-start gap-3">
                          <SpotThumbnail placeId={placeIds[spot.id] ?? null} spot={spot} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex min-w-0 items-center gap-1">
                                <button
                                  aria-label={
                                    isPinned ? "ピン留め解除" : "プランに固定"
                                  }
                                  className={cn(
                                    "shrink-0 rounded p-0.5 transition-colors",
                                    isPinned
                                      ? "text-primary"
                                      : "text-muted-foreground/50 hover:text-muted-foreground",
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onTogglePin(spot.id);
                                  }}
                                  type="button"
                                >
                                  <Pin
                                    className={cn(
                                      "size-3",
                                      isPinned && "fill-primary",
                                    )}
                                  />
                                </button>
                                <p className="truncate text-sm font-medium leading-5">
                                  {spot.name}
                                </p>
                              </div>
                              <Badge className="shrink-0" variant="outline">
                                寄り道 {spot.detourLevel}
                              </Badge>
                            </div>
                            {stop && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                                <span
                                  className={cn(
                                    "font-medium tabular-nums",
                                    stop.closedConflict
                                      ? "text-destructive"
                                      : "text-foreground/80",
                                  )}
                                >
                                  {formatClock(stop.arrivalMinutes)}–
                                  {formatClock(stop.departureMinutes)}
                                </span>
                                {spot.idealTimeOfDay &&
                                  spot.idealTimeOfDay !== "anytime" && (
                                    <span className="text-muted-foreground">
                                      {timeOfDayLabels[spot.idealTimeOfDay]}向き
                                    </span>
                                  )}
                                {stop.waitMinutes > 0 && (
                                  <span className="text-amber-600">
                                    開店待ち{stop.waitMinutes}分
                                  </span>
                                )}
                                {stop.closedConflict && (
                                  <span className="text-destructive">
                                    営業時間外
                                  </span>
                                )}
                              </div>
                            )}
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {spot.description}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Badge variant="secondary">
                            {spotCategoryLabels[spot.category]}
                          </Badge>
                          <Badge variant="outline">
                            {spot.durationMinutes}分
                          </Badge>
                          {spot.municipality && (
                            <Badge variant="outline">{spot.municipality}</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            <PlanMap spots={plan.spots} travelLegs={plan.travelLegs} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/70 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

const categoryVisual: Record<
  SpotCategory,
  { icon: LucideIcon; gradient: string }
> = {
  nature: { icon: Trees, gradient: "from-emerald-200 to-teal-300" },
  food: { icon: Utensils, gradient: "from-orange-200 to-rose-300" },
  cafe: { icon: Coffee, gradient: "from-amber-200 to-orange-300" },
  culture: { icon: Palette, gradient: "from-violet-200 to-fuchsia-300" },
  history: { icon: Landmark, gradient: "from-stone-200 to-amber-300" },
  shopping: { icon: ShoppingBag, gradient: "from-pink-200 to-rose-300" },
  activity: { icon: Bike, gradient: "from-sky-200 to-cyan-300" },
  view: { icon: Mountain, gradient: "from-indigo-200 to-sky-300" },
  relax: { icon: Armchair, gradient: "from-green-200 to-emerald-300" },
  hidden: { icon: Compass, gradient: "from-teal-200 to-emerald-300" },
};

type PhotoStatus = "loading" | "loaded" | "none";

const SpotPhoto = memo(function SpotPhoto({
  spot,
  placeId,
}: {
  spot: GeneratedSpot;
  placeId: string | null;
}) {
  const [status, setStatus] = useState<PhotoStatus>("loading");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inViewportRef = useRef(false);
  const didFetchRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Always up-to-date without triggering effect re-runs
  const placeIdRef = useRef(placeId);
  placeIdRef.current = placeId;

  const doFetch = useCallback((pid: string) => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch(`/api/spots/photo?placeId=${encodeURIComponent(pid)}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json() as Promise<{ photoUrls: string[] }>)
      .then(({ photoUrls }) => {
        const url = photoUrls[0] ?? null;
        startTransition(() => {
          setPhotoUrl(url);
          setStatus(url ? "loaded" : "none");
        });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) startTransition(() => setStatus("none"));
      });
  }, []);

  // placeId が null → "" or "ChIJ..." に変わったとき
  useEffect(() => {
    if (placeId === null) return;
    if (placeId === "") {
      startTransition(() => setStatus("none"));
      return;
    }
    if (inViewportRef.current) doFetch(placeId);
  }, [placeId, doFetch]);

  // IntersectionObserver は一度だけセットアップ
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        inViewportRef.current = true;
        observer.disconnect();
        const pid = placeIdRef.current;
        if (pid) doFetch(pid);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      abortRef.current?.abort();
    };
  }, [doFetch]);

  const fallback = categoryVisual[spot.category];
  const FallbackIcon = fallback.icon;

  return (
    <div
      className="relative -mt-4 aspect-video w-full overflow-hidden rounded-t-xl bg-muted"
      ref={containerRef}
    >
      {status === "loaded" && photoUrl ? (
        <>
          <img
            alt={spot.name}
            className="h-full w-full object-cover"
            decoding="async"
            loading="lazy"
            src={photoUrl}
          />
          <span className="absolute bottom-1.5 right-2 text-[10px] text-white/70 drop-shadow">
            Powered by Google
          </span>
        </>
      ) : status === "loading" ? (
        <Skeleton className="h-full w-full rounded-none" />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${fallback.gradient}`}
        >
          <FallbackIcon className="size-10 text-foreground/35" />
        </div>
      )}
    </div>
  );
});

const SpotThumbnail = memo(function SpotThumbnail({
  spot,
  placeId,
}: {
  spot: GeneratedSpot;
  placeId: string | null;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inViewportRef = useRef(false);
  const didFetchRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const placeIdRef = useRef(placeId);
  placeIdRef.current = placeId;

  const doFetch = useCallback((pid: string) => {
    if (didFetchRef.current) return;
    didFetchRef.current = true;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    fetch(`/api/spots/photo?placeId=${encodeURIComponent(pid)}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json() as Promise<{ photoUrls: string[] }>)
      .then(({ photoUrls }) => {
        startTransition(() => {
          setPhotoUrl(photoUrls[0] ?? null);
          setReady(true);
        });
      })
      .catch(() => {
        if (!ctrl.signal.aborted) startTransition(() => setReady(true));
      });
  }, []);

  useEffect(() => {
    if (placeId === null) return;
    if (placeId === "") {
      startTransition(() => setReady(true));
      return;
    }
    if (inViewportRef.current) doFetch(placeId);
  }, [placeId, doFetch]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        inViewportRef.current = true;
        observer.disconnect();
        const pid = placeIdRef.current;
        if (pid) doFetch(pid);
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      abortRef.current?.abort();
    };
  }, [doFetch]);

  const fallback = categoryVisual[spot.category];
  const FallbackIcon = fallback.icon;

  return (
    <div
      className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted"
      ref={containerRef}
    >
      {!ready && <Skeleton className="absolute inset-0" />}
      {ready && photoUrl ? (
        <img
          alt={spot.name}
          className="h-full w-full object-cover"
          decoding="async"
          src={photoUrl}
        />
      ) : ready ? (
        <div
          className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${fallback.gradient}`}
        >
          <FallbackIcon className="size-6 text-foreground/35" />
        </div>
      ) : null}
    </div>
  );
});

export const SpotCard = memo(function SpotCard({
  index,
  isBlacklisted,
  isPinned,
  onToggleBlacklist,
  onTogglePin,
  placeId,
  spot,
}: {
  index: number;
  isBlacklisted: boolean;
  isPinned: boolean;
  onToggleBlacklist: (id: string) => void;
  onTogglePin: (id: string) => void;
  placeId: string | null;
  spot: GeneratedSpot;
}) {
  const budget =
    spot.budgetYen.min === 0 && spot.budgetYen.max === 0
      ? "無料"
      : `${spot.budgetYen.min.toLocaleString()}-${spot.budgetYen.max.toLocaleString()}円`;

  return (
    <Card
      className={cn(
        "h-full overflow-hidden border-border/70 bg-card/88 transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/8",
        isPinned && "border-primary/50 ring-1 ring-primary/20",
        isBlacklisted && "opacity-40 grayscale hover:opacity-60",
      )}
      data-spot-id={spot.id}
    >
      <SpotPhoto placeId={placeId} spot={spot} />
      <CardHeader>
        <div className="mb-2 flex items-center justify-between gap-2">
          <Badge variant="secondary">{spotCategoryLabels[spot.category]}</Badge>
          <div className="flex items-center gap-1.5">
            <button
              aria-label={isBlacklisted ? "除外を解除" : "プランから除外"}
              className={cn(
                "rounded-full p-1 transition-colors",
                isBlacklisted
                  ? "text-destructive"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onToggleBlacklist(spot.id)}
              type="button"
            >
              <Ban className={cn("size-4", isBlacklisted && "fill-destructive/20")} />
            </button>
            <button
              aria-label={isPinned ? "ピン留め解除" : "プランに固定"}
              className={cn(
                "rounded-full p-1 transition-colors",
                isPinned
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => onTogglePin(spot.id)}
              type="button"
            >
              <Pin className={cn("size-4", isPinned && "fill-primary")} />
            </button>
            <span className="text-xs text-muted-foreground">
              #{String(index + 1).padStart(2, "0")}
            </span>
          </div>
        </div>
        <CardTitle className="line-clamp-1 text-base tracking-normal">
          {spot.name}
        </CardTitle>
        <CardDescription className="line-clamp-2">
          {spot.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{spot.durationMinutes}分</Badge>
          <Badge variant="outline">{budget}</Badge>
          <Badge variant="outline">寄り道度 {spot.detourLevel}</Badge>
          {spot.municipality && (
            <Badge variant="outline">{spot.municipality}</Badge>
          )}
        </div>
        <div className="space-y-1.5">
          {spot.highlights.slice(0, 2).map((highlight) => (
            <p
              className="rounded-md bg-muted px-3 py-1.5 text-xs"
              key={highlight}
            >
              {highlight}
            </p>
          ))}
        </div>
        {placeId && (
          <a
            className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            href={`https://www.google.com/maps/place/?q=place_id:${placeId}`}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3" />
            Google マップで開く
          </a>
        )}
      </CardContent>
    </Card>
  );
});

export function SpotSkeleton() {
  return (
    <Card className="h-full border-border/60 bg-card/70">
      <Skeleton className="-mt-4 aspect-video w-full rounded-none rounded-t-xl" />
      <CardHeader>
        <div className="mb-2 flex items-center justify-between">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-4 w-8" />
        </div>
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardContent className="flex gap-2">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </CardContent>
      <CardContent className="space-y-2 pt-0">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}
