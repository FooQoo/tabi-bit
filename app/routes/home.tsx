import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Armchair,
  Ban,
  Bike,
  Car,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Compass,
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

import type { Route } from "./+types/home";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { PlanMap } from "~/components/plan-map";
import { cn } from "~/lib/utils";
import { prefectures, type Prefecture } from "~/domain/prefecture/prefecture";
import {
  type GeneratedSpot,
  MAX_SPOTS_PER_SESSION,
  SPOT_BATCH_SIZE,
  type SpotCategory,
  spotCategoryLabels,
  timeOfDayLabels,
} from "~/domain/spot/spot";
import type { OptimizedPlan } from "~/domain/plan/plan";
import { generatePlans, type PlanProfile } from "~/domain/plan/optimize-plan";
import { formatClock, parseClock } from "~/domain/plan/schedule";

// --- Session storage ---
const SESSION_KEY_PREFIX = "tabi-bit:session:";
const SESSION_INDEX_KEY = "tabi-bit:sessions";
const SESSION_PATH_PREFIX = "/sessions/";
const MAX_SESSIONS = 20;

type SessionEntry = {
  id: string;
  travelImage: string;
  prefecture: Prefecture;
  createdAt: number;
};

type StoredSession = SessionEntry & {
  spots: GeneratedSpot[];
  pinnedSpotIds?: string[];
  blacklistedSpotIds?: string[];
};

