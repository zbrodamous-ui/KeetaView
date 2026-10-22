# Network analytics snapshots

`GET /api/analytics` serves a completed snapshot. Heavy SQL runs in one worker thread with its own read-only SQLite connection, rather than inside the HTTP request handler. It uses the existing analytics queries and preserves raw integer amounts.

On a cold start without a saved snapshot, the endpoint starts calculation and immediately returns 503 with `Retry-After: 10`. The page preserves its layout and offers a manual retry. No automatic polling is added.

Completed results are cached in memory and atomically saved as `network-analytics-cache.json` inside `KEETAVIEW_DATA_DIR` (or `./indexer`). A restart can serve that last good snapshot. After ten minutes, a request triggers a background refresh while continuing to return the previous snapshot. Only one refresh runs at a time. Failed refreshes retain previous data and back off for one minute.

The response adds `cache.generatedAt` and `cache.refreshing`; the page displays the calculation timestamp. The summary's latest timestamp belongs to the snapshot, rather than mixing a newer block timestamp with older totals. Historical coverage limitations still apply.

Worker threads share the container's CPU, memory and storage. This prevents analytics SQL from directly blocking the HTTP event loop, but does not guarantee latency under disk contention or solve unrelated synchronous routes. Query costs are unchanged; production calculation duration and memory should be observed after deployment. The initial snapshot may take longer than ten seconds; Retry-After is a retry interval, not a completion promise.

Validation: `node --test indexer/analytics-cache.test.mjs`. Tests cover cold responses during worker activity, cache reuse across restarts, failure/backoff, and real read-only query results with amounts above JavaScript Number precision.
