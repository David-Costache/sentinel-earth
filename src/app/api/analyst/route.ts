import { anthropic } from "@ai-sdk/anthropic";
import { isStepCount, streamText, tool } from "ai";
import { z } from "zod";
import { distanceKm, getEvents, getNeos, getSpaceWeather } from "@/lib/nasa";

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(24),
});

const system = (today: string) => `You are the analyst inside Sentinel Earth, a NASA open-data situational awareness globe.
Today is ${today}.
Answer only from tool results. Call a tool before stating any fact about events or asteroids.
Cite every event you mention with its id in square brackets, like [EONET_1234]. Cite asteroids like [NEO:2026 AB1].
The interface turns those citations into buttons that fly the globe to the place, so cite precisely.
The data has no population layer. When asked about populated areas, reason from coordinates with your own
geographic knowledge and say that it is an estimate.
Write short plain text. No markdown, no headings. If the data cannot answer the question, say so.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: "The analyst is offline. Set ANTHROPIC_API_KEY on the server and restart it." },
      { status: 503 },
    );
  }
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  // shortcut: no rate limit on this route, so a public deployment spends your API credits; add one before sharing the URL widely.
  const result = streamText({
    model: anthropic(process.env.ANALYST_MODEL || "claude-opus-5-5"),
    system: system(new Date().toISOString().slice(0, 10)),
    messages: body.data.messages,
    maxOutputTokens: 1200,
    stopWhen: isStepCount(6),
    tools: {
      get_natural_events: tool({
        description:
          "Open natural events from NASA EONET for the last 30 days (wildfires, severe storms, volcanoes, floods, sea ice and more). Optionally filter by category id or by distance from a point.",
        inputSchema: z.object({
          category: z.string().optional().describe("EONET category id, e.g. wildfires, severeStorms, volcanoes, floods, seaLakeIce"),
          near: z.object({ lat: z.number(), lng: z.number(), radiusKm: z.number().positive() }).optional(),
          limit: z.number().int().min(1).max(80).default(40),
        }),
        execute: async ({ category, near, limit }) => {
          const feed = await getEvents();
          const items = feed.items
            .filter((e) => !category || e.category === category)
            .filter((e) => !near || distanceKm(near.lat, near.lng, e.lat, e.lng) <= near.radiusKm);
          const counts: Record<string, number> = {};
          for (const e of items) counts[e.category] = (counts[e.category] ?? 0) + 1;
          return {
            dataIsStale: feed.stale,
            totalMatching: items.length,
            countsByCategory: counts,
            events: items
              .slice(0, limit)
              .map(({ id, title, category, date, lat, lng, magnitude }) => ({ id, title, category, date, lat, lng, magnitude })),
          };
        },
      }),
      get_close_approaches: tool({
        description:
          "Near-Earth objects passing within 0.05 AU of Earth in the next 30 days, from the JPL SBDB Close-Approach API. Distances are in lunar distances (LD).",
        inputSchema: z.object({ maxLunarDistances: z.number().positive().optional() }),
        execute: async ({ maxLunarDistances }) => {
          const feed = await getNeos();
          return {
            dataIsStale: feed.stale,
            approaches: feed.items
              .filter((n) => !maxLunarDistances || n.distLd <= maxLunarDistances)
              .map((n) => ({ ...n, distLd: +n.distLd.toFixed(2), distKm: Math.round(n.distKm), diameterM: Math.round(n.diameterM) })),
          };
        },
      }),
      get_space_weather: tool({
        description:
          "Space weather from NASA DONKI for the last 30 days: solar flares, coronal mass ejections (speed in km/s), high-speed solar wind streams and geomagnetic storms (Kp index).",
        inputSchema: z.object({ kind: z.enum(["flare", "cme", "stream", "storm"]).optional() }),
        execute: async ({ kind }) => {
          const feed = await getSpaceWeather();
          return {
            dataIsStale: feed.stale,
            events: feed.items.filter((s) => !kind || s.kind === kind).slice(0, 60).map(({ kind, time, label, value }) => ({ kind, time, label, value })),
          };
        },
      }),
    },
  });
  return result.toTextStreamResponse();
}
