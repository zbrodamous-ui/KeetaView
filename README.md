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
