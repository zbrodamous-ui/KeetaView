# Token transfer dashboard demo

A standalone local demo using the real KeetaView beta API. Requires Node 24 and an invitation key. No dependencies beyond Node; run from the repository root.

In PowerShell, set your key privately (do not screenshot it):

```powershell
$env:KEETAVIEW_API_KEY = Read-Host 'Beta API key' -MaskInput
node examples/transfer-dashboard/server.mjs
```

Open http://127.0.0.1:3210 and paste a full token address from the explorer’s Assets page. View transfers, follow operation/account links, and load another page. Close the process with Ctrl+C; clear the key with `Remove-Item Env:KEETAVIEW_API_KEY`.

The server keeps the key in memory, sends it only to https://keetaview.com, and binds only to loopback. It restricts proxy routes, query parameters, concurrent requests, host and origin; this is a local developer sample, not a hosted public proxy. Do not expose its port or embed a key in the browser. There is no change to the deployed explorer.

The demo makes one status request at startup, then one request per page. It honors Retry-After locally and does not poll. Beta quotas remain 30/minute and 1,000/day. Errors retain the previous successful page so pagination can be retried. A new successful token search resets results. Operation links identify block hash plus operation index; duplicates are suppressed by that identity.

Amounts stay exact raw-unit strings; no floating point conversion or guessed token decimals. Coverage is incomplete unless the indexer reports otherwise; records follow insertion ID descending, not necessarily time. “Load older indexed results” means older insertion IDs, including any historical backfill; the pages are not a frozen snapshot. Empty results do not prove no network activity.

Validation: `node --test examples/transfer-dashboard/server.test.mjs`. Tests use a fake upstream and never require or print a real key. A live authenticated browser smoke test still requires an operator’s private beta key.
