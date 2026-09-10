import { NextResponse, type NextRequest } from "next/server";
import { runSync } from "../../../../lib/sync/engine";
import { matchesSyncCronSecret, hasSyncCronSecret } from "../../../../lib/sync/env";
import { SYNC_SOURCES, type SyncSource, type SyncType } from "../../../../lib/sync/types";

/**
 * Catalogue synchronisation endpoint. Runs Maw Maw and Oskin against the Luxury
 * Finds catalogue, applies the MAX() price rule and reports what it did.
 *
 * AUTHENTICATION
 *
 * A shared secret in a header, exactly like the Telegram webhook next door:
 *
 *     Authorization: Bearer <SYNC_CRON_SECRET>
 *     x-sync-secret: <SYNC_CRON_SECRET>          (equivalent, for schedulers
 *                                                 that cannot set Authorization)
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`, so setting
 * SYNC_CRON_SECRET and CRON_SECRET to the same value makes the platform cron and
 * any external scheduler (cron-job.org, GitHub Actions, an Uptime monitor…) use
 * the same door. Nothing here depends on Vercel: the fallback header is why the
 * schedule can be moved elsewhere the day the plan's cron frequency is not
 * enough. Without the secret configured the endpoint refuses everything, rather
 * than defaulting to open.
 *
 * RUNTIME AND THE VERCEL FREE PLAN - PLEASE READ BEFORE CHANGING THE NUMBERS
 *
 * Node, not edge: lib/sync/http.ts falls back to node:https for oskinmx.com,
 * whose TLS terminator forces a renegotiation that undici's fetch will not do.
 *
 * maxDuration is 60, not 300, because Vercel's Hobby plan caps a function at 60
 * seconds and DEPLOYMENT FAILS if vercel.json asks for more than the plan
 * allows. On Pro, raise both this value and vercel.json's to 300 and the sync
 * will simply get through more of the catalogue per invocation.
 *
 * The same caveat applies to the cron itself: vercel.json declares a
 * once-every-15-minutes expression, but the Hobby plan only actually triggers
 * cron jobs ONCE A DAY regardless of what the expression says. A true 15-minute
 * cadence needs Pro, or an external scheduler calling this endpoint with the
 * header above - which works on any plan, and is exactly why the secret is
 * accepted from a plain header and not only from Vercel's Authorization.
 *
 * DEFAULT_BUDGET_MS below is sized to fit inside 60s with room to write the
 * results; a caller may raise it with ?budgetMs= when the plan allows.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Leaves ~8s of the 60s function limit to finish writes and answer. */
const DEFAULT_BUDGET_MS = 52_000;

function isAuthorised(request: NextRequest): boolean {
  const bearer = request.headers.get("authorization");
  const token = bearer?.toLowerCase().startsWith("bearer ") ? bearer.slice(7).trim() : null;
  return matchesSyncCronSecret(token) || matchesSyncCronSecret(request.headers.get("x-sync-secret"));
}

function parseSources(value: string | null): SyncSource[] {
  if (!value || value === "all") return [...SYNC_SOURCES];
  const requested = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return SYNC_SOURCES.filter((source) => requested.includes(source));
}

function parseSyncType(value: string | null): SyncType {
  return value === "INITIAL" || value === "MANUAL" ? value : "INCREMENTAL";
}

async function handle(request: NextRequest) {
  if (!hasSyncCronSecret()) {
    return NextResponse.json(
      { ok: false, error: "SYNC_CRON_SECRET no está configurado en el servidor." },
      { status: 503 },
    );
  }
  if (!isAuthorised(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const sources = parseSources(params.get("source"));
  if (!sources.length) {
    return NextResponse.json({ ok: false, error: "Fuente desconocida." }, { status: 400 });
  }

  const syncType = parseSyncType(params.get("type"));
  const dryRun = params.get("dry") === "1";
  const maxPages = Number(params.get("maxPages")) || undefined;
  // The whole invocation shares one budget so two sources cannot together run
  // past the function's time limit.
  const budgetMs = Math.min(Number(params.get("budgetMs")) || DEFAULT_BUDGET_MS, 280_000);
  const perSourceBudget = Math.floor(budgetMs / sources.length);

  const results = [];
  for (const source of sources) {
    results.push(
      await runSync({
        source,
        syncType,
        dryRun,
        maxPages,
        budgetMs: perSourceBudget,
        // Brands are only worth the extra /marcas/ pass on a full run.
        withBrands: syncType !== "INCREMENTAL",
      }),
    );
  }

  const anyFailed = results.some((result) => result.status === "failed");
  return NextResponse.json(
    {
      ok: !anyFailed,
      runs: results.map((result) => ({
        source: result.source,
        status: result.status,
        syncType: result.syncType,
        dryRun: result.dryRun,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        counters: result.counters,
        matchedByMethod: result.matchedByMethod,
        errorCount: result.errors.length,
        errors: result.errors.slice(0, 20),
        priceMoves: result.priceMoves.slice(0, 20),
      })),
    },
    { status: anyFailed ? 500 : 200 },
  );
}

export async function POST(request: NextRequest) {
  return handle(request);
}

/**
 * Vercel Cron issues GET, so both verbs are accepted. Both still require the
 * secret; there is no unauthenticated path into this route.
 */
export async function GET(request: NextRequest) {
  return handle(request);
}
