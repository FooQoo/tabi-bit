import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronRight } from "lucide-react";

import * as Sentry from "@sentry/react-router";
import type { Route } from "./+types/_index";
import {
  PlanPanel,
  SpotCard,
  SpotSkeleton,
} from "~/components/feature/travel-plan";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { generatePlans } from "~/domain/plan/optimize-plan";
import { parseClock } from "~/domain/plan/schedule";
import { prefectures, type Prefecture } from "~/domain/prefecture/prefecture";
import {
  type GeneratedSpot,
  MAX_SPOTS_PER_SESSION,
  SPOT_BATCH_SIZE,
  TRAVEL_IMAGE_MAX_LENGTH,
} from "~/domain/spot/spot";

// --- Session storage ---
const SESSION_KEY_PREFIX = "tabi-bit:session:";
const SESSION_INDEX_KEY = "tabi-bit:sessions";
const SESSION_PATH_PREFIX = "/sessions/";
const MAX_SESSIONS = 20;
const PLACE_ID_KEY_PREFIX = "tabi-bit:placeId:";

function savePlaceId(spotId: string, placeId: string) {
  try {
    localStorage.setItem(`${PLACE_ID_KEY_PREFIX}${spotId}`, placeId);
  } catch {
    // localStorage unavailable
  }
}

function loadPlaceId(spotId: string): string | null {
  try {
    return localStorage.getItem(`${PLACE_ID_KEY_PREFIX}${spotId}`);
  } catch {
    return null;
  }
}

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
  // null = 未解決, "" = 解決済みだがPlace ID無し, "ChIJ..." = 有効なPlace ID
  const [placeIds, setPlaceIds] = useState<Record<string, string>>({});
  const isGeneratingRef = useRef(false);
  const spotsRef = useRef<GeneratedSpot[]>([]);
  const travelImageInputRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionRef = useRef<{
    id: string;
    input: FeedInput;
    createdAt: number;
  } | null>(null);

  const selectedPrefecture = useMemo(
    () => prefectures.find((prefecture) => prefecture.code === prefectureCode),
    [prefectureCode],
  );
  const resizeTravelImageInput = useCallback(() => {
    const input = travelImageInputRef.current;
    if (!input) return;

    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, []);
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

  const travelImageLength = travelImage.length;
  const canSubmit =
    travelImage.trim().length > 0 &&
    travelImageLength <= TRAVEL_IMAGE_MAX_LENGTH &&
    Boolean(selectedPrefecture);
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
    setPlaceIds({});
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

    const restoredPlaceIds: Record<string, string> = {};
    for (const spot of session.spots) {
      restoredPlaceIds[spot.id] = loadPlaceId(spot.id) ?? "";
    }

    setFeedInput(input);
    setSpots(session.spots);
    setError(null);
    setPinnedSpotIds(new Set(session.pinnedSpotIds ?? []));
    setBlacklistedSpotIds(new Set(session.blacklistedSpotIds ?? []));
    setPlaceIds(restoredPlaceIds);
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
    resizeTravelImageInput();
  }, [resizeTravelImageInput, travelImage]);

  useEffect(() => {
    const session = activeSessionRef.current;
    if (!session) return;
    updateSessionPinState(
      session.id,
      [...pinnedSpotIds],
      [...blacklistedSpotIds],
    );
  }, [pinnedSpotIds, blacklistedSpotIds]);

  const batchResolvePlaceIds = useCallback(async (spots: GeneratedSpot[]) => {
    try {
      const body = {
        spots: spots.map((spot) => ({
          id: spot.id,
          name: spot.name,
          area: [spot.municipality, spot.prefecture].filter(Boolean).join(" "),
        })),
      };
      const response = await fetch("/api/spots/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        results: Array<{ id: string; placeId: string | null }>;
      };
      const resolved: Record<string, string> = {};
      for (const { id, placeId } of data.results) {
        resolved[id] = placeId ?? "";
        if (placeId) savePlaceId(id, placeId);
      }
      setPlaceIds((prev) => ({ ...prev, ...resolved }));
    } catch (error) {
      Sentry.captureException(error, {
        tags: { feature: "place-id-resolve" },
        extra: { spotCount: spots.length },
      });
      // 名前解決失敗: 各スポットを "" にして skeleton を解除する
      const fallback: Record<string, string> = {};
      for (const spot of spots) fallback[spot.id] = "";
      setPlaceIds((prev) => ({ ...prev, ...fallback }));
    }
  }, []);

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

      const newlyGeneratedSpots: GeneratedSpot[] = [];

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
              newlyGeneratedSpots.push(event.spot);
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
        Sentry.captureException(streamError, {
          tags: { feature: "spot-stream" },
        });
        setError("スポット生成に失敗しました。");
      } finally {
        isGeneratingRef.current = false;
        setIsGenerating(false);
        if (newlyGeneratedSpots.length > 0) {
          void batchResolvePlaceIds(newlyGeneratedSpots);
        }
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
    setPlaceIds({});
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
    setPlaceIds({});
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
              <textarea
                aria-label="旅のイメージ"
                aria-describedby="travel-image-length"
                className="min-h-14 w-full resize-none overflow-hidden rounded-[1.25rem] border-0 bg-transparent px-5 py-4 text-base leading-6 shadow-none outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground focus-visible:ring-0 md:flex-1 md:text-lg"
                maxLength={TRAVEL_IMAGE_MAX_LENGTH}
                onChange={(event) =>
                  setTravelImage(
                    event.target.value.slice(0, TRAVEL_IMAGE_MAX_LENGTH),
                  )
                }
                placeholder="静かな海辺で本を読みたい"
                ref={travelImageInputRef}
                rows={1}
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
            <p
              className="px-4 text-right text-xs tabular-nums text-muted-foreground"
              id="travel-image-length"
            >
              {travelImageLength}/{TRAVEL_IMAGE_MAX_LENGTH}
            </p>
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
          <h1 className="max-w-3xl break-words text-3xl font-bold tracking-normal text-balance [overflow-wrap:anywhere] md:text-5xl font-[family-name:var(--font-rounded)]">
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
          placeIds={placeIds}
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
              placeId={placeIds[spot.id] ?? null}
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
          placeIds={placeIds}
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