function loadSession(id: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(`${SESSION_KEY_PREFIX}${id}`);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function createSession(session: StoredSession) {
  try {
    localStorage.setItem(
      `${SESSION_KEY_PREFIX}${session.id}`,
      JSON.stringify(session),
    );
    const raw = localStorage.getItem(SESSION_INDEX_KEY);
    const index: SessionEntry[] = raw
      ? (JSON.parse(raw) as SessionEntry[])
      : [];
    const next = [
      {
        id: session.id,
        travelImage: session.travelImage,
        prefecture: session.prefecture,
        createdAt: session.createdAt,
      },
      ...index.filter((s) => s.id !== session.id),
    ].slice(0, MAX_SESSIONS);
    localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable
  }
}

function updateSessionSpots(id: string, spots: GeneratedSpot[]) {
  try {
    const raw = localStorage.getItem(`${SESSION_KEY_PREFIX}${id}`);
    if (!raw) return;
    const session = JSON.parse(raw) as StoredSession;
    localStorage.setItem(
      `${SESSION_KEY_PREFIX}${id}`,
      JSON.stringify({ ...session, spots }),
    );
  } catch {
    // ignore
  }
}

function updateSessionPinState(
  id: string,
  pinnedSpotIds: string[],
  blacklistedSpotIds: string[],
) {
  try {
    const raw = localStorage.getItem(`${SESSION_KEY_PREFIX}${id}`);
    if (!raw) return;
    const session = JSON.parse(raw) as StoredSession;
    localStorage.setItem(
      `${SESSION_KEY_PREFIX}${id}`,
      JSON.stringify({ ...session, pinnedSpotIds, blacklistedSpotIds }),
    );
  } catch {
    // ignore
  }
}

function loadSessionIndex(): SessionEntry[] {
  try {
    const raw = localStorage.getItem(SESSION_INDEX_KEY);
    return raw ? (JSON.parse(raw) as SessionEntry[]) : [];
  } catch {
    return [];
  }
}

function getSessionIdFromLocation() {
  if (!window.location.pathname.startsWith(SESSION_PATH_PREFIX)) return null;

  const sessionId = window.location.pathname.slice(SESSION_PATH_PREFIX.length);
  return sessionId ? decodeURIComponent(sessionId) : null;
}

function getSessionPath(sessionId: string) {
  return `${SESSION_PATH_PREFIX}${encodeURIComponent(sessionId)}`;
}
// --- End session storage ---

type FeedEvent =
  | { type: "spot"; spot: GeneratedSpot }
  | { type: "error"; message: string }
  | { type: "done" };

type FeedInput = {
  travelImage: string;
  prefecture: Prefecture;
};

const TRAVEL_IMAGE_EXAMPLES = [
  "雨の日に歩きたい",
  "本屋と喫茶店",
  "静かな海辺",
  "変な寄り道多め",
];

export function meta({}: Route.MetaArgs) {
  return [
    { title: "旅bit" },
    { name: "description", content: "旅のイメージからスポットを生成する" },
  ];
}

export default function Home() {
  const [travelImage, setTravelImage] = useState("");
  const [prefectureCode, setPrefectureCode] = useState("");
  const [feedInput, setFeedInput] = useState<FeedInput | null>(null);
  const [spots, setSpots] = useState<GeneratedSpot[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState("360");
  const [maxBudgetYen, setMaxBudgetYen] = useState("5000");
  const [startTime, setStartTime] = useState("10:00");
  const [sessionHistory, setSessionHistory] = useState<SessionEntry[]>([]);
  const [pinnedSpotIds, setPinnedSpotIds] = useState<Set<string>>(new Set());
  const [blacklistedSpotIds, setBlacklistedSpotIds] = useState<Set<string>>(new Set());
  const isGeneratingRef = useRef(false);
  const spotsRef = useRef<GeneratedSpot[]>([]);
  const activeSessionRef = useRef<{
    id: string;
    input: FeedInput;
    createdAt: number;
  } | null>(null);

  const selectedPrefecture = useMemo(
    () => prefectures.find((prefecture) => prefecture.code === prefectureCode),
    [prefectureCode],
  );
  const planConstraints = useMemo(
    () => ({
      maxDurationMinutes: parsePositiveInteger(maxDurationMinutes),
      maxBudgetYen: parseNonNegativeInteger(maxBudgetYen),
      startMinutes: parseClock(startTime) ?? undefined,
    }),
    [maxBudgetYen, maxDurationMinutes, startTime],
  );

  const togglePin = useCallback((spotId: string) => {
    setPinnedSpotIds((prev) => {
      const next = new Set(prev);
      if (next.has(spotId)) {
        next.delete(spotId);
      } else {
        next.add(spotId);
        setBlacklistedSpotIds((b) => {
          if (!b.has(spotId)) return b;
          const nb = new Set(b);
          nb.delete(spotId);
          return nb;
        });
      }
      return next;
    });
  }, []);

  const toggleBlacklist = useCallback((spotId: string) => {
    setBlacklistedSpotIds((prev) => {
      const next = new Set(prev);
      if (next.has(spotId)) {
        next.delete(spotId);
      } else {
        next.add(spotId);
        setPinnedSpotIds((p) => {
          if (!p.has(spotId)) return p;
          const np = new Set(p);
          np.delete(spotId);
          return np;
        });
      }
      return next;
    });
  }, []);

  const canSubmit =
    travelImage.trim().length > 0 && Boolean(selectedPrefecture);
  const hasReachedLimit = spots.length >= MAX_SPOTS_PER_SESSION;
  const [selectedProfileId, setSelectedProfileId] = useState("balanced");
  const plans = useMemo(
    () => generatePlans(spots, planConstraints, pinnedSpotIds, blacklistedSpotIds),
    [blacklistedSpotIds, planConstraints, pinnedSpotIds, spots],
  );
  const optimizedPlan =
    plans.find((p) => p.profile.id === selectedProfileId)?.plan ??
    plans[0].plan;

  const resetViewToHome = useCallback(() => {
    activeSessionRef.current = null;
    setFeedInput(null);
    setSpots([]);
    setError(null);
    setPinnedSpotIds(new Set());
    setBlacklistedSpotIds(new Set());
    setSessionHistory(loadSessionIndex());
  }, []);

  const restoreSession = useCallback((session: StoredSession) => {
    const input = {
      travelImage: session.travelImage,
      prefecture: session.prefecture,
    };

    activeSessionRef.current = {
      id: session.id,
      input,
      createdAt: session.createdAt,
    };

    setFeedInput(input);
    setSpots(session.spots);
    setError(null);
    setPinnedSpotIds(new Set(session.pinnedSpotIds ?? []));
    setBlacklistedSpotIds(new Set(session.blacklistedSpotIds ?? []));
  }, []);

  const syncViewToLocation = useCallback(() => {
    const sessionId = getSessionIdFromLocation();

    if (!sessionId) {
      resetViewToHome();
      return;
    }

    const session = loadSession(sessionId);
    if (session && session.spots.length > 0) {
      restoreSession(session);
      setSessionHistory(loadSessionIndex());
      return;
    }

    window.history.replaceState(null, "", "/");
    resetViewToHome();
  }, [resetViewToHome, restoreSession]);

  useEffect(() => {
    syncViewToLocation();
    window.addEventListener("popstate", syncViewToLocation);

    return () => {
      window.removeEventListener("popstate", syncViewToLocation);
    };
  }, [syncViewToLocation]);

  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);

  useEffect(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    updateSessionPinState(
      session.id,
      [...pinnedSpotIds],
      [...blacklistedSpotIds],
    );
  }, [pinnedSpotIds, blacklistedSpotIds]);

  const readSpotStream = useCallback(
    async (input: FeedInput, alreadyGeneratedCount: number) => {
      if (
        isGeneratingRef.current ||
        alreadyGeneratedCount >= MAX_SPOTS_PER_SESSION
      ) {
        return;
      }

      isGeneratingRef.current = true;
      setIsGenerating(true);
      setError(null);

      try {
        const response = await fetch("/api/spots/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            travelImage: input.travelImage,
            prefecture: input.prefecture,
            excludeNames:
              alreadyGeneratedCount === 0
                ? []
                : spotsRef.current.map((spot) => spot.name),
            count: SPOT_BATCH_SIZE,
            alreadyGeneratedCount,
          }),
        });

        if (!response.body) {
          throw new Error("ReadableStream is not available.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const localAccumulated: GeneratedSpot[] =
          alreadyGeneratedCount === 0 ? [] : [...spotsRef.current];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const event = JSON.parse(trimmed) as FeedEvent;

            if (event.type === "spot") {
              setSpots((currentSpots) => {
                if (currentSpots.length >= MAX_SPOTS_PER_SESSION) {
                  return currentSpots;
                }
                return [...currentSpots, event.spot];
              });
              localAccumulated.push(event.spot);
              const activeSession = activeSessionRef.current;
              if (activeSession) {
                updateSessionSpots(activeSession.id, localAccumulated);
              }
            }

            if (event.type === "error") {
              setError(event.message);
            }
          }
        }
      } catch (streamError) {
        console.error(streamError);
        setError("スポット生成に失敗しました。");
      } finally {
        isGeneratingRef.current = false;
        setIsGenerating(false);
      }
    },
    [],
  );

  const startFeed = useCallback(() => {
    if (!selectedPrefecture || travelImage.trim().length === 0) return;

    const input = {
      travelImage: travelImage.trim(),
      prefecture: selectedPrefecture,
    };

    const sessionId = crypto.randomUUID();
    const createdAt = Date.now();
    activeSessionRef.current = { id: sessionId, input, createdAt };
    createSession({
      id: sessionId,
      travelImage: input.travelImage,
      prefecture: input.prefecture,
      spots: [],
      createdAt,
    });
    window.history.pushState(null, "", getSessionPath(sessionId));

    setFeedInput(input);
    setSpots([]);
    setError(null);
    setPinnedSpotIds(new Set());
    setBlacklistedSpotIds(new Set());
    void readSpotStream(input, 0);
  }, [readSpotStream, selectedPrefecture, travelImage]);

  const regenerate = useCallback(() => {
    if (!feedInput) return;

    const sessionId = crypto.randomUUID();
    const createdAt = Date.now();
    activeSessionRef.current = { id: sessionId, input: feedInput, createdAt };
    createSession({
      id: sessionId,
      travelImage: feedInput.travelImage,
      prefecture: feedInput.prefecture,
      spots: [],
      createdAt,
    });
    window.history.pushState(null, "", getSessionPath(sessionId));

    setSpots([]);
    setError(null);
    setPinnedSpotIds(new Set());
    setBlacklistedSpotIds(new Set());
    void readSpotStream(feedInput, 0);
  }, [feedInput, readSpotStream]);

  const scrollToSpot = useCallback((spotId: string) => {
    document
      .querySelector(`[data-spot-id="${spotId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const loadMore = useCallback(() => {
    if (
      !feedInput ||
      isGeneratingRef.current ||
      spots.length >= MAX_SPOTS_PER_SESSION
    )
      return;
    void readSpotStream(feedInput, spots.length);
  }, [feedInput, readSpotStream, spots.length]);

  if (!feedInput) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_50%_18%,oklch(0.94_0.07_170),transparent_30%),linear-gradient(180deg,oklch(0.99_0.02_100),oklch(0.96_0.02_250))] px-4 text-foreground">
        <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-8 py-16">
          <div className="flex flex-col items-center gap-3 text-center">
            <img alt="tabiBit." className="w-64 md:w-80" src="/logo.png" />
            <p className="max-w-lg text-balance text-sm leading-6 text-muted-foreground md:text-base">
              旅の気分から、実在する寄り道スポットを生成します。
            </p>
          </div>

          <form
            className="w-full space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              startFeed();
            }}
          >
            <div className="flex flex-col gap-3 rounded-[2rem] border border-border/80 bg-card/85 p-3 shadow-xl shadow-black/5 backdrop-blur md:flex-row">
              <Input
                aria-label="旅のイメージ"
                className="!h-14 flex-1 border-0 bg-transparent px-5 text-base shadow-none focus-visible:ring-0 md:text-lg"
                onChange={(event) => setTravelImage(event.target.value)}
                placeholder="静かな海辺で本を読みたい"
                style={{ height: "3.5rem" }}
                value={travelImage}
              />
              <div className="flex flex-col gap-3 md:w-64 md:flex-row">
                <Select
                  onValueChange={setPrefectureCode}
                  value={prefectureCode}
                >
                  <SelectTrigger
                    aria-label="行きたい都道府県"
                    className="!h-14 w-full rounded-full border-border/70 bg-background/80 px-5"
                  >
                    <SelectValue placeholder="都道府県" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {prefectures.map((prefecture) => (
                      <SelectItem key={prefecture.code} value={prefecture.code}>
                        {prefecture.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="h-14 rounded-full px-7 text-base md:w-auto"
                  disabled={!canSubmit}
                  type="submit"
                >
                  生成
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                入力例
              </span>
              {TRAVEL_IMAGE_EXAMPLES.map((example) => (
                <button
                  className="rounded-full border border-border/70 bg-background/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-card hover:text-foreground"
                  key={example}
                  onClick={() => setTravelImage(example)}
                  type="button"
                >
                  {example}
                </button>
              ))}
            </div>
          </form>

          {sessionHistory.length > 0 && (
            <div className="w-full space-y-3">
              <p className="text-xs font-medium tracking-widest text-muted-foreground">
                最近の旅
              </p>
              <div className="flex flex-col gap-2">
                {sessionHistory.slice(0, 5).map((entry) => (
                  <button
                    className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-left transition hover:bg-card/90"
                    key={entry.id}
                    onClick={() => {
                      const session = loadSession(entry.id);
                      if (session && session.spots.length > 0) {
                        restoreSession(session);
                        window.history.pushState(
                          null,
                          "",
                          getSessionPath(session.id),
                        );
                      }
                    }}
                    type="button"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {entry.travelImage}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.prefecture.label}
                      </p>
                    </div>
                    <ChevronRight className="size-4 flex-shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,oklch(0.99_0.018_105),oklch(0.97_0.02_190)_42%,oklch(0.96_0.018_270))] px-4 py-6 text-foreground md:px-8 xl:pr-[376px]">
      <header className="mx-auto mb-8 flex max-w-[1600px] flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <button
            className="mb-3 inline-flex items-center gap-2 opacity-80 transition hover:opacity-100"
            onClick={() => {
              resetViewToHome();
              window.history.pushState(null, "", "/");
            }}
            type="button"
          >
            <img alt="tabiBit." className="h-10 w-auto" src="/logo-title.png" />
          </button>
          <h1 className="max-w-3xl text-3xl font-bold tracking-normal text-balance md:text-5xl font-[family-name:var(--font-rounded)]">
            {feedInput.travelImage}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{feedInput.prefecture.label}</Badge>
            <Badge variant="outline">
              {spots.length}/{MAX_SPOTS_PER_SESSION}
            </Badge>
            {isGenerating && <Badge>生成中</Badge>}
          </div>
        </div>
        <Button
          className="rounded-full"
          onClick={regenerate}
          type="button"
          variant="outline"
        >
          再生成
        </Button>
      </header>

      {/* モバイル・タブレット: インライン表示 */}
      <div className="mx-auto mb-6 max-w-7xl xl:hidden">
        <PlanPanel
          maxBudgetYen={maxBudgetYen}
          maxDurationMinutes={maxDurationMinutes}
          onMaxBudgetYenChange={setMaxBudgetYen}
          onMaxDurationMinutesChange={setMaxDurationMinutes}
          onSelectProfile={setSelectedProfileId}
          onSpotClick={scrollToSpot}
          onStartTimeChange={setStartTime}
          onTogglePin={togglePin}
          plan={optimizedPlan}
          profiles={plans}
          selectedProfileId={selectedProfileId}
          startTime={startTime}
        />
      </div>

      <div className="mx-auto max-w-[1600px]">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {spots.map((spot, index) => (
            <SpotCard
              index={index}
              isBlacklisted={blacklistedSpotIds.has(spot.id)}
              isPinned={pinnedSpotIds.has(spot.id)}
              key={spot.id}
              onToggleBlacklist={toggleBlacklist}
              onTogglePin={togglePin}
              spot={spot}
            />
          ))}

          {isGenerating &&
            Array.from({ length: 3 }).map((_, index) => (
              <SpotSkeleton key={`skeleton-${index}`} />
            ))}
        </section>
      </div>

      {/* 固定サイドバー (xl+) */}
      <aside className="fixed inset-y-0 right-0 hidden w-[360px] overflow-y-auto border-l bg-background xl:block">
        <PlanPanel
          maxBudgetYen={maxBudgetYen}
          maxDurationMinutes={maxDurationMinutes}
          onMaxBudgetYenChange={setMaxBudgetYen}
          onMaxDurationMinutesChange={setMaxDurationMinutes}
          onSelectProfile={setSelectedProfileId}
          onSpotClick={scrollToSpot}
          onStartTimeChange={setStartTime}
          onTogglePin={togglePin}
          plan={optimizedPlan}
          profiles={plans}
          selectedProfileId={selectedProfileId}
          startTime={startTime}
        />
      </aside>

      {error && (
        <div className="mx-auto mt-8 flex max-w-7xl flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-card/80 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button onClick={regenerate} type="button" variant="outline">
            再生成
          </Button>
        </div>
      )}

      {!error && !isGenerating && spots.length > 0 && (
        <div className="mx-auto mt-8 flex max-w-7xl items-center justify-center">
          {hasReachedLimit ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-muted-foreground">
                100件まで生成しました。
              </p>
              <Button onClick={regenerate} type="button" variant="outline">
                再生成
              </Button>
            </div>
          ) : (
            <Button
              className="rounded-full px-8"
              onClick={loadMore}
              type="button"
              variant="outline"
            >
              もっと見る
            </Button>
          )}
        </div>
      )}

      <div className="h-12" />
    </main>
  );
}

function parsePositiveInteger(value: string) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : undefined;
}

function parseNonNegativeInteger(value: string) {
  if (value.trim().length === 0) return undefined;
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue >= 0
    ? parsedValue
    : undefined;
}

function PlanPanel({
  maxBudgetYen,
  maxDurationMinutes,
  onMaxBudgetYenChange,
  onMaxDurationMinutesChange,
  onSelectProfile,
  onSpotClick,
  onStartTimeChange,
  onTogglePin,
  plan,
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
                          <SpotThumbnail spot={spot} />
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

const SpotPhoto = memo(function SpotPhoto({ spot }: { spot: GeneratedSpot }) {
  const [status, setStatus] = useState<PhotoStatus>("loading");
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let didFetch = false;
    const controller = new AbortController();

    const fetchPhotos = async () => {
      if (didFetch) return;
      didFetch = true;

      try {
        const area = [spot.municipality, spot.prefecture]
          .filter(Boolean)
          .join(" ");
        const params = new URLSearchParams({ name: spot.name, area });
        const response = await fetch(`/api/spots/photo?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { photoUrls: string[] };

        if (data.photoUrls.length > 0) {
          startTransition(() => {
            setPhotoUrls(data.photoUrls);
            setStatus("loaded");
          });
        } else {
          startTransition(() => setStatus("none"));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          startTransition(() => setStatus("none"));
        }
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void fetchPhotos();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [spot.municipality, spot.name, spot.prefecture]);

  const fallback = categoryVisual[spot.category];
  const FallbackIcon = fallback.icon;

  const prev = () =>
    setCurrentIndex((i) => (i - 1 + photoUrls.length) % photoUrls.length);
  const next = () => setCurrentIndex((i) => (i + 1) % photoUrls.length);

  return (
    <div
      className="relative -mt-4 aspect-video w-full overflow-hidden rounded-t-xl bg-muted"
      ref={containerRef}
    >
      {status === "loaded" && photoUrls.length > 0 ? (
        <>
          <div
            className="flex h-full transition-transform duration-300 ease-in-out"
            style={{ transform: `translateX(-${currentIndex * 100}%)` }}
          >
            {photoUrls.map((url, i) => (
              <img
                alt={`${spot.name} ${i + 1}`}
                className="h-full w-full flex-shrink-0 object-cover"
                decoding="async"
                key={url}
                loading="lazy"
                src={url}
              />
            ))}
          </div>

          {photoUrls.length > 1 && (
            <>
              <button
                aria-label="前の写真"
                className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 text-white backdrop-blur-sm transition hover:bg-black/60"
                onClick={prev}
                type="button"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                aria-label="次の写真"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1 text-white backdrop-blur-sm transition hover:bg-black/60"
                onClick={next}
                type="button"
              >
                <ChevronRight className="size-4" />
              </button>
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                {photoUrls.map((_, i) => (
                  <button
                    aria-label={`写真 ${i + 1}`}
                    className={`size-1.5 rounded-full transition-all ${
                      i === currentIndex
                        ? "bg-white"
                        : "bg-white/45 hover:bg-white/70"
                    }`}
                    key={i}
                    onClick={() => setCurrentIndex(i)}
                    type="button"
                  />
                ))}
              </div>
            </>
          )}
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

const SpotThumbnail = memo(function SpotThumbnail({ spot }: { spot: GeneratedSpot }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let didFetch = false;
    const controller = new AbortController();

    const fetchPhoto = async () => {
      if (didFetch) return;
      didFetch = true;
      try {
        const area = [spot.municipality, spot.prefecture].filter(Boolean).join(" ");
        const params = new URLSearchParams({ name: spot.name, area });
        const response = await fetch(`/api/spots/photo?${params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { photoUrls: string[] };
        startTransition(() => {
          setPhotoUrl(data.photoUrls[0] ?? null);
          setReady(true);
        });
      } catch {
        if (!controller.signal.aborted) startTransition(() => setReady(true));
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          void fetchPhoto();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);
    return () => { observer.disconnect(); controller.abort(); };
  }, [spot.municipality, spot.name, spot.prefecture]);

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

const SpotCard = memo(function SpotCard({
  index,
  isBlacklisted,
  isPinned,
  onToggleBlacklist,
  onTogglePin,
  spot,
}: {
  index: number;
  isBlacklisted: boolean;
  isPinned: boolean;
  onToggleBlacklist: (id: string) => void;
  onTogglePin: (id: string) => void;
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
      <SpotPhoto spot={spot} />
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
      </CardContent>
    </Card>
  );
});

function SpotSkeleton() {
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
