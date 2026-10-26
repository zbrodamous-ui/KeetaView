# Intermittent site loading

## Performance changes

GET /api/status now builds aggregate statistics in a read-only worker instead of scanning blocks on the HTTP request thread. One refresh at a time returns the last valid persisted snapshot immediately; refresh is triggered when at least 30 seconds old. A failed refresh preserves the snapshot and backs off 10 seconds. Startup warms the cache. Cold requests without a snapshot return 503 with Retry-After: 5 (retry guidance, not a completion promise). Existing fields are preserved, with cache.generatedAt and cache.refreshing added. Check generatedAt before treating figures as current. State-file totals remain approximate.

Homepage transfers render indexed values immediately, labelled as raw units until optional external token metadata arrives. Repeated tokens share one in-flight lookup. Failed or stalled metadata no longer prevents the transfer panel rendering. No decimals are guessed for the raw fallback.

GET /api/health reports API process responsiveness without database work. It does not establish database readiness, index freshness or full site health. Other routes still use synchronous SQL; workers share CPU and disk. This removes specific blocking paths, not every possible cause of slow loading.

Every response includes X-Request-ID. Requests taking at least one second or returning 5xx log api_request with the ID, known route label, status and duration. Exceptions log api_request_failed and return generic 503 without terminating the API. Event-loop maximum delays of at least one second log api_event_loop_delay in ten-second samples. Logs exclude queries, addresses, credentials and client IPs. A stalled loop reports only after resuming.

## Compare network paths after deployment

From local PowerShell, run:

```powershell
node indexer/check-site.mjs
```

Inside Railway SSH, compare:

```bash
node indexer/check-site.mjs http://127.0.0.1:8080
```

Adjust 8080 to configured PORT if needed. The seven sequential requests each time out after eight seconds; there are no automatic retries or writes. Correlate checkedAt and request IDs with hosting logs.

Fast local but slow public requests suggest investigating ingress, DNS, region or client network. Slow local health plus event-loop delay suggests another blocking route or resource pressure. Fast health with status 503 suggests a cold or failed status snapshot. Fast probes with a browser spinner require checking browser Network/Console, including external SDK loading; this probe cannot reproduce all browser dependencies.

Check host CPU, RAM and disk alongside slow route logs before selecting further query optimizations. Static files still share the API service. Separating static hosting is a later infrastructure change requiring a routing and caching plan. Nothing here deletes, archives or rewrites indexed chain records. Only status snapshot cache files are generated. No production cleanup runs at deployment.

## Directory pages

The unfiltered operations listing reuses the persisted status count instead of summing the blocks table per request. If no count is ready, rows still return with total:null and hasMore based on a single extra row. Known totals are cached figures, not a new exact count at request time. Explicitly filtered/name/anchor queries retain their existing count semantics and can still be expensive.

Blocks renders independently of the optional status total. If the total is unavailable, it shows a page number and permits next-page navigation when the current page is full; an exactly full final page may lead to one empty page. Transactions renders raw indexed amounts immediately and enriches metadata later; late metadata from an older page cannot overwrite a newer page. No indexed records are changed. The probe now includes the default operations endpoint used by Transactions.

## Bounded operations query isolation

/api/operations runs row lookups, filtered counts and Anchor counts in read-only subprocesses. Name resolution stays local before SQL is sent over IPC, never process arguments. Default listings have one reserved process slot; filtered/Anchor queries have a separate slot. Each lane allows at most four waiting jobs. A slow filtered query therefore cannot occupy the default listing's slot. Workers still share CPU and disk.

A shared seven-second request deadline covers queue time and all SQL for that request. Overload/failure returns generic 503 and Retry-After: 2. At expiry the child receives SIGKILL, allowing the OS to interrupt native SQLite work; its slot is held until process close confirms exit. This replaces thread termination, which could remain pending during native SQL. Shutdown rejects queued work and kills active children. Each child is read-only, query_only enabled, and has a one-second SQLite busy timeout. Existing exact filtered-count behavior is preserved; no records, schema or indexes are changed.

/api/health adds queries.listing and queries.filtered with running/pending/oldestMs. These are aggregate queue diagnostics without SQL or search terms. query_pool_timeout logs whether work timed out running or queued. Process isolation adds startup overhead per SQL statement; normal query latency must be checked after deployment. This is a recovery and isolation safeguard, not a replacement for optimizing expensive searches. Disconnected clients are not yet an additional cancellation signal; other endpoints retain synchronous SQL.
