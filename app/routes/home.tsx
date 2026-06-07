import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { prefectures, type Prefecture } from "~/lib/prefectures";
import {
  type GeneratedSpot,
  MAX_SPOTS_PER_SESSION,
  SPOT_BATCH_SIZE,
  SPOT_PREFETCH_THRESHOLD,
  spotCategoryLabels,
} from "~/lib/spot-model";

type FeedEvent =
  | { type: "spot"; spot: GeneratedSpot }
  | { type: "error"; message: string }
  | { type: "done" };

type FeedInput = {
  travelImage: string;
  prefecture: Prefecture;
};

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
  const isGeneratingRef = useRef(false);
  const spotsRef = useRef<GeneratedSpot[]>([]);

  const selectedPrefecture = useMemo(
    () => prefectures.find((prefecture) => prefecture.code === prefectureCode),
    [prefectureCode],
  );

  const canSubmit = travelImage.trim().length > 0 && Boolean(selectedPrefecture);
  const hasReachedLimit = spots.length >= MAX_SPOTS_PER_SESSION;

  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);

  const readSpotStream = useCallback(
    async (input: FeedInput, alreadyGeneratedCount: number) => {
      if (isGeneratingRef.current || alreadyGeneratedCount >= MAX_SPOTS_PER_SESSION) {
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

    setFeedInput(input);
    setSpots([]);
    setError(null);
    void readSpotStream(input, 0);
  }, [readSpotStream, selectedPrefecture, travelImage]);

  const regenerate = useCallback(() => {
    if (!feedInput) return;
    setSpots([]);
    setError(null);
    void readSpotStream(feedInput, 0);
  }, [feedInput, readSpotStream]);

  useEffect(() => {
    if (!feedInput) return;

    const handleScroll = () => {
      const distanceToBottom =
        document.documentElement.scrollHeight -
        (window.scrollY + window.innerHeight);
      const remaining = spotsRef.current.length % SPOT_BATCH_SIZE;
      const isNearBatchEnd =
        remaining === 0 || SPOT_BATCH_SIZE - remaining <= SPOT_PREFETCH_THRESHOLD;

      if (
        distanceToBottom < 600 &&
        isNearBatchEnd &&
        !isGeneratingRef.current &&
        spotsRef.current.length > 0 &&
        spotsRef.current.length < MAX_SPOTS_PER_SESSION &&
        !error
      ) {
        void readSpotStream(feedInput, spotsRef.current.length);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [error, feedInput, readSpotStream]);

  useEffect(() => {
    if (!feedInput) return;

    const remaining = spots.length % SPOT_BATCH_SIZE;
    const isNearBatchEnd =
      remaining === 0 || SPOT_BATCH_SIZE - remaining <= SPOT_PREFETCH_THRESHOLD;

    if (
      isNearBatchEnd &&
      !isGeneratingRef.current &&
      spots.length > 0 &&
      spots.length < MAX_SPOTS_PER_SESSION &&
      !error
    ) {
      const timeoutId = window.setTimeout(() => {
        const distanceToBottom =
          document.documentElement.scrollHeight -
          (window.scrollY + window.innerHeight);
        if (
          distanceToBottom < 600 &&
          !isGeneratingRef.current &&
          spotsRef.current.length < MAX_SPOTS_PER_SESSION
        ) {
          void readSpotStream(feedInput, spotsRef.current.length);
        }
      }, 100);

      return () => window.clearTimeout(timeoutId);
    }
  }, [error, feedInput, readSpotStream, spots.length]);

  if (!feedInput) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_50%_18%,oklch(0.94_0.07_170),transparent_30%),linear-gradient(180deg,oklch(0.99_0.02_100),oklch(0.96_0.02_250))] px-4 text-foreground">
        <section className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center gap-8 py-16">
          <div className="space-y-3 text-center">
            <p className="text-sm font-medium text-muted-foreground">旅bit</p>
            <h1 className="text-5xl font-semibold tracking-normal text-balance md:text-7xl">
              旅bit
            </h1>
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
                <Select onValueChange={setPrefectureCode} value={prefectureCode}>
                  <SelectTrigger
                    aria-label="都道府県"
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
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,oklch(0.99_0.018_105),oklch(0.97_0.02_190)_42%,oklch(0.96_0.018_270))] px-4 py-6 text-foreground md:px-8">
      <header className="mx-auto mb-8 flex max-w-7xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <button
            className="mb-3 text-sm font-medium text-muted-foreground transition hover:text-foreground"
            onClick={() => {
              setFeedInput(null);
              setSpots([]);
              setError(null);
            }}
            type="button"
          >
            旅bit
          </button>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-normal text-balance md:text-5xl">
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

      <section className="mx-auto grid max-w-7xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {spots.map((spot, index) => (
          <SpotCard key={spot.id} index={index} spot={spot} />
        ))}

        {isGenerating &&
          Array.from({ length: Math.max(2, SPOT_BATCH_SIZE - (spots.length % SPOT_BATCH_SIZE || SPOT_BATCH_SIZE)) }).map(
            (_, index) => <SpotSkeleton key={`skeleton-${index}`} />,
          )}
      </section>

      {error && (
        <div className="mx-auto mt-8 flex max-w-7xl flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-card/80 p-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button onClick={regenerate} type="button" variant="outline">
            再生成
          </Button>
        </div>
      )}

      {hasReachedLimit && !isGenerating && (
        <div className="mx-auto mt-8 flex max-w-7xl flex-col items-start gap-3 rounded-lg border bg-card/80 p-4">
          <p className="text-sm text-muted-foreground">
            100件まで生成しました。
          </p>
          <Button onClick={regenerate} type="button" variant="outline">
            再生成
          </Button>
        </div>
      )}

      <div className="h-12" />
    </main>
  );
}

function SpotCard({ index, spot }: { index: number; spot: GeneratedSpot }) {
  const budget =
    spot.budgetYen.min === 0 && spot.budgetYen.max === 0
      ? "無料"
      : `${spot.budgetYen.min.toLocaleString()}-${spot.budgetYen.max.toLocaleString()}円`;

  return (
    <Card className="h-full overflow-hidden border-border/70 bg-card/88 transition duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/8">
      <CardHeader>
        <div className="mb-2 flex items-center justify-between gap-2">
          <Badge variant="secondary">{spotCategoryLabels[spot.category]}</Badge>
          <span className="text-xs text-muted-foreground">
            #{String(index + 1).padStart(2, "0")}
          </span>
        </div>
        <CardTitle className="line-clamp-2 text-xl tracking-normal">
          {spot.name}
        </CardTitle>
        <CardDescription className="line-clamp-3">
          {spot.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{spot.durationMinutes}分</Badge>
          <Badge variant="outline">{budget}</Badge>
          <Badge variant="outline">寄り道度 {spot.detourLevel}</Badge>
          {spot.municipality && (
            <Badge variant="outline">{spot.municipality}</Badge>
          )}
        </div>
        <p className="rounded-md border border-dashed border-border bg-background/60 px-3 py-2 text-sm text-muted-foreground">
          {spot.detourAppeal}
        </p>
        <div className="space-y-2">
          {spot.highlights.slice(0, 3).map((highlight) => (
            <p className="rounded-md bg-muted px-3 py-2 text-sm" key={highlight}>
              {highlight}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SpotSkeleton() {
  return (
    <Card className="h-full border-border/60 bg-card/70">
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
