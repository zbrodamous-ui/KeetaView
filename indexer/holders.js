import { DatabaseSync } from "node:sqlite";

// SDK UserClient.fromNetwork('main', null).baseToken; metadata confirms 18 decimals.
export const KTA_TOKEN = "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg";
export const KTA_DECIMALS = 18;

export function openHolders(file) {
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000;
        CREATE TABLE IF NOT EXISTS holders (
            address TEXT PRIMARY KEY,
            priority TEXT NOT NULL, priority_digits INTEGER NOT NULL,
            balance TEXT, balance_digits INTEGER,
            checked_at INTEGER NOT NULL DEFAULT 0,
            retry_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS holders_rank ON holders(balance_digits DESC, balance DESC, address)
            WHERE balance_digits > 0;
        CREATE INDEX IF NOT EXISTS holders_due ON holders(retry_at);
        CREATE INDEX IF NOT EXISTS holders_priority ON holders(priority_digits DESC, priority DESC, checked_at ASC);
        CREATE TABLE IF NOT EXISTS holder_state (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        INSERT OR IGNORE INTO holder_state VALUES ('cursor', 0), ('discovered', 0), ('checked', 0);
    `);
    const state = key => Number(db.prepare("SELECT value FROM holder_state WHERE key = ?").get(key)?.value || 0);
    const increment = db.prepare("UPDATE holder_state SET value = value + 1 WHERE key = ?");
    return {
        db, state,
        discover(transfers, cursor = null) {
            db.exec("BEGIN IMMEDIATE");
            try {
                for (const transfer of transfers) {
                    let priority;
                    try { priority = BigInt(transfer.amount || 0); } catch { continue; }
                    if (priority < 0n) continue;
                    const value = priority.toString();
                    for (const address of new Set([transfer.sender, transfer.recipient].filter(Boolean))) {
                        if (db.prepare(`INSERT OR IGNORE INTO holders(address, priority, priority_digits)
                            VALUES (?, ?, ?)`).run(address, value, value.length).changes) increment.run("discovered");
                        db.prepare(`UPDATE holders SET priority = ?, priority_digits = ? WHERE address = ?
                            AND (priority_digits < ? OR (priority_digits = ? AND priority < ?))`)
                            .run(value, value.length, address, value.length, value.length, value);
                    }
                }
                if (cursor !== null) db.prepare("UPDATE holder_state SET value = ? WHERE key = 'cursor'").run(cursor);
                db.exec("COMMIT");
            } catch (error) { db.exec("ROLLBACK"); throw error; }
        },
        due(limit, now = Date.now()) {
            // Bounded local queue scan; candidate discovery grows progressively.
            return db.prepare(`SELECT address FROM holders INDEXED BY holders_priority WHERE retry_at <= ?
                ORDER BY priority_digits DESC, priority DESC, checked_at ASC LIMIT ?`).all(now, limit);
        },
        saveBalance(address, raw, now = Date.now()) {
            const balance = BigInt(raw);
            if (balance < 0n) throw new Error("Negative network balance");
            const previous = db.prepare("SELECT checked_at FROM holders WHERE address = ?").get(address);
            if (!previous) throw new Error("Holder was not discovered");
            db.exec("BEGIN IMMEDIATE");
            try {
                db.prepare(`UPDATE holders SET balance = ?, balance_digits = ?, checked_at = ?, retry_at = ?
                    WHERE address = ?`).run(balance.toString(), balance ? balance.toString().length : 0,
                        now, now + 6 * 3600000, address);
                if (!previous.checked_at) increment.run("checked");
                db.exec("COMMIT");
            } catch (error) { db.exec("ROLLBACK"); throw error; }
        },
        fail(address, now = Date.now()) {
            db.prepare("UPDATE holders SET retry_at = ? WHERE address = ?").run(now + 3600000, address);
        },
        list(limit = 25) {
            return {
                token: KTA_TOKEN, symbol: "KTA", decimals: KTA_DECIMALS,
                coverage: "observed", discovered_wallets: state("discovered"), checked_wallets: state("checked"),
                discovery_cursor: state("cursor"),
                holders: db.prepare(`SELECT address, balance, checked_at FROM holders
                    WHERE balance_digits > 0 ORDER BY balance_digits DESC, balance DESC, address LIMIT ?`)
                    .all(Math.max(1, Math.min(limit, 100)))
            };
        }
    };
}

export function walletOperationCondition(address) {
    return {
        sql: `operations.rowid IN (
            SELECT rowid FROM operations INDEXED BY operations_by_sender WHERE sender = ?
            UNION SELECT rowid FROM operations INDEXED BY operations_by_recipient WHERE recipient = ?
        )`, parameters: [address, address]
    };
}
