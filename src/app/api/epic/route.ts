import { connection } from "next/server";
import { getEpic } from "@/lib/nasa";

export async function GET() {
  await connection(); // live data: never prerender at build time
  return Response.json(await getEpic(), {
    headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" },
  });
}
