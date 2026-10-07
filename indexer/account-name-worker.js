import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as KeetaNet from "@keetanetwork/keetanet-client";
import { Username, KeetaNet as AnchorKeetaNet } from "@keetanetwork/anchor";
import { openAccountNames } from "./account-names.js";
import { resolveRegisteredUsername } from "./username-resolution.js";

const directory = process.env.KEETAVIEW_DATA_DIR || "./indexer";
fs.mkdirSync(directory, { recursive: true });
const cache = openAccountNames(path.join(directory, "account-names.db"));
const client = KeetaNet.Client.fromNetwork("main");
const usernameClient = new Username.Client(AnchorKeetaNet.UserClient.fromNetwork("main", null));
// Timeout all SDK fetches in this isolated worker, including discovery. No API globals change.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options = {}) => originalFetch(input, {
    ...options, signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000)
});
const configured = Number(process.env.ACCOUNT_NAME_BATCH_SIZE || 8);
const requestBudget = Number.isInteger(configured) ? Math.max(3, Math.min(configured, 20)) : 8;
// Two provider calls per registered handle (reverse + forward verification).
const usernameBatch = Math.floor(requestBudget / 3);
const nameBatch = requestBudget - usernameBatch * 2;
let provider;
let providerExpires = 0;
let stopped = false;
let timer;
process.on("SIGTERM", () => { stopped = true; clearTimeout(timer); process.exit(0); });
process.on("SIGINT", () => { stopped = true; clearTimeout(timer); process.exit(0); });

function selectCandidates(chain, table, progressTable, batchSize) {
    const now = Date.now();
    const ready = cache.db.prepare(`SELECT 1 FROM ${table} WHERE address = ? AND retry_at > ?`);
    const candidates = new Set();
    for (const op of chain.prepare(`SELECT sender, recipient FROM operations
        ORDER BY timestamp DESC LIMIT 100`).all()) {
        if (op.sender) candidates.add(op.sender);
        if (op.recipient) candidates.add(op.recipient);
    }
    const cursor = cache.db.prepare(`SELECT cursor FROM ${progressTable} WHERE id = 1`).get()?.cursor || "";
    const older = chain.prepare(`SELECT address FROM accounts WHERE address > ?
        ORDER BY address LIMIT 1`).all(cursor);
    const expired = cache.db.prepare(`SELECT address FROM ${table}
        WHERE retry_at <= ? ORDER BY retry_at LIMIT 1`).all(now);
    // Rotate priorities for small budgets to avoid starving discovery/refresh/activity.
    const groups = [expired.map(row => row.address), [...candidates], older.map(row => row.address)];
    const rotation = Math.floor(now / 60000) % 3;
    const ordered = [...groups.slice(rotation), ...groups.slice(0, rotation)].flat();
    const addresses = [...new Set(ordered)].filter(address => !ready.get(address, now)).slice(0, batchSize);
    return { addresses, advance() {
        if (!older.length || addresses.includes(older[0].address) || ready.get(older[0].address, now)) {
            cache.db.prepare(`INSERT INTO ${progressTable} VALUES (1, ?)
                ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor`).run(older[0]?.address || "");
        }
    } };
}

async function refreshUsernames(chain) {
    if (!usernameBatch) return;
    // Explicit full-name searches get one reserved slot; remaining slots discover addresses.
    const query = cache.db.prepare(`SELECT query FROM username_queries
        WHERE checked_at = 0 AND retry_at <= ? ORDER BY rowid LIMIT 1`).get(Date.now());
    const selected = selectCandidates(chain, "account_usernames", "username_progress", usernameBatch - (query ? 1 : 0));
    if (!query && !selected.addresses.length) { selected.advance(); return; }
    try {
        if (!provider || Date.now() >= providerExpires) {
            provider = await usernameClient.getProvider("keeta.xyz");
            if (!provider) throw new Error("Mainnet keeta.xyz username provider unavailable");
            providerExpires = Date.now() + 3600000;
        }
    } catch (error) {
        console.warn("Registered username discovery deferred:", error.message);
        return; // Discovery failure is not an account-level negative result.
    }
    if (query) {
        try {
            cache.finishUsernameQuery(query.query, await resolveRegisteredUsername(provider, query.query));
        } catch (error) {
            cache.db.prepare("UPDATE username_queries SET retry_at = ? WHERE query = ?")
                .run(Date.now() + 3600000, query.query);
            console.warn("Username search deferred:", error.message);
            return;
        }
    }
    for (const address of selected.addresses) {
        if (stopped) return;
        try {
            const result = await resolveRegisteredUsername(provider, address);
            cache.saveUsername(address, result?.username || null);
        } catch (error) {
            cache.failUsername(address);
            console.warn("Registered username refresh deferred:", error.message);
            return;
        }
    }
    selected.advance();
}

async function refresh() {
    let chain;
    try {
        if (!fs.existsSync(path.join(directory, "keetascan.db"))) return;
        chain = new DatabaseSync(path.join(directory, "keetascan.db"), { readOnly: true });
        chain.exec("PRAGMA busy_timeout = 1000");
        // Both caches share the previous eight-request budget, plus hourly service discovery.
        await refreshUsernames(chain);
        const selected = selectCandidates(chain, "account_names", "name_progress", nameBatch);
        for (const address of selected.addresses) {
            if (stopped) return;
            try {
                const info = await client.getAccountInfo(address);
                cache.save(address, info?.info?.name);
            } catch (error) {
                cache.fail(address);
                console.warn("Account-name refresh deferred:", error.message);
                return;
            }
        }
        selected.advance();
    } catch (error) {
        console.warn("Account-name cache waiting:", error.message);
    } finally { chain?.close(); }
}
async function tick() {
    await refresh();
    if (!stopped) timer = setTimeout(tick, 60_000);
}
if (process.env.ACCOUNT_NAMES_ENABLED !== "false") await tick();
