# KeetaView

KeetaView is a fast, local-first explorer for browsing indexed activity on the Keeta Network. It includes block, transaction, address, asset, analytics, and service-status views.

## Features

- Search by transaction, address, block, or asset
- Browse indexed blocks, transfers, accounts, and known assets
- Inspect block, transaction, address, and asset details
- View scrollable analytics lists with up to 100 indexed results
- Live KTA market chart and selectable display currencies
- Light and dark themes
- Twelve interface languages, including right-to-left Arabic
- Responsive layouts for desktop and mobile
- Local SQLite index with automatic live updates
- Offline and API recovery notices
- Keyboard and reduced-motion accessibility support

## Requirements

- Node.js 24 or newer
- npm
- A modern browser
- VS Code Live Server or another local static web server

## Install

```powershell
git clone https://github.com/zbrodamous-ui/KeetaView.git
cd KeetaView
npm install
```

## Run

Start the KeetaView API and indexer:

```powershell
npm start
```

Keep that terminal open. Then open `index.html` with Live Server. The browser site and the API must both be running for indexed data to appear.

The API is available only on the local computer at:

```text
http://127.0.0.1:3000
```

## Railway deployment

KeetaView requires a persistent, long-running Node.js service and cannot run on ordinary serverless hosting.

Create a Railway service from this GitHub repository with:

- Start command: `npm start`
- Health path: `/api/status`
- Persistent volume mounted at `/data`

Set these environment variables:

```text
KEETAVIEW_DATA_DIR=/data
HISTORICAL_BACKFILL=false
HISTORICAL_BACKFILL_INTERVAL_MINUTES=10
```

Railway supplies `PORT` and `RAILWAY_ENVIRONMENT` automatically. KeetaView uses them to listen publicly on the assigned port.

The persistent volume stores `keetascan.db`, its SQLite WAL files, the indexing state, and the database reset marker. Use a volume comfortably larger than the current database and maintain external backups.

A new empty volume starts with recent network history. To index older history, temporarily set `HISTORICAL_BACKFILL=true` during a controlled maintenance window. Backfilling can reduce API responsiveness on smaller deployments. Do not commit or deploy the local SQLite database through Git.

## Other commands

Run a single indexing pass:

```powershell
npm run indexer
```

Run the indexer in watch mode:

```powershell
npm run indexer:watch
```

Run only the local API:

```powershell
npm run server
```

Do not run these separate services at the same time as `npm start`, because multiple processes can compete for the same SQLite database.

## Local data and privacy

KeetaView stores its blockchain index in `indexer/keetascan.db`. The database and `node_modules` are excluded from Git.

Interface preferences and the local asset cache are saved in the browser. KeetaView does not ask for wallet seed phrases, private keys, passwords, or personal account information.

The Status and Analytics totals describe the local KeetaView index and are not guaranteed to represent the entire network.

## Troubleshooting

### The page says the local API is unavailable

1. Return to the project terminal.
2. Run `npm start`.
3. Wait until the API and live indexer report that they are running.
4. Return to the browser and use Retry, or refresh the page.

### The database is locked

Stop duplicate KeetaView API or indexer terminals with `Ctrl+C`. Then run only:

```powershell
npm start
```

### Market data is unavailable

The CoinGecko feed may be temporarily unavailable or rate-limited. KeetaView retries automatically; indexed blockchain data can continue working independently.

## Launch checklist

Before publishing a release:

- Confirm every navigation page loads.
- Test all four search types with valid and invalid input.
- Open at least one block, transaction, address, and asset detail.
- Confirm English, Spanish, French, Arabic, and one Asian language.
- Confirm currency, date, time, address, number, theme, and refresh preferences.
- Test keyboard navigation and the settings focus trap.
- Test narrow mobile and wide desktop layouts.
- Stop and restart the API to verify the recovery notice.
- Confirm external market links open safely.
- Confirm no database, environment, or secret files are included in Git.

## Data sources

- Keeta Network data is accessed through the KeetaNet client.
- KTA market information is provided by CoinGecko.

## Project status

KeetaView is under active development. Its local index can be incomplete and should not be treated as an authoritative network-wide record.

### Cached account names

