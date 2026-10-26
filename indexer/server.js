import http from "node:http";
import { createReadQueryPool } from "./read-query-pool.js";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { validStatusData } from "./status-snapshot.js";
import { createAnalyticsCache } from "./analytics-cache.js";
import { openDeveloperKeys, developerResponse } from "./developer-api.js";
import { openAccountNames } from "./account-names.js";
import { transactionSearch } from "./transaction-search.js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
    inspectAnchorPayload
} from "./anchor.js";

const dataDirectory =
    process.env.KEETAVIEW_DATA_DIR ||
    "./indexer";

const databaseFile =
    path.join(
        dataDirectory,
        "keetascan.db"
    );

const stateFile =
    path.join(
        dataDirectory,
        "state.json"
    );

const trafficDatabaseFile =
    path.join(
        dataDirectory,
        "site-analytics.db"
    );

const apiActivityFile =
    path.join(
        dataDirectory,
        "api-activity"
    );

const accountNames = openAccountNames(path.join(dataDirectory, "account-names.db"));
const developerKeys = openDeveloperKeys(path.join(dataDirectory, "developer-api.db"));

let lastApiActivityWrite = 0;
const activityRoutes = new Map();
const diagnosticRoutes = new Set([
    "/api/v1/status", "/api/v1/block", "/api/v1/transfers",
    "/api/status", "/api/market", "/api/analytics", "/api/blocks",
    "/api/accounts", "/api/transfers", "/api/operations", "/api/assets",
    "/api/transaction", "/api/account-label", "/api/anchors", "/api/anchors/search"
]);

function markApiActivity(pathname) {
    const now = Date.now();
    // Record only known route names, never query strings, addresses or IPs.
    const route = diagnosticRoutes.has(pathname) ? pathname : "/api/other";
    activityRoutes.set(route, (activityRoutes.get(route) || 0) + 1);

    if (now - lastApiActivityWrite < 5000) {
        return;
    }

    lastApiActivityWrite = now;
    const routes = Object.fromEntries(activityRoutes);
    activityRoutes.clear();

    fs.promises.writeFile(
        apiActivityFile,
        JSON.stringify({ timestamp: now, routes })
    ).catch((error) => {
        console.warn(
            "Could not record API activity:",
            error
        );
    });
}

function readIndexerState() {
    try {
        return JSON.parse(
            fs.readFileSync(stateFile, "utf8")
        );
    } catch (error) {
        console.warn("Could not read indexer state:", error);
        return null;
    }
}

const projectRoot =
    fileURLToPath(
        new URL(
            "../",
            import.meta.url
        )
    );

const database =
    new DatabaseSync(
        databaseFile,
        {
            readOnly: true
        }
    );

database.exec(`
    PRAGMA busy_timeout = 5000;
`);

const trafficDatabase =
    new DatabaseSync(
        trafficDatabaseFile
    );

trafficDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 2000;

    CREATE TABLE IF NOT EXISTS traffic_visitors (
        visitor_id TEXT PRIMARY KEY,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        total_pageviews INTEGER NOT NULL DEFAULT 0,
        last_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traffic_daily_visitors (
        day TEXT NOT NULL,
        visitor_id TEXT NOT NULL,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        pageviews INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, visitor_id)
    );

    CREATE TABLE IF NOT EXISTS traffic_daily_pages (
        day TEXT NOT NULL,
        path TEXT NOT NULL,
        pageviews INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, path)
    );

    CREATE TABLE IF NOT EXISTS traffic_daily_referrers (
        day TEXT NOT NULL,
        referrer TEXT NOT NULL,
        pageviews INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, referrer)
    );

    CREATE TABLE IF NOT EXISTS traffic_active_sessions (
        visitor_id TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL,
        last_path TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS traffic_active_last_seen
        ON traffic_active_sessions(last_seen);
`);

const port =
    Number(process.env.PORT) ||
    3000;


const host =
    process.env.HOST ||
    (
        process.env.RAILWAY_ENVIRONMENT
            ? "0.0.0.0"
            : "127.0.0.1"
    );

// Main-thread liveness is distinct from index freshness and database readiness.
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
setInterval(() => {
    const maximumMs = eventLoop.max / 1e6;
    if (maximumMs >= 1000) console.warn(JSON.stringify({ event: 'api_event_loop_delay', maximumMs: Math.round(maximumMs) }));
    eventLoop.reset();
}, 10000).unref();
const statusSnapshots = createAnalyticsCache({
    databaseFile, stateFile,
    cacheFile: path.join(dataDirectory, 'index-status-cache.json'),
    refreshMs: 30000, retryMs: 10000,
    workerURL: new URL('./status-worker.js', import.meta.url),
    validateData: validStatusData,
    onError: error => console.error('Status snapshot refresh failed:', error.message)
});
// Warm the snapshot without holding an HTTP request open.
void statusSnapshots.get();

// Expensive operations searches cannot occupy the HTTP event loop.
const operationQueries = createReadQueryPool({ databaseFile, concurrency: 1, maxQueue: 4 });
const filteredOperationQueries = createReadQueryPool({ databaseFile, concurrency: 1, maxQueue: 4 });

const marketCache = new Map();

const marketCacheDuration = 60 * 1000;

const analyticsSnapshots = createAnalyticsCache({
    databaseFile,
    stateFile,
    cacheFile: path.join(dataDirectory, "network-analytics-cache.json")
});

function isAllowedLocalOrigin(origin) {
    if (!origin) {
        return false;
    }

    try {
        const parsedOrigin =
            new URL(origin);

        return (
            (
                parsedOrigin.hostname === "localhost" ||
                parsedOrigin.hostname === "127.0.0.1"
            ) &&
            (
                parsedOrigin.protocol === "http:" ||
                parsedOrigin.protocol === "https:"
            )
        );
    } catch {
        return false;
    }
}

function sendJson(
    response,
    statusCode,
    data
) {
    const headers = {
        "Content-Type":
            "application/json; charset=utf-8",
        "Cache-Control":
            "no-store",
        "X-Content-Type-Options":
            "nosniff",
        "Referrer-Policy":
            "no-referrer",
        "Content-Security-Policy":
            "default-src 'none'; frame-ancestors 'none'"
    };

    if (response.keetaViewAllowedOrigin) {
        headers["Access-Control-Allow-Origin"] =
            response.keetaViewAllowedOrigin;
        headers.Vary = "Origin";
    }

    response.writeHead(
        statusCode,
        headers
    );

    response.end(
        JSON.stringify(data)
    );
}

function readJsonBody(request, maximumBytes = 4096) {
    return new Promise((resolve, reject) => {
        let body = "";

        request.setEncoding("utf8");
        request.on("data", (chunk) => {
            body += chunk;

            if (Buffer.byteLength(body) > maximumBytes) {
                reject(
                    new Error("Request body is too large.")
                );
                request.destroy();
            }
        });
        request.on("end", () => {
            try {
                resolve(JSON.parse(body || "{}"));
            } catch {
                reject(
                    new Error("Request body is not valid JSON.")
                );
            }
        });
        request.on("error", reject);
    });
}

function normalizeTrafficEvent(data) {
    const visitorId =
        String(data?.visitorId || "").toLowerCase();
    const eventType =
        data?.type === "heartbeat"
            ? "heartbeat"
            : "pageview";
    const pagePath =
        String(data?.path || "/")
            .split("?")[0]
            .slice(0, 120);
    const referrer =
        String(data?.referrer || "direct")
            .toLowerCase()
            .slice(0, 120);

    if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            visitorId
        )
    ) {
        throw new Error("Invalid anonymous visitor ID.");
    }

    if (!/^\/[A-Za-z0-9/_-]*$/.test(pagePath)) {
        throw new Error("Invalid page path.");
    }

    if (
        referrer !== "direct" &&
        !/^[a-z0-9.-]+$/.test(referrer)
    ) {
        throw new Error("Invalid referral source.");
    }

    return {
        visitorId,
        eventType,
        pagePath,
        referrer
    };
}

function isSameOriginTrafficRequest(request) {
    const origin = request.headers.origin;

    if (!origin) {
        return true;
    }

    try {
        return new URL(origin).host === request.headers.host;
    } catch {
        return false;
    }
}

function recordTrafficEvent(event) {
    const now = Date.now();
    const day =
        new Date(now)
            .toISOString()
            .slice(0, 10);

    trafficDatabase.prepare(`
        INSERT INTO traffic_active_sessions (
            visitor_id,
            last_seen,
            last_path
        ) VALUES (?, ?, ?)
        ON CONFLICT(visitor_id) DO UPDATE SET
            last_seen = excluded.last_seen,
            last_path = excluded.last_path
    `).run(
        event.visitorId,
        now,
        event.pagePath
    );

    if (event.eventType === "heartbeat") {
        return;
    }

    trafficDatabase.exec("BEGIN IMMEDIATE");

    try {
        trafficDatabase.prepare(`
            INSERT INTO traffic_visitors (
                visitor_id,
                first_seen,
                last_seen,
                total_pageviews,
                last_path
            ) VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(visitor_id) DO UPDATE SET
                last_seen = excluded.last_seen,
                total_pageviews = total_pageviews + 1,
                last_path = excluded.last_path
        `).run(
            event.visitorId,
            now,
            now,
            event.pagePath
        );

        trafficDatabase.prepare(`
            INSERT INTO traffic_daily_visitors (
                day,
                visitor_id,
                first_seen,
                last_seen,
                pageviews
            ) VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(day, visitor_id) DO UPDATE SET
                last_seen = excluded.last_seen,
                pageviews = pageviews + 1
        `).run(
            day,
            event.visitorId,
            now,
            now
        );

        trafficDatabase.prepare(`
            INSERT INTO traffic_daily_pages (
                day,
                path,
                pageviews
            ) VALUES (?, ?, 1)
            ON CONFLICT(day, path) DO UPDATE SET
                pageviews = pageviews + 1
        `).run(
            day,
            event.pagePath
        );

        trafficDatabase.prepare(`
            INSERT INTO traffic_daily_referrers (
                day,
                referrer,
                pageviews
            ) VALUES (?, ?, 1)
            ON CONFLICT(day, referrer) DO UPDATE SET
                pageviews = pageviews + 1
        `).run(
            day,
            event.referrer
        );

        trafficDatabase.exec("COMMIT");
    } catch (error) {
        trafficDatabase.exec("ROLLBACK");
        throw error;
    }
}

function getPublicTrafficSummary() {
    const now = Date.now();
    const activeCutoff = now - 2 * 60 * 1000;
    const day =
        new Date(now)
            .toISOString()
            .slice(0, 10);

    trafficDatabase.prepare(`
        DELETE FROM traffic_active_sessions
        WHERE last_seen < ?
    `).run(now - 24 * 60 * 60 * 1000);

    const active =
        trafficDatabase.prepare(`
            SELECT COUNT(*) AS total
            FROM traffic_active_sessions
            WHERE last_seen >= ?
        `).get(activeCutoff).total;
    const today =
        trafficDatabase.prepare(`
            SELECT
                COUNT(*) AS visitors,
                COALESCE(SUM(pageviews), 0) AS pageviews
            FROM traffic_daily_visitors
            WHERE day = ?
        `).get(day);

    return {
        activeNow: Number(active),
        visitorsToday: Number(today.visitors),
        pageviewsToday: Number(today.pageviews)
    };
}

function isValidAnalyticsKey(request) {
    const expectedKey =
        process.env.KEETAVIEW_ANALYTICS_KEY;
    const suppliedKey =
        String(
            request.headers.authorization || ""
        ).replace(/^Bearer\s+/i, "");

    if (!expectedKey || !suppliedKey) {
        return false;
    }

    const expected = Buffer.from(expectedKey);
    const supplied = Buffer.from(suppliedKey);

    return (
        expected.length === supplied.length &&
        crypto.timingSafeEqual(expected, supplied)
    );
}

function getPrivateTrafficSummary() {
    const publicSummary =
        getPublicTrafficSummary();
    const totals =
        trafficDatabase.prepare(`
            SELECT
                COUNT(*) AS visitors,
                COALESCE(SUM(total_pageviews), 0) AS pageviews
            FROM traffic_visitors
        `).get();
    const returningVisitors =
        trafficDatabase.prepare(`
            SELECT COUNT(*) AS total
            FROM (
                SELECT visitor_id
                FROM traffic_daily_visitors
                GROUP BY visitor_id
                HAVING COUNT(*) > 1
            )
        `).get().total;
    const daily =
        trafficDatabase.prepare(`
            SELECT
                day,
                COUNT(*) AS visitors,
                SUM(pageviews) AS pageviews
            FROM traffic_daily_visitors
            WHERE day >= date('now', '-29 days')
            GROUP BY day
            ORDER BY day
        `).all();
    const topPages =
        trafficDatabase.prepare(`
            SELECT
                path,
                SUM(pageviews) AS pageviews
            FROM traffic_daily_pages
            WHERE day >= date('now', '-29 days')
            GROUP BY path
            ORDER BY pageviews DESC
            LIMIT 20
        `).all();
    const referrers =
        trafficDatabase.prepare(`
            SELECT
                referrer,
                SUM(pageviews) AS pageviews
            FROM traffic_daily_referrers
            WHERE day >= date('now', '-29 days')
            GROUP BY referrer
            ORDER BY pageviews DESC
            LIMIT 20
        `).all();

    return {
        ...publicSummary,
        totals: {
            visitors: Number(totals.visitors),
            pageviews: Number(totals.pageviews),
            returningVisitors: Number(returningVisitors)
        },
        daily,
        topPages,
        referrers
    };
}

const staticContentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".webp": "image/webp"
};

async function sendStaticFile(
    pathname,
    response,
    {
        headOnly = false,
        ifNoneMatch = null
    } = {}
) {
    let requestedFile;

    try {
        requestedFile =
            pathname === "/"
                ? "index.html"
                : decodeURIComponent(
                    pathname.slice(1)
                );

        if (
            !path.extname(requestedFile) &&
            /^[A-Za-z0-9_-]+$/.test(requestedFile)
        ) {
            requestedFile += ".html";
        }
    } catch {
        return false;
    }

    if (
        !/^[A-Za-z0-9._-]+\.(?:html|js|css|svg|png|ico|webp)$/.test(
            requestedFile
        )
    ) {
        return false;
    }

    const filePath =
        path.join(
            projectRoot,
            requestedFile
        );

    try {
        const fileStats =
            await fs.promises.stat(
                filePath
            );

        if (!fileStats.isFile()) {
            return false;
        }

        const extension =
            path.extname(
                requestedFile
            ).toLowerCase();

        const etag =
            `W/"${fileStats.size.toString(16)}-${Math.trunc(fileStats.mtimeMs).toString(16)}"`;

        const headers = {
            "Content-Type":
                staticContentTypes[extension] ||
                "application/octet-stream",
            "Content-Length":
                fileStats.size,
            "Cache-Control":
                (
                    extension === ".html" ||
                    extension === ".js" ||
                    extension === ".css"
                )
                    ? "no-cache"
                    : "public, max-age=3600",
            ETag: etag,
            "Last-Modified":
                fileStats.mtime.toUTCString(),
            "X-Content-Type-Options":
                "nosniff",
            "Referrer-Policy":
                "strict-origin-when-cross-origin",
            "X-Frame-Options":
                "DENY",

            "Content-Security-Policy":
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.test.keeta.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        };

        const requestEtags =
            String(ifNoneMatch || "")
                .split(",")
                .map(value => value.trim());

        if (
            requestEtags.includes("*") ||
            requestEtags.includes(etag)
        ) {
            delete headers["Content-Length"];
            response.writeHead(
                304,
                headers
            );
            response.end();

            return true;
        }

        response.writeHead(
            200,
            headers
        );

        if (headOnly) {
            response.end();
        } else {
            const file =
                await fs.promises.readFile(
                    filePath
                );

            response.end(file);
        }

        return true;
    } catch (error) {
        if (error?.code === "ENOENT") {
            return false;
        }

        throw error;
    }
}

const server =
    http.createServer(
        async (request, response) => {
            const started = performance.now();
            const requestId = crypto.randomUUID();
            response.setHeader('X-Request-ID', requestId);
            // Only known route labels are logged: never query strings, credentials or addresses.
            let routeLabel = 'other';
            response.once('finish', () => {
                const durationMs = Math.round(performance.now() - started);
                if (durationMs >= 1000 || response.statusCode >= 500) {
                    console.warn(JSON.stringify({ event: 'api_request', requestId, route: routeLabel, status: response.statusCode, durationMs }));
                }
            });
            try {
            const requestOrigin =
                request.headers.origin;

            response.keetaViewAllowedOrigin =
                isAllowedLocalOrigin(
                    requestOrigin
                )
                    ? requestOrigin
                    : null;

            const url =
                new URL(
                    request.url,
                    "http://127.0.0.1"
                );

            routeLabel = diagnosticRoutes.has(url.pathname) ? url.pathname : (url.pathname.startsWith('/api/') ? '/api/other' : 'static');
            if (request.method === 'GET' && url.pathname === '/api/health') {
                sendJson(response, 200, { api: 'up', queries: { listing: operationQueries.diagnostics(), filtered: filteredOperationQueries.diagnostics() } });
                return;
            }

            // Telemetry uses its own database and market data uses an external
            // feed. Neither should reset the chain indexer's quiet period.
            if (url.pathname.startsWith("/api/v1/")) {
                if (request.method !== "GET") {
                    response.setHeader("Allow", "GET");
                    sendJson(response, 405, { error: "GET required." });
                    return;
                }
                try {
                    const usage = developerKeys.consume(request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : null);
                    if (usage.status !== 200) {
                        if (usage.retry) response.setHeader("Retry-After", String(usage.retry));
                        sendJson(response, usage.status, { error: usage.status === 401 ? "Valid bearer API key required." : "Beta request quota exceeded." });
                        return;
                    }
                    response.setHeader("X-RateLimit-Remaining-Day", String(usage.remainingToday));
                    response.setHeader("X-RateLimit-Remaining-Minute", String(usage.remainingMinute));
                    if (!["/api/v1/status", "/api/v1/usage", "/api/v1/block", "/api/v1/transfers"].includes(url.pathname)) {
                        sendJson(response, 404, { error: "Unknown developer endpoint." });
                        return;
                    }
                    if (url.pathname !== "/api/v1/usage") markApiActivity(url.pathname);
                    const result = developerResponse(url, database, readIndexerState(), usage);
                    sendJson(response, result.status || 200, result);
                } catch (error) {
                    console.error("Developer API request failed:", error.message);
                    sendJson(response, 503, { error: "Developer API temporarily unavailable." });
                }
                return;
            }
            if (
                url.pathname.startsWith("/api/") &&
                !url.pathname.startsWith("/api/traffic/") &&
                url.pathname !== "/api/market"
            ) {
                markApiActivity(url.pathname);
            }

            if (
                request.method === "POST" &&
                url.pathname === "/api/traffic/event"
            ) {
                if (!isSameOriginTrafficRequest(request)) {
                    sendJson(
                        response,
                        403,
                        { error: "Cross-origin traffic events are not accepted." }
                    );
                    return;
                }

                try {
                    const event =
                        normalizeTrafficEvent(
                            await readJsonBody(request)
                        );

                    recordTrafficEvent(event);
                    response.writeHead(
                        204,
                        {
                            "Cache-Control": "no-store",
                            "X-Content-Type-Options": "nosniff"
                        }
                    );
                    response.end();
                } catch (error) {
                    sendJson(
                        response,
                        400,
                        { error: error.message }
                    );
                }

                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/traffic/public"
            ) {
                try {
                    sendJson(
                        response,
                        200,
                        getPublicTrafficSummary()
                    );
                } catch (error) {
                    console.error(
                        "Unable to read public traffic totals:",
                        error
                    );
                    sendJson(
                        response,
                        503,
                        { error: "Traffic totals are temporarily unavailable." }
                    );
                }
                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/traffic/summary"
            ) {
                if (!isValidAnalyticsKey(request)) {
                    sendJson(
                        response,
                        401,
                        { error: "A valid analytics key is required." }
                    );
                    return;
                }

                try {
                    sendJson(
                        response,
                        200,
                        getPrivateTrafficSummary()
                    );
                } catch (error) {
                    console.error(
                        "Unable to read private traffic totals:",
                        error
                    );
                    sendJson(
                        response,
                        503,
                        { error: "Traffic totals are temporarily unavailable." }
                    );
                }
                return;
            }

            if (
                request.method === "GET" &&
                url.pathname.endsWith(".html")
            ) {
                const cleanPath =
                    url.pathname === "/index.html"
                        ? "/"
                        : url.pathname.slice(0, -5);

                response.writeHead(
                    308,
                    {
                        Location:
                            cleanPath +
                            url.search,
                        "Cache-Control": "no-store"
                    }
                );
                response.end();
                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/market"
            ) {
                const requestedRange =
                    url.searchParams.get(
                        "range"
                    ) || "1d";

                const rangeSettings = {
                    "1h": {
                        days: 1,
                        duration:
                            60 * 60 * 1000
                    },
                    "1d": {
                        days: 1,
                        duration:
                            24 * 60 * 60 * 1000
                    },
                    "1w": {
                        days: 7,
                        duration:
                            7 * 24 * 60 * 60 * 1000
                    },
                    "1m": {
                        days: 30,
                        duration:
                            30 * 24 * 60 * 60 * 1000
                    }
                };

                const range =
                    rangeSettings[
                        requestedRange
                    ]
                        ? requestedRange
                        : "1d";

                const settings =
                    rangeSettings[range];

                const supportedCurrencies = [
                    "usd",
                    "eur",
                    "gbp",
                    "cad",
                    "aud",
                    "jpy"
                ];

                const requestedCurrency =
                    url.searchParams.get(
                        "currency"
                    )?.toLowerCase() || "usd";

                const currency =
                    supportedCurrencies.includes(
                        requestedCurrency
                    )
                        ? requestedCurrency
                        : "usd";

                const cacheKey =
                    `${range}:${currency}`;

                const cached =
                    marketCache.get(cacheKey);

                if (
                    cached?.data &&
                    Date.now() <
                    cached.expiresAt
                ) {
                    sendJson(
                        response,
                        200,
                        cached.data
                    );

                    return;
                }

                try {
                    const [
                        coinResponse,
                        chartResponse
                    ] = await Promise.all([
                        fetch(
                            "https://api.coingecko.com/api/v3/coins/keeta?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false"
                        ),
                        fetch(
                            `https://api.coingecko.com/api/v3/coins/keeta/market_chart?vs_currency=${currency}&days=${settings.days}`
                        )
                    ]);

                    if (
                        !coinResponse.ok ||
                        !chartResponse.ok
                    ) {
                        throw new Error(
                            "CoinGecko did not return KTA market data."
                        );
                    }

                    const coin =
                        await coinResponse.json();

                    const chart =
                        await chartResponse.json();

                    const market =
                        coin.market_data || {};

                    const cutoff =
                        Date.now() -
                        settings.duration;

                    const prices =
                        Array.isArray(
                            chart.prices
                        )
                            ? chart.prices.filter(
                                (point) =>
                                    Number(
                                        point?.[0]
                                    ) >= cutoff
                            )
                            : [];

                    const volumes =
                        Array.isArray(
                            chart.total_volumes
                        )
                            ? chart.total_volumes.filter(
                                (point) =>
                                    Number(
                                        point?.[0]
                                    ) >= cutoff
                            )
                            : [];

                    const marketData = {
                        range,
                        currency,
                        price:
                            market.current_price?.[currency] ??
                            null,
                        priceChange24h:
                            market.price_change_percentage_24h ??
                            null,
                        marketCap:
                            market.market_cap?.[currency] ??
                            null,
                        volume24h:
                            market.total_volume?.[currency] ??
                            null,
                        circulatingSupply:
                            market.circulating_supply ??
                            null,
                        allTimeHigh:
                            market.ath?.[currency] ??
                            null,
                        prices,
                        volumes,
                        updatedAt:
                            coin.last_updated ||
                            new Date().toISOString(),
                        source:
                            "CoinGecko"
                    };

                    marketCache.set(
                        cacheKey,
                        {
                            data:
                                marketData,
                            expiresAt:
                                Date.now() +
                                marketCacheDuration
                        }
                    );

                    sendJson(
                        response,
                        200,
                        marketData
                    );
                } catch (error) {
                    console.error(
                        "Market data error:",
                        error
                    );

                    if (cached?.data) {
                        console.log(
                            "Serving cached KTA market data after CoinGecko failure."
                        );

                        sendJson(
                            response,
                            200,
                            {
                                ...cached.data,
                                stale: true
                            }
                        );

                        return;
                    }

                    sendJson(
                        response,
                        502,
                        {
                            error:
                                "KTA market data is temporarily unavailable."
                        }
                    );
                }

                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/blocks"
            ) {
                const requestedLimit =
                    Number(
                        url.searchParams.get(
                            "limit"
                        )
                    );

                const limit =
                    Number.isInteger(
                        requestedLimit
                    ) &&
                        requestedLimit > 0
                        ? Math.min(
                            requestedLimit,
                            100
                        )
                        : 10;

                const requestedOffset =
                    Number(
                        url.searchParams.get(
                            "offset"
                        )
                    );

                const offset =
                    Number.isInteger(
                        requestedOffset
                    ) &&
                        requestedOffset >= 0
                        ? requestedOffset
                        : 0;

                const blocks =
                    database.prepare(`
                        SELECT
                            hash,
                            timestamp,
                            operation_count
                        FROM blocks
                       ORDER BY timestamp DESC
                            LIMIT ?
                            OFFSET ?
                            `).all(
                        limit,
                        offset
                    );

                sendJson(
                    response,
                    200,
                    blocks
                );

                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/transaction"
            ) {
                const blockHash =
                    url.searchParams.get("block");

                const operationIndex =
                    Number(
                        url.searchParams.get(
                            "operation"
                        )
                    );

                if (
                    !blockHash ||
                    !Number.isInteger(operationIndex) ||
                    operationIndex < 0
                ) {
                    sendJson(
                        response,
                        400,
                        {
                            error:
                                "A block hash and operation index are required."
                        }
                    );

                    return;
                }

                const operation =
                    database.prepare(`
                        SELECT
                            block_hash,
                            operation_index,
                            operation_type,
                            sender,
                            recipient,
                            token,
                            amount,
                            timestamp,
                            details_json
                        FROM operations
                        WHERE block_hash = ?
                          AND operation_index = ?
                        LIMIT 1
                    `).get(
                        blockHash,
                        operationIndex
                    );

                if (!operation) {
                    sendJson(
                        response,
                        404,
                        {
                            error:
                                "Indexed transaction not found."
                        }
                    );

                    return;
                }

                let anchorInspection = {
                    payload: null,
                    status: null,
                    signer: null,
                    error: null
                };

                try {
                    const details = JSON.parse(
                        operation.details_json
                    );

                    anchorInspection = await inspectAnchorPayload(
                        details?.external
                    );
                } catch {
                    // Leave the empty inspection result in place.
                }

                const anchorInputs =
                    database.prepare(`
                        SELECT
                            anchor_block_hash,
                            anchor_operation_index,
                            input_index,
                            source_address,
                            anchor_transaction_id,
                            referenced_block_hash,
                            referenced_operation_index,
                            payload_version,
                            timestamp
                        FROM anchor_inputs
                        WHERE referenced_block_hash = ?
                          AND (
                              referenced_operation_index = ?
                              OR referenced_operation_index IS NULL
                          )
                        ORDER BY timestamp DESC,
                                 input_index ASC
                    `).all(
                        blockHash,
                        operationIndex
                    );

                const anchorReferences =
                    database.prepare(`
                        SELECT
                            input_index,
                            referenced_block_hash,
                            referenced_operation_index
                        FROM anchor_inputs
                        WHERE anchor_block_hash = ?
                          AND anchor_operation_index = ?
                        ORDER BY input_index ASC
                    `).all(
                        blockHash,
                        operationIndex
                    );


                sendJson(
                    response,
                    200,
                    {
                        ...accountNames.decorate([operation])[0],
                        anchor: anchorInspection.payload,
                        anchor_verification: {
                            status: anchorInspection.status,
                            signer: anchorInspection.signer,
                            error: anchorInspection.error,
                            encrypted: anchorInspection.encrypted
                        },
                        anchor_inputs:
                            anchorInputs,
                        anchor_references:
                            anchorReferences
                    }
                );

                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/operations"
            ) {
                // One deadline covers queue time, rows and all optional counts.
                const queryDeadline = Date.now() + 7000;
                const readOperations = (sql, parameters = [], mode = 'all') =>
                    (anchorsOnly || conditions.length ? filteredOperationQueries : operationQueries)
                        .query(sql, parameters, mode, queryDeadline);
                const requestedLimit =
                    Number(url.searchParams.get("limit"));

                const limit =
                    Number.isInteger(requestedLimit) &&
                        requestedLimit > 0
                        ? Math.min(requestedLimit, 100)
                        : 20;

                const requestedOffset =
                    Number(url.searchParams.get("offset"));

                const offset =
                    Number.isInteger(requestedOffset) &&
                        requestedOffset >= 0
                        ? requestedOffset
                        : 0;

                const address =
                    url.searchParams.get("address");

                const operationType =
                    url.searchParams.get("type");

                const searchQuery =
                    url.searchParams.get("q")?.trim() || "";

                const anchorsOnly =
                    url.searchParams.get("anchors") === "true";

                const requestedAnchorStatus =
                    url.searchParams.get("anchorStatus")?.toLowerCase();

                const anchorStatus =
                    ["verified", "unsigned", "invalid", "encrypted"]
                        .includes(requestedAnchorStatus)
                        ? requestedAnchorStatus
                        : null;

                const transfersOnly =
                    url.searchParams.get("transfers") === "true";

                const hideTinyKta = url.searchParams.get("hideTinyKta") === "true";
                const conditions = [];
                const parameters = [];
                if (hideTinyKta) {
                    // Decimal integer strings: compare by length, never cast to float.
                    // Preserve missing/malformed amounts and all non-KTA/non-SEND actions.
                    conditions.push(`NOT (
                        COALESCE(UPPER(operations.operation_type), '') = 'SEND'
                        AND COALESCE(operations.token, '') = ?
                        AND COALESCE(operations.amount, '') <> ''
                        AND operations.amount NOT GLOB '*[^0-9]*'
                        AND LENGTH(LTRIM(operations.amount, '0')) < 15
                    )`);
                    parameters.push('keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg');
                }

                if (address) {
                    conditions.push(
                        "(operations.sender = ? OR operations.recipient = ?)"
                    );
                    parameters.push(address, address);
                }

                if (operationType) {
                    conditions.push("operations.operation_type = ?");
                    parameters.push(operationType);
                }

                if (searchQuery) {
                    let search;
                    try {
                        search = transactionSearch(accountNames, searchQuery);
                    } catch (error) {
                        sendJson(response, 400, { error: error.message });
                        return;
                    }
                    if (search.empty) {
                        sendJson(response, 200, {
                            operations: [], total: 0,
                            name_lookup: accountNames.usernameStatus(searchQuery)
                        });
                        return;
                    }
                    conditions.push(search.sql);
                    parameters.push(...search.parameters);
                }

                const whereClause =
                    conditions.length > 0
                        ? `WHERE ${conditions.join(" AND ")}`
                        : "";

                const anchorJoin =
                    anchorsOnly
                        ? `
                            INNER JOIN (
                                SELECT DISTINCT
                                    block_hash AS anchor_block_hash,
                                    operation_index AS anchor_operation_index
                                FROM anchors
                                ${anchorStatus
                                    ? "WHERE signature_status = ?"
                                    : ""}
                            ) AS anchor_operations
                                ON anchor_operations.anchor_block_hash =
                                    operations.block_hash
                                AND anchor_operations.anchor_operation_index =
                                    operations.operation_index
                        `
                        : "";

                const anchorParameters =
                    anchorsOnly && anchorStatus
                        ? [anchorStatus]
                        : [];

                const operationSource = transfersOnly
                    ? `
                        FROM transfers AS indexed_transfers
                        INNER JOIN operations
                            ON operations.block_hash =
                                indexed_transfers.block_hash
                            AND operations.operation_index =
                                indexed_transfers.operation_index
                    `
                    : "FROM operations";

                const operationOrder = transfersOnly
                    ? `
                        indexed_transfers.timestamp DESC,
                        indexed_transfers.id DESC
                    `
                    : !anchorsOnly && conditions.length === 0
                        ? "operations.timestamp DESC"
                    : `
                        operations.timestamp DESC,
                        operations.block_hash DESC,
                        operations.operation_index ASC
                    `;

                const operations =
                    await readOperations(`
                        SELECT
                            operations.block_hash,
                            operations.operation_index,
                            operations.operation_type,
                            operations.sender,
                            operations.recipient,
                            operations.token,
                            operations.amount,
                            operations.timestamp,
                            operations.details_json,
                            anchors.signature_status AS anchor_signature_status
                        ${operationSource}
                        LEFT JOIN anchors
                            ON anchors.block_hash = operations.block_hash
                            AND anchors.operation_index = operations.operation_index
                        ${anchorJoin}
                        ${whereClause}
                        ORDER BY ${operationOrder}
                        LIMIT ?
                        OFFSET ?
                    `, [
                        ...anchorParameters,
                        ...parameters,
                        limit + 1,
                        offset
                    ]);

                const operationsWithAnchorStatus = accountNames.decorate(operations.slice(0, limit)).map(
                    (operation) => ({
                        ...operation,
                        is_anchor: Boolean(operation.anchor_signature_status)
                    })
                );

                let operationTotal;

                if (hideTinyKta) {
                    // Avoid counting millions of rows for this optional filter.
                    operationTotal = null;
                } else if (!anchorsOnly && conditions.length === 0) {
                    // Counts must not scan the chain DB on the HTTP request thread.
                    const snapshot = await statusSnapshots.get();
                    const count = transfersOnly ? snapshot?.data.transfers : snapshot?.data.operations;
                    operationTotal = Number.isFinite(count) ? count : null;

                } else {
                    operationTotal = (await readOperations(`
                        SELECT COUNT(*) AS total
                        ${operationSource}
                        ${anchorJoin}
                        ${whereClause}
                    `, [
                        ...anchorParameters,
                        ...parameters
                    ], 'get')).total;
                }

                const anchorCounts = anchorsOnly
                    ? await readOperations(`
                        SELECT
                            COUNT(*) AS total,
                            SUM(signature_status = 'verified') AS verified,
                            SUM(signature_status = 'unsigned') AS unsigned,
                            SUM(signature_status = 'invalid') AS invalid
                        FROM anchors
                    `, [], 'get')
                    : null;

                sendJson(
                    response,
                    200,
                    {
                        operations:
                            operationsWithAnchorStatus,
                        name_lookup: accountNames.usernameStatus(searchQuery),
                        total:
                            operationTotal === null ? null : Number(operationTotal || 0),
                        ...(operationTotal === null ? { hasMore: operations.length > limit } : {}),
                        ...(anchorCounts
                            ? {
                                anchorCounts: {
                                    total: Number(anchorCounts.total || 0),
                                    verified: Number(anchorCounts.verified || 0),
                                    unsigned: Number(anchorCounts.unsigned || 0),
                                    invalid: Number(anchorCounts.invalid || 0)
                                }
                            }
                            : {})
                    }
                );

                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/transfers"
            ) {
                const requestedLimit =
                    Number(
                        url.searchParams.get(
                            "limit"
                        )
                    );

                const limit =
                    Number.isInteger(
                        requestedLimit
                    ) &&
                        requestedLimit > 0
                        ? Math.min(
                            requestedLimit,
                            100
                        )
                        : 10;

                const address =
                    url.searchParams.get(
                        "address"
                    );

                const token =
                    url.searchParams.get(
                        "token"
                    );

                const transfers =
                    token
                        ? database.prepare(`
            SELECT
                block_hash,
                operation_index,
                sender,
                recipient,
                token,
                amount,
                timestamp
            FROM transfers INDEXED BY transfers_by_token
            WHERE token = ?
            ORDER BY id DESC
            LIMIT ?
        `).all(
                            token,
                            limit
                        )
                        : address
                            ? database.prepare(`
                SELECT
                    block_hash,
                    operation_index,
                    sender,
                    recipient,
                    token,
                    amount,
                    timestamp
                FROM transfers
                WHERE sender = ?
                   OR recipient = ?
                ORDER BY timestamp DESC
                LIMIT ?
            `).all(
                                address,
                                address,
                                limit
                            )
                            : database.prepare(`
                SELECT
                    block_hash,
                    operation_index,
                    sender,
                    recipient,
                    token,
                    amount,
                    timestamp
                FROM transfers
                ORDER BY timestamp DESC
                LIMIT ?
            `).all(limit);

                sendJson(
                    response,
                    200,
                    accountNames.decorate(transfers)
                );

                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/assets"
            ) {
                const includeAll =
                    url.searchParams.get("all") === "true";

                const requestedLimit =
                    Number(
                        url.searchParams.get(
                            "limit"
                        )
                    );

                const limit =
                    Number.isInteger(
                        requestedLimit
                    ) &&
                        requestedLimit > 0
                        ? Math.min(
                            requestedLimit,
                            1000
                        )
                        : 1000;

                const assetQuery = `
            SELECT token AS address
            FROM assets
            ORDER BY token
            ${includeAll ? "" : "LIMIT ?"}
        `;

                const assets = includeAll
                    ? database.prepare(
                        assetQuery
                    ).all()
                    : database.prepare(
                        assetQuery
                    ).all(limit);

                sendJson(
                    response,
                    200,
                    assets
                );

                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/anchors/search"
            ) {
                const query = String(
                    url.searchParams.get("query") || ""
                ).trim();

                if (!query) {
                    sendJson(response, 400, {
                        error: "An Anchor ID or Anchor Transaction ID is required."
                    });
                    return;
                }

                const anchor = database.prepare(`
                    SELECT
                        block_hash,
                        operation_index,
                        source_address,
                        anchor_transaction_id
                    FROM anchors
                    WHERE source_address = ?
                       OR anchor_transaction_id = ?
                    ORDER BY
                        CASE WHEN anchor_transaction_id = ? THEN 0 ELSE 1 END,
                        timestamp DESC
                    LIMIT 1
                `).get(query, query, query);

                if (!anchor) {
                    sendJson(response, 404, {
                        error: "No indexed Anchor matches that ID."
                    });
                    return;
                }

                sendJson(response, 200, {
                    ...anchor,
                    match_type:
                        anchor.anchor_transaction_id === query
                            ? "transaction"
                            : "account"
                });
                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/anchors"
            ) {
                const address = url.searchParams.get("address");
                const requestedLimit = Number(url.searchParams.get("limit"));
                const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
                    ? Math.min(requestedLimit, 100)
                    : 20;

                if (!address) {
                    sendJson(response, 400, {
                        error: "An Anchor source address is required."
                    });
                    return;
                }

                const anchors = database.prepare(`
                    SELECT
                        anchors.block_hash,
                        anchors.operation_index,
                        anchors.anchor_transaction_id,
                        anchors.payload_version,
                        anchors.signature_status,
                        anchors.signer_address,
                        anchors.signature_error,
                        anchors.timestamp,
                        COUNT(anchor_inputs.input_index) AS relationships
                    FROM anchors
                    LEFT JOIN anchor_inputs
                        ON anchor_inputs.anchor_block_hash = anchors.block_hash
                        AND anchor_inputs.anchor_operation_index = anchors.operation_index
                    WHERE anchors.source_address = ?
                    GROUP BY anchors.block_hash, anchors.operation_index
                    ORDER BY anchors.timestamp DESC
                    LIMIT ?
                `).all(address, limit);

                sendJson(response, 200, anchors);
                return;
            }

            if (request.method === "GET" && url.pathname === "/api/account-label") {
                const address = url.searchParams.get("address");
                if (!address || address.length > 256) {
                    sendJson(response, 400, { error: "An address is required." });
                    return;
                }
                const cached = accountNames.decorate([{ sender: address }])[0];
                sendJson(response, 200, { address, name: cached.sender_name,
                    username: cached.sender_username });
                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/accounts"
            ) {
                const requestedLimit =
                    Number(
                        url.searchParams.get(
                            "limit"
                        )
                    );

                const limit =
                    Number.isInteger(
                        requestedLimit
                    ) &&
                        requestedLimit > 0
                        ? Math.min(
                            requestedLimit,
                            100
                        )
                        : 10;

                const requestedOffset =
                    Number(
                        url.searchParams.get(
                            "offset"
                        )
                    );

                const offset =
                    Number.isInteger(
                        requestedOffset
                    ) &&
                        requestedOffset >= 0
                        ? requestedOffset
                        : 0;

                const accounts =
                    database.prepare(`
            SELECT
                address,
                first_seen_timestamp
            FROM accounts
            ORDER BY first_seen_timestamp DESC
            LIMIT ?
            OFFSET ?
        `).all(
                        limit,
                        offset
                    );

                sendJson(
                    response,
                    200,
                    accounts
                );

                return;
            }
            if (
                request.method === "GET" &&
                url.pathname === "/api/analytics"
            ) {
                const snapshot = await analyticsSnapshots.get();
                if (!snapshot) {
                    response.setHeader("Retry-After", "10");
                    sendJson(response, 503, {
                        error: "Network analytics are being prepared. Please retry shortly."
                    });
                    return;
                }
                sendJson(response, 200, {
                    ...snapshot.data,
                    cache: {
                        generatedAt: new Date(snapshot.createdAt).toISOString(),
                        refreshing: analyticsSnapshots.refreshing
                    }
                });
                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/status"
            ) {
                const snapshot = await statusSnapshots.get();
                if (!snapshot) {
                    response.setHeader('Retry-After', '5');
                    sendJson(response, 503, { error: 'Index status is preparing. Please retry shortly.' });
                    return;
                }
                sendJson(response, 200, {
                    ...snapshot.data,
                    cache: {
                        generatedAt: new Date(snapshot.createdAt).toISOString(),
                        refreshing: statusSnapshots.refreshing
                    }
                });

                return;
            }

            if (
                (
                    request.method === "GET" ||
                    request.method === "HEAD"
                ) &&
                await sendStaticFile(
                    url.pathname,
                    response,
                    {
                        headOnly:
                            request.method === "HEAD",
                        ifNoneMatch:
                            request.headers[
                                "if-none-match"
                            ]
                    }
                )
            ) {
                return;
            }

            sendJson(
                response,
                404,
                {
                    error:
                        "Route not found"
                }
            );
            } catch (error) {
                console.error(JSON.stringify({ event: 'api_request_failed', requestId, route: routeLabel, errorName: error?.name || 'Error' }));
                if (!response.headersSent && !response.destroyed) {
                    response.setHeader('Retry-After', '2');
                    sendJson(response, 503, { error: 'Request temporarily unavailable.', requestId });
                } else if (!response.destroyed) response.destroy();
            }
        }
    );

server.listen(
    port,
    host,
    () => {
        console.log(
            `KeetaView running at http://${host}:${port}`
        );
    }
);

let shuttingDown = false;

function shutdown(signal) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log(
        `Closing KeetaView API after ${signal}...`
    );

    void operationQueries.close();
    void filteredOperationQueries.close();
    server.close(() => {
        try {
            trafficDatabase.close();
            database.close();
        } catch (error) {
            console.error(
                "Unable to close a KeetaView database cleanly:",
                error
            );
        }

        process.exit(0);
    });

    setTimeout(
        () => process.exit(1),
        4000
    ).unref();
}

process.once(
    "SIGINT",
    () => shutdown("SIGINT")
);

process.once(
    "SIGTERM",
    () => shutdown("SIGTERM")
);
