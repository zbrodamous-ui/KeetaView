import { DatabaseSync } from "node:sqlite";
import { normalizeKeetaUsername } from "./username-resolution.js";

// Separate from the chain database: name refreshes cannot lock chain indexing.
export function openAccountNames(file) {
    const db = new DatabaseSync(file);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 1000;
        CREATE TABLE IF NOT EXISTS account_names (
            address TEXT PRIMARY KEY,
            name TEXT,
            checked_at INTEGER NOT NULL,
            retry_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS account_names_by_name
            ON account_names(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS account_names_by_retry
            ON account_names(retry_at);
        CREATE TABLE IF NOT EXISTS name_progress (
            id INTEGER PRIMARY KEY CHECK(id = 1), cursor TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS account_usernames (
            address TEXT PRIMARY KEY,
            username TEXT COLLATE NOCASE UNIQUE,
            checked_at INTEGER NOT NULL,
            retry_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS account_usernames_by_retry ON account_usernames(retry_at);
        CREATE TABLE IF NOT EXISTS username_progress (
            id INTEGER PRIMARY KEY CHECK(id = 1), cursor TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS username_queries (
            query TEXT PRIMARY KEY,
            checked_at INTEGER NOT NULL DEFAULT 0,
            retry_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS username_queries_pending
            ON username_queries(retry_at) WHERE checked_at = 0;
    `);
    const usernameLookup = db.prepare("SELECT username FROM account_usernames WHERE address = ?");
    const usernameFind = db.prepare("SELECT address, username FROM account_usernames WHERE username = ? COLLATE NOCASE");
    const lookup = db.prepare("SELECT name FROM account_names WHERE address = ?");
    const find = db.prepare(`SELECT address, name FROM account_names
        WHERE name = ? COLLATE NOCASE ORDER BY address LIMIT 101`);
    return {
        db,
        search(query) {
            if (typeof query !== "string" || query.length > 256) return [];
            if (query.includes("$")) {
                const normalized = normalizeKeetaUsername(query);
                if (!normalized) return [];
                const match = usernameFind.get(normalized);
                if (match) return [match];
                const previous = db.prepare("SELECT * FROM username_queries WHERE query = ?").get(normalized);
                if (!previous || previous.retry_at <= Date.now()) {
                    // Bounded, deduplicated local queue; no network work in the API.
                    const queued = db.prepare("SELECT COUNT(*) AS total FROM username_queries WHERE checked_at = 0").get().total;
                    if (queued < 100) db.prepare(`INSERT INTO username_queries(query) VALUES (?)
                        ON CONFLICT(query) DO UPDATE SET checked_at = 0, retry_at = 0`).run(normalized);
                }
                return [];
            }
            return find.all(query.trim());
        },
        decorate(operations) {
            const names = new Map();
            const usernames = new Map();
            for (const op of operations) {
                for (const address of [op.sender, op.recipient]) {
                    if (address && !names.has(address)) {
                        names.set(address, lookup.get(address)?.name || null);
                        usernames.set(address, usernameLookup.get(address)?.username || null);
                    }
                }
            }
            return operations.map(op => ({ ...op,
                sender_name: names.get(op.sender) || null,
                recipient_name: names.get(op.recipient) || null,
                sender_username: usernames.get(op.sender) || null,
                recipient_username: usernames.get(op.recipient) || null
            }));
        },
        usernameStatus(query) {
            const normalized = normalizeKeetaUsername(query);
            if (!normalized) return null;
            if (usernameFind.get(normalized)) return "cached";
            const row = db.prepare("SELECT checked_at FROM username_queries WHERE query = ?").get(normalized);
            return row ? (row.checked_at ? "not_found" : "pending") : "busy";
        },
        saveUsername(address, username, now = Date.now()) {
            const normalized = username === null ? null : normalizeKeetaUsername(username);
            if (username !== null && !normalized) throw new Error("Invalid registered username");
            db.exec("BEGIN IMMEDIATE");
            try {
                if (normalized) db.prepare(`UPDATE account_usernames SET username = NULL, retry_at = 0
                    WHERE username = ? COLLATE NOCASE AND address <> ?`).run(normalized, address);
                db.prepare(`INSERT INTO account_usernames VALUES (?, ?, ?, ?)
                    ON CONFLICT(address) DO UPDATE SET username = excluded.username,
                    checked_at = excluded.checked_at, retry_at = excluded.retry_at`)
                    .run(address, normalized, now, now + (normalized ? 6 : 24) * 3600000);
                db.exec("COMMIT");
            } catch (error) { db.exec("ROLLBACK"); throw error; }
        },
        failUsername(address, now = Date.now()) {
            db.prepare(`INSERT INTO account_usernames VALUES (?, NULL, 0, ?)
                ON CONFLICT(address) DO UPDATE SET retry_at = excluded.retry_at`)
                .run(address, now + 3600000);
        },
        finishUsernameQuery(query, result, now = Date.now()) {
            if (result) this.saveUsername(result.address, result.username, now);
            else db.prepare("UPDATE account_usernames SET username = NULL, retry_at = 0 WHERE username = ? COLLATE NOCASE").run(query);
            db.prepare("UPDATE username_queries SET checked_at = ?, retry_at = ? WHERE query = ?")
                .run(now, now + (result ? 6 : 24) * 3600000, query);
        },
        save(address, name, now = Date.now()) {
            const clean = typeof name === "string" ? name.trim() : "";
            const valid = clean.length <= 256 && !/[\x00-\x1f\x7f]/.test(clean);
            db.prepare(`INSERT INTO account_names VALUES (?, ?, ?, ?)
                ON CONFLICT(address) DO UPDATE SET name = excluded.name,
                checked_at = excluded.checked_at, retry_at = excluded.retry_at`)
                .run(address, valid && clean ? clean : null, now,
                    now + (clean ? 6 : 24) * 60 * 60 * 1000);
        },
        fail(address, now = Date.now()) {
            // Keep the last good name on transport errors; negative cache failures too.
            db.prepare(`INSERT INTO account_names VALUES (?, NULL, 0, ?)
                ON CONFLICT(address) DO UPDATE SET retry_at = excluded.retry_at`)
                .run(address, now + 60 * 60 * 1000);
        }
    };
}

export function nameSearchCondition(cache, query) {
    const matches = cache.search(query);
    if (matches.length > 100) {
        throw new Error("More than 100 cached accounts share this name. Search by full address.");
    }
    if (!matches.length) return { sql: "", parameters: [] };
    const addresses = matches.map(match => match.address);
    const placeholders = addresses.map(() => "?").join(",");
    return {
        sql: ` OR operations.sender IN (${placeholders}) OR operations.recipient IN (${placeholders})`,
        parameters: [...addresses, ...addresses]
    };
}