`npm start` also starts the account-name worker. It reads indexed accounts and
recent operations, and stores Keeta `info.name` in `account-names.db` inside
`KEETAVIEW_DATA_DIR` (the same persistent volume as the chain database).
Transaction APIs attach cached `sender_name` and `recipient_name`; rendering and
search never trigger account-name network calls. Names are self-assigned labels,
not verified identities. Addresses remain in links, displays and copy buttons.

Transaction search accepts exact, case-insensitive cached account names, including
all accounts sharing that name. More than 100 matching accounts requires an
address search. Unknown names return no results until discovered; the worker does
not crawl the entire network at startup. Existing address/hash/asset/type searches
continue to work. Names can lag on-chain changes.

The worker shares an eight-request budget per minute by default between account
labels and registered usernames (four label lookups and two username lookups,
with two provider requests per username). Hourly SDK service discovery is additional.
All SDK fetches in the isolated worker have a 10-second timeout. It
prioritizes recent activity while reserving slots for resumable older-account
discovery and expired cache entries. Positive entries refresh after six hours;
unnamed accounts after 24 hours. Transport failures retain the last good name and
back off for one hour. Set `ACCOUNT_NAMES_ENABLED=false` to stop background
lookups, or `ACCOUNT_NAME_BATCH_SIZE` (3–20) to change the batch cap. Persist the
name database and its WAL files; do not commit them.


### Registered `$keeta.xyz` usernames

The same worker discovers the mainnet `keeta.xyz` provider through the official
Anchor SDK. It confirms both address-to-username and username-to-address mappings
before caching a registered handle separately from the account's self-assigned
`info.name`. Transaction responses include `sender_username` and
`recipient_username`; displays prefer these handles, while retaining address
links and copy values. Unresolved accounts keep their account label or address.

Search the full handle, for example `xescure$keeta.xyz`. An uncached handle queues
one deduplicated background lookup; the page asks you to retry in about a minute.
There are at most 100 pending searches, with one reserved worker slot per cycle.
Queue failures back off for an hour; missing or unconfirmed mappings are cached
for 24 hours. Registered mappings refresh after six hours. Provider outages keep
previous mappings and do not stop the API/indexer. Names may lag changes.

Searches containing `$` use only registered mappings, never an `info.name` that
resembles a registered handle. A confirmed transfer clears the old cached owner.
No username provider requests run in transaction rendering or API handlers.


Cached account-name and registered-username transaction searches select matching
operation row IDs through the existing sender/recipient indexes. Unknown or
partial names return an empty result without querying the chain database; a full
uncached registered handle still queues its background lookup. These search paths
avoid broad field comparisons and full-table/timestamp scans.

### KTA holder watch

Open **Assets → View KTA holders** (or the KTA asset page). The first version lists
up to 25 **Top observed KTA holders** ranked by their cached network balances,
with cached usernames and a per-wallet last-check time. This is a partial ranking
among wallets checked by KeetaView, not a complete network-wide rich list. Each
snapshot comes from the SDK's `getBalance`; indexed transfer totals are never
presented as current balances. KTA uses the SDK mainnet base-token address and
18 decimals, confirmed against its network metadata.

The optional holder worker starts with `npm start` and keeps `holders.db` on the
existing persistent volume. It discovers wallets from the latest 100 indexed KTA
transfers and resumably scans up to 1,000 older KTA transfers per cycle, using the
existing token index. Historical discovery defers during recent public API
activity. Largest observed transfers prioritize candidates; wallets with no
indexed KTA activity are outside this first version's coverage. Four sequential
network balance checks run per cycle by default; successful snapshots refresh
after six hours and failures retry after an hour without removing the last
snapshot. Set `HOLDERS_ENABLED=false` to stop that worker, or
`HOLDER_BALANCE_BATCH_SIZE` (1–10) to change the batch. SDK fetches time out after
10 seconds. Worker failures do not stop the API/indexer.

Select a holder to open only that wallet's indexed KTA transfers. The wallet and
asset filters persist through search and pagination, and direction badges show
Sent, Received or Self transfer. This view refreshes its first page every minute
while visible. Transfers do not prove a buy or sell; no swap classification or
notifications are implied. Holder pages use cached balance/name data with no
live per-row requests. `/api/holders` supports KTA only; filtered operation queries
accept `address` plus `token` and use existing sender/recipient indexes.
