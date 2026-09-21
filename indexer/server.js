import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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

const marketCache = new Map();

const marketCacheDuration = 60 * 1000;

let analyticsCache = null;

let analyticsCacheRefreshPromise = null;

const analyticsCacheRefreshToken =
    crypto.randomUUID();

const analyticsCacheDuration =
    10 * 60 * 1000;

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
    response
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
        const file =
            await fs.promises.readFile(
                filePath
            );
        const extension =
            path.extname(
                requestedFile
            ).toLowerCase();

        response.writeHead(
            200,
            {
                "Content-Type":
                    staticContentTypes[extension] ||
                    "application/octet-stream",
                "Cache-Control":
                    (
                        extension === ".html" ||
                        extension === ".js" ||
                        extension === ".css"
                    )
                        ? "no-cache"
                        : "public, max-age=3600",
                "X-Content-Type-Options":
                    "nosniff",
                "Referrer-Policy":
                    "strict-origin-when-cross-origin",
                "X-Frame-Options":
                    "DENY",

                "Content-Security-Policy":
                    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.test.keeta.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
            }
        );
        response.end(file);

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
                        ...operation,
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

                const anchorsOnly =
                    url.searchParams.get("anchors") === "true";

                const conditions = [];
                const parameters = [];

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
                            ) AS anchor_operations
                                ON anchor_operations.anchor_block_hash =
                                    operations.block_hash
                                AND anchor_operations.anchor_operation_index =
                                    operations.operation_index
                        `
                        : "";

                const operations =
                    database.prepare(`
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
                        FROM operations
                        LEFT JOIN anchors
                            ON anchors.block_hash = operations.block_hash
                            AND anchors.operation_index = operations.operation_index
                        ${anchorJoin}
                        ${whereClause}
                        ORDER BY operations.timestamp DESC,
                                 operations.block_hash DESC,
                                 operations.operation_index ASC
                        LIMIT ?
                        OFFSET ?
                    `).all(
                        ...parameters,
                        limit,
                        offset
                    );

                const operationsWithAnchorStatus = operations.map(
                    (operation) => ({
                        ...operation,
                        is_anchor: Boolean(operation.anchor_signature_status)
                    })
                );

                if (anchorsOnly) {
                    const anchorTotal =
                        database.prepare(`
                            SELECT COUNT(*) AS total
                            FROM operations
                            ${anchorJoin}
                            ${whereClause}
                        `).get(...parameters).total;

                    sendJson(
                        response,
                        200,
                        {
                            operations:
                                operationsWithAnchorStatus,
                            total:
                                Number(anchorTotal || 0)
                        }
                    );

                    return;
                }

                sendJson(
                    response,
                    200,
                    operationsWithAnchorStatus
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
            FROM transfers
            WHERE token = ?
            ORDER BY timestamp DESC
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
                    transfers
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
            SELECT DISTINCT
                token AS address
            FROM transfers
            WHERE token IS NOT NULL
              AND token <> ''
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
                const analyticsRefreshIsInternal =
                    request.headers[
                    "x-keetaview-analytics-refresh"
                    ] === analyticsCacheRefreshToken;

                const analyticsCacheIsFresh =
                    analyticsCache &&
                    Date.now() -
                    analyticsCache.createdAt <
                    analyticsCacheDuration;

                if (
                    analyticsCache &&
                    !analyticsRefreshIsInternal
                ) {
                    sendJson(
                        response,
                        200,
                        analyticsCache.data
                    );

                    if (
                        !analyticsCacheIsFresh &&
                        !analyticsCacheRefreshPromise
                    ) {
                        analyticsCacheRefreshPromise =
                            fetch(
                                `http://127.0.0.1:${port}/api/analytics`,
                                {
                                    headers: {
                                        "x-keetaview-analytics-refresh":
                                            analyticsCacheRefreshToken
                                    }
                                }
                            )
                                .catch((error) => {
                                    console.error(
                                        "Analytics cache refresh failed:",
                                        error
                                    );
                                })
                                .finally(() => {
                                    analyticsCacheRefreshPromise =
                                        null;
                                });
                    }

                    return;
                }
                const blockSummary =
                    database.prepare(`
                        SELECT
                            COUNT(*) AS blocks,
                            COALESCE(
                                SUM(operation_count),
                                0
                            ) AS operations,
                            COALESCE(
                                AVG(operation_count),
                                0
                            ) AS average_operations,
                            MIN(timestamp) AS first_timestamp,
                            MAX(timestamp) AS latest_timestamp
                        FROM blocks
                    `).get();

                const accountTotal =
                    database.prepare(`
                        SELECT COUNT(*) AS total
                        FROM accounts
                    `).get().total;

                const transferTotal =
                    database.prepare(`
                        SELECT COUNT(*) AS total
                        FROM transfers
                    `).get().total;

                const operationTotal =
                    database.prepare(`
                        SELECT COUNT(*) AS total
                        FROM operations
                    `).get().total;

                const topSenders =
                    database.prepare(`
                        SELECT
                            sender AS address,
                            COUNT(*) AS total
                        FROM transfers
                            INDEXED BY transfers_by_timestamp
                        WHERE sender IS NOT NULL
                            AND timestamp >= (
                                SELECT datetime(
                                    MAX(timestamp),
                                    '-24 hours'
                                )
                                FROM transfers
                            )
                        GROUP BY sender
                        ORDER BY total DESC
                        LIMIT 100
                    `).all();

                const topRecipients =
                    database.prepare(`
                        SELECT
                            recipient AS address,
                            COUNT(*) AS total
                        FROM transfers
                            INDEXED BY transfers_by_timestamp
                        WHERE recipient IS NOT NULL
                            AND timestamp >= (
                                SELECT datetime(
                                    MAX(timestamp),
                                    '-24 hours'
                                )
                                FROM transfers
                            )
                        GROUP BY recipient
                        ORDER BY total DESC
                        LIMIT 100
                    `).all();

                const tokenActivity =
                    database.prepare(`
                        SELECT
                            token,
                            COUNT(*) AS transfers
                        FROM transfers
                            INDEXED BY transfers_by_timestamp
                        WHERE token IS NOT NULL
                            AND timestamp >= (
                                SELECT datetime(
                                    MAX(timestamp),
                                    '-24 hours'
                                )
                                FROM transfers
                            )
                        GROUP BY token
                        ORDER BY transfers DESC
                        LIMIT 100
                    `).all();

                const activityNewestFirst =
                    database.prepare(`
                        SELECT
                            substr(timestamp, 1, 10) AS day,
                            COUNT(*) AS transfers
                        FROM transfers
                        WHERE timestamp >= (
                            SELECT date(
                                MAX(timestamp),
                                '-13 days'
                            )
                            FROM transfers
                        )
                        GROUP BY day
                        ORDER BY day DESC
                        LIMIT 14
                    `).all();

                const recentTransfers =
                    database.prepare(`
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
                        LIMIT 100
                    `).all();

                const anchorSummary =
                    database.prepare(`
                        SELECT
                            COUNT(*) AS total,
                            COUNT(DISTINCT source_address) AS accounts,
                            MAX(timestamp) AS latest_timestamp,
                            SUM(signature_status = 'verified') AS verified,
                            SUM(signature_status = 'unsigned') AS unsigned,
                            SUM(signature_status = 'invalid') AS invalid,
                            (SELECT COUNT(*) FROM anchor_inputs) AS relationships
                        FROM anchors
                    `).get();

                const anchorActivityNewestFirst =
                    database.prepare(`
                        SELECT
                            day,
                            COUNT(*) AS anchors
                        FROM (
                            SELECT
                                substr(
                                    timestamp,
                                    1,
                                    10
                                ) AS day,
                                block_hash,
                                operation_index
                            FROM anchors
                            WHERE timestamp >= (
                                SELECT date(
                                    MAX(timestamp),
                                    '-13 days'
                                )
                                FROM anchors
                            )
                            GROUP BY
                                day,
                                block_hash,
                                operation_index
                        )
                        GROUP BY day
                        ORDER BY day DESC
                        LIMIT 14
                    `).all();

                const recentAnchors =
                    database.prepare(`
                        SELECT
                            anchors.block_hash,
                            anchors.operation_index,
                            anchors.source_address,
                            anchors.signature_status,
                            COUNT(anchor_inputs.input_index) AS relationships,
                            anchors.timestamp
                        FROM anchors
                        LEFT JOIN anchor_inputs
                            ON anchor_inputs.anchor_block_hash = anchors.block_hash
                            AND anchor_inputs.anchor_operation_index = anchors.operation_index
                        GROUP BY anchors.block_hash, anchors.operation_index
                        ORDER BY anchors.timestamp DESC
                        LIMIT 20
                    `).all();

                const analyticsData = {
                    summary: {
                        blocks:
                            blockSummary.blocks,
                        operations:
                            operationTotal,
                        transfers:
                            transferTotal,
                        accounts:
                            accountTotal,
                        averageOperations:
                            Number(
                                blockSummary
                                    .average_operations
                            ),
                        firstTimestamp:
                            blockSummary
                                .first_timestamp,
                        latestTimestamp:
                            blockSummary
                                .latest_timestamp
                    },
                    activity:
                        activityNewestFirst
                            .reverse(),
                    topSenders,
                    topRecipients,
                    tokenActivity,
                    recentTransfers,
                    anchors: {
                        summary: {
                            total:
                                Number(
                                    anchorSummary.total || 0
                                ),
                            relationships:
                                Number(
                                    anchorSummary.relationships || 0
                                ),
                            accounts:
                                Number(
                                    anchorSummary.accounts || 0
                                ),
                            latestTimestamp:
                                anchorSummary.latest_timestamp,
                            verified: Number(anchorSummary.verified || 0),
                            unsigned: Number(anchorSummary.unsigned || 0),
                            invalid: Number(anchorSummary.invalid || 0)
                        },
                        activity:
                            anchorActivityNewestFirst
                                .reverse(),
                        recent:
                            recentAnchors
                    }
                };

                analyticsCache = {
                    createdAt: Date.now(),
                    data: analyticsData
                };

                sendJson(
                    response,
                    200,
                    analyticsData
                );

                return;
            }

            if (
                request.method === "GET" &&
                url.pathname === "/api/status"
            ) {
                const blockSummary =
                    database.prepare(`
                        SELECT
                            COUNT(*) AS total,
                            COALESCE(
                                AVG(operation_count),
                                0
                            ) AS average_operations,
                            MIN(timestamp) AS first_timestamp,
                            MAX(timestamp) AS latest_timestamp
                        FROM blocks
                    `).get();

                const accounts =
                    database.prepare(`
                        SELECT COUNT(*) AS total
                        FROM accounts
                    `).get().total;

                const transfers =
                    database.prepare(`
                        SELECT COUNT(*) AS total
                        FROM transfers
                    `).get().total;

                const operations =
                    database.prepare(`
                        SELECT COUNT(*) AS total
                        FROM operations
                    `).get().total;

                sendJson(
                    response,
                    200,
                    {
                        blocks:
                            blockSummary.total,
                        accounts,
                        transfers,
                        operations,
                        averageOperations:
                            Number(
                                blockSummary
                                    .average_operations
                            ),
                        firstTimestamp:
                            blockSummary
                                .first_timestamp,
                        latestTimestamp:
                            blockSummary
                                .latest_timestamp
                    }
                );

                return;
            }

            if (
                request.method === "GET" &&
                await sendStaticFile(
                    url.pathname,
                    response
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
