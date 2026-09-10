// Small HTTP wrapper shared by both storefront adapters.
//
// No headless browser: both stores expose server-rendered data (a WooCommerce
// Store API for Oskin, a server-rendered listing fragment for Tiendanube), so
// plain GETs are enough. See lib/sync/sources/*.ts.
//
// WHY THERE IS A node:https FALLBACK HERE
//
// oskinmx.com's TLS terminator asks the client to renegotiate mid-request.
// Node's global `fetch` (undici) refuses renegotiation and drops the socket, so
// every call to that host fails with ECONNRESET - reproducibly, on every
// attempt, while curl and node:https on the very same machine get a 200. The
// fallback below retries such failures through node:https, which does allow the
// renegotiation, and then remembers the host so later requests skip the doomed
// `fetch` entirely.
//
// This is why the sync endpoint must run on the Node runtime, not the edge
// runtime: node:https does not exist there.

import { request as httpsRequest } from "node:https";

const DEFAULT_TIMEOUT_MS = 25_000;
const USER_AGENT =
  "LuxuryFindsSync/1.0 (+https://luxuryfinds.mx; catalogue sync for allied stores)";

/** Hosts where `fetch` has already proven unusable; they go straight to node:https. */
const forceNodeHttps = new Set<string>();

function errorCode(error: unknown): string | undefined {
  return (error as { cause?: { code?: string } })?.cause?.code ?? (error as { code?: string })?.code;
}

/**
 * Failures shaped like the undici/TLS-renegotiation problem: the connection was
 * established and then torn down mid-request. ONLY these switch a host over to
 * node:https permanently.
 *
 * A DNS failure, a refused connection or a timeout are deliberately NOT in this
 * list. They say nothing about TLS, they resolve on their own, and switching
 * transport because of one would cost real bandwidth: node:https here requests
 * `identity` encoding, so a Tiendanube listing page that arrives gzipped through
 * fetch (~100 KB) would arrive raw (~1 MB) for the rest of the process.
 */
function isTlsTeardown(error: unknown): boolean {
  if (error instanceof HttpError || !(error instanceof Error)) return false;
  if (error.name === "AbortError" || error.name === "TimeoutError") return false;
  const code = errorCode(error);
  return code === "ECONNRESET" || code === "EPIPE" || code === "EPROTO" || code === "UND_ERR_SOCKET";
}

type RawResponse = { status: number; body: string };

/**
 * GET through node:https, following redirects manually (max 5). Used only as
 * the fallback described at the top of this file.
 */
function nodeHttpsGet(url: string, accept: string, timeoutMs: number, depth = 0): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (depth > 5) {
      reject(new Error(`Demasiadas redirecciones en ${url}`));
      return;
    }
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      reject(new Error(`Protocolo no soportado en ${url}`));
      return;
    }
    const req = httpsRequest(
      target,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: accept,
          "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          nodeHttpsGet(new URL(location, url).toString(), accept, timeoutMs, depth + 1).then(resolve, reject);
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Tiempo agotado en ${url}`)));
    req.end();
  });
}


export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type FetchOptions = {
  timeoutMs?: number;
  retries?: number;
  accept?: string;
  signal?: AbortSignal;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET with a timeout, bounded retries and exponential backoff. 4xx (except 429)
 * fails immediately - retrying a 404 only wastes the run's time budget.
 */
export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = 2, accept = "text/html,application/json" } = options;
  const host = safeHost(url);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { status, body } = forceNodeHttps.has(host)
        ? await nodeHttpsGet(url, accept, timeoutMs)
        : await fetchOnce(url, accept, timeoutMs, options.signal);

      if (status >= 200 && status < 300) return body;

      const error = new HttpError(`HTTP ${status} en ${url}`, status, url);
      const retriable = status === 429 || status >= 500;
      if (!retriable || attempt === retries) throw error;
      lastError = error;
    } catch (error) {
      // The undici/TLS-renegotiation problem documented at the top of the file:
      // switch this host over to node:https and retry immediately, without
      // burning one of the caller's retries on a failure we already understand.
      if (isTlsTeardown(error) && !forceNodeHttps.has(host)) {
        forceNodeHttps.add(host);
        try {
          const { status, body } = await nodeHttpsGet(url, accept, timeoutMs);
          if (status >= 200 && status < 300) return body;
          throw new HttpError(`HTTP ${status} en ${url}`, status, url);
        } catch (fallbackError) {
          lastError = fallbackError;
          if (fallbackError instanceof HttpError && fallbackError.status < 500 && fallbackError.status !== 429) {
            throw fallbackError;
          }
        }
      } else {
        lastError = error;
        if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error;
      }
      if (attempt === retries) break;
    }
    await sleep(600 * 2 ** attempt);
  }

  throw lastError instanceof Error ? lastError : new Error(`No fue posible descargar ${url}`);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function fetchOnce(
  url: string,
  accept: string,
  timeoutMs: number,
  outerSignal?: AbortSignal,
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept,
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
      },
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const body = await fetchText(url, { ...options, accept: "application/json" });
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`Respuesta no JSON en ${url}`);
  }
}

/** Runs `worker` over `items` with a fixed concurrency, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(concurrency, items.length || 1));

  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}
