import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as KeetaNet from "@keetanetwork/keetanet-client";
import { openHolders, KTA_TOKEN } from "./holders.js";

const directory = process.env.KEETAVIEW_DATA_DIR || "./indexer";
fs.mkdirSync(directory, { recursive: true });
const cache = openHolders(path.join(directory, "holders.db"));
const client = KeetaNet.Client.fromNetwork("main");
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options = {}) => originalFetch(input, {
    ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
});
const configured = Number(process.env.HOLDER_BALANCE_BATCH_SIZE || 4);
const batch = Number.isInteger(configured) ? Math.max(1, Math.min(configured, 10)) : 4;
let stopped = false;
let timer;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    stopped = true; clearTimeout(timer); process.exit(0);
});

async function tick() {
    let chain;
    try {
        const file = path.join(directory, "keetascan.db");
        if (fs.existsSync(file)) {
            chain = new DatabaseSync(file, { readOnly: true });
            chain.exec("PRAGMA busy_timeout = 1000");
            // token index includes the integer row ID: no full transfer scan/sort.
            const recent = chain.prepare(`SELECT sender, recipient, amount FROM transfers INDEXED BY transfers_by_token
                WHERE token = ? ORDER BY id DESC LIMIT 100`).all(KTA_TOKEN);
            cache.discover(recent);
            let recentlyBusy = false;
            try { recentlyBusy = Date.now() - Number(fs.readFileSync(path.join(directory, "api-activity"), "utf8")) < 15000; } catch {}
            if (!recentlyBusy) {
                const older = chain.prepare(`SELECT id, sender, recipient, amount FROM transfers INDEXED BY transfers_by_token
                    WHERE token = ? AND id > ? ORDER BY id LIMIT 1000`).all(KTA_TOKEN, cache.state("cursor"));
                cache.discover(older, older.at(-1)?.id ?? cache.state("cursor"));
            }
            chain.close(); chain = null;
            for (const {address} of cache.due(batch)) {
                if (stopped) return;
                try { cache.saveBalance(address, await client.getBalance(address, KTA_TOKEN)); }
                catch (error) {
                    cache.fail(address);
                    console.warn("Holder balance refresh deferred:", error.message);
                    break;
                }
            }
        }
    } catch (error) { console.warn("Holder cache waiting:", error.message); }
    finally { chain?.close(); }
    if (!stopped) timer = setTimeout(tick, 60000);
}
if (process.env.HOLDERS_ENABLED !== "false") await tick();
