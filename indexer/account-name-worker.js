import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as KeetaNet from "@keetanetwork/keetanet-client";
import { openAccountNames } from "./account-names.js";

const directory = process.env.KEETAVIEW_DATA_DIR || "./indexer";
fs.mkdirSync(directory, { recursive: true });
const cache = openAccountNames(path.join(directory, "account-names.db"));
const client = KeetaNet.Client.fromNetwork("main");
// At most eight sequential requests per minute; no requests originate in API handlers.
const configured = Number(process.env.ACCOUNT_NAME_BATCH_SIZE || 8);
const batchSize = Number.isInteger(configured) ? Math.max(1, Math.min(configured, 20)) : 8;
let stopped = false;
let timer;
process.on("SIGTERM", () => { stopped = true; clearTimeout(timer); });
process.on("SIGINT", () => { stopped = true; clearTimeout(timer); });

async function refresh() {
    let chain;
    try {
        if (!fs.existsSync(path.join(directory, "keetascan.db"))) return;
        chain = new DatabaseSync(path.join(directory, "keetascan.db"), { readOnly: true });
        chain.exec("PRAGMA busy_timeout = 1000");
        const now = Date.now();
        const candidates = new Set();
        // Recent activity gets priority; this query uses the existing timestamp index.
        for (const op of chain.prepare(`SELECT sender, recipient FROM operations
            ORDER BY timestamp DESC LIMIT 100`).all()) {
            if (op.sender) candidates.add(op.sender);
            if (op.recipient) candidates.add(op.recipient);
        }
        const ready = address => !cache.db.prepare(
            "SELECT 1 FROM account_names WHERE address = ? AND retry_at > ?"
        ).get(address, now);
        const recent = [...candidates].filter(ready).slice(0, Math.max(0, batchSize - 3));
        // Reserve capacity for resumable discovery of older indexed accounts.
        const cursor = cache.db.prepare("SELECT cursor FROM name_progress WHERE id = 1").get()?.cursor || "";
        const older = chain.prepare(`SELECT address FROM accounts WHERE address > ?
            ORDER BY address LIMIT ?`).all(cursor, Math.min(2, batchSize));
        chain.close();
        chain = null;
        const expired = cache.db.prepare(`SELECT address FROM account_names
            WHERE retry_at <= ? ORDER BY retry_at LIMIT 1`).all(now);
        const addresses = [...new Set([...expired.map(row => row.address), ...older.map(row => row.address), ...recent])]
            .filter(ready).slice(0, batchSize);
        // Periodically refresh previously discovered names, even for inactive accounts.
        for (const row of cache.db.prepare(`SELECT address FROM account_names
            WHERE retry_at <= ? ORDER BY retry_at LIMIT ?`).all(now, batchSize)) {
            if (addresses.length >= batchSize) break;
            if (!addresses.includes(row.address)) addresses.push(row.address);
        }
        for (const address of addresses) {
            if (stopped) return;
            try {
                const info = await client.getAccountInfo(address);
                cache.save(address, info?.info?.name);
            } catch (error) {
                cache.fail(address);
                console.warn("Account-name refresh deferred:", error.message);
                return; // Back off for a full interval on upstream failures.
            }
        }
        cache.db.prepare(`INSERT INTO name_progress VALUES (1, ?)
            ON CONFLICT(id) DO UPDATE SET cursor = excluded.cursor`)
            .run(older.at(-1)?.address || "");
    } catch (error) {
        console.warn("Account-name cache waiting:", error.message);
    } finally {
        chain?.close();
    }
}
async function tick() {
    await refresh();
    if (!stopped) timer = setTimeout(tick, 60_000);
}
if (process.env.ACCOUNT_NAMES_ENABLED !== "false") await tick();
