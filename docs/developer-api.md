# KeetaView developer API beta

Independent, free, invitation-only beta. No payment plan or uptime guarantee yet. Existing explorer endpoints remain public; beta quotas apply only to `/api/v1/` and do not restrict those legacy routes. This beta must not be advertised as paid exclusive access.

Public getting-started page: [keetaview.com/developers.html](https://keetaview.com/developers.html). Beta access requests open a public GitHub issue; never include keys or private information. Operators must deliver keys privately.

## Operator setup

After deploying, run commands inside the running service with the same persistent `KEETAVIEW_DATA_DIR` as the API:

```
node indexer/api-keys.js create "tester name"
node indexer/api-keys.js list
node indexer/api-keys.js revoke <id>
```

Create outputs an ID and secret once. Deliver the secret privately; never post it in Discord, URLs, screenshots, frontend code or source control. Lost keys must be replaced. The persistent `developer-api.db` stores SHA-256 hashes, labels and quota counters; retain it across deployments. No self-service signup or account portal in this version.

## Requests

Use server-side requests over HTTPS with `Authorization: Bearer <key>`. Browser cross-origin access is not enabled for this beta. Example (set KEETAVIEW_API_KEY privately in your environment):

```bash
curl --header "Authorization: Bearer $KEETAVIEW_API_KEY" https://keetaview.com/api/v1/status
```

| Endpoint | Parameters | Response |
|---|---|---|
| GET /api/v1/status | none | Mainnet, latest indexed timestamp, historical completeness |
| GET /api/v1/block | hash: full 64-character hex hash | Indexed hash, timestamp, operation count |
| GET /api/v1/transfers | token: full token address; limit: 1–100 (default 20); before: optional cursor | Transfer rows and nextBefore |
| GET /api/v1/usage | none | Requests today and remaining quotas, including this request |

Responses wrap results in `data`. Transfer responses also include `nextBefore`, `amountUnit`, `order` and `coverageNote`. Use `nextBefore` as `before` on the next page; stop when null. Records are ordered by insertion ID, not necessarily timestamp. Backfill may insert older history with newer IDs; pagination is not a historical time-range export or a frozen snapshot. IDs are index-local, not blockchain identifiers. Identify an operation by its block hash plus operation index.

Amounts are decimal **strings of raw integer units**. Use token decimals and integer/decimal arithmetic to format them; do not parse large amounts as JavaScript Number. Zero displayed at fixed precision can be nonzero in raw units. No live per-row username or metadata lookup is performed.

## Limits and errors

Each valid key allows 30 requests per fixed UTC minute and 1,000 per UTC day. Valid authenticated requests count, including usage checks and requests returning 400 or 404. Rejected quota requests do not count. Remaining quotas appear in `X-RateLimit-Remaining-Day` and `X-RateLimit-Remaining-Minute`; 429 includes `Retry-After` seconds. Retry after that period rather than continuously polling.

401: absent, invalid or revoked key. 400: invalid parameter. 404: unknown endpoint or block absent from this index. 405: GET required. 429: quota exceeded. 503: temporary service failure.

## Coverage

Only locally indexed data is returned. Missing records do not prove an operation never happened. Historical coverage is incomplete while `historicalComplete` is false; this flag reflects the worker state, not an independent completeness audit. `latestIndexedTimestamp` shows the newest stored block activity, not a guarantee of continuous coverage. Beta chain reads retain the explorer's backfill idle safeguard. These responses do not establish trades, buys, sells or people's identities.

Before public paid launch: test with invited developers, assess capacity and query costs, verify coverage, decide plans and support, and add billing/account management. Public sample requests must use placeholder keys.
