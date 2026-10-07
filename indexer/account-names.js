import { DatabaseSync } from "node:sqlite";

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
    `);
    const lookup = db.prepare("SELECT name FROM account_names WHERE address = ?");
    const find = db.prepare(`SELECT address, name FROM account_names
        WHERE name = ? COLLATE NOCASE ORDER BY address LIMIT 101`);
    return {
        db,
        search(query) {
            if (typeof query !== "string" || query.length > 256) return [];
            return find.all(query.trim());
        },
        decorate(operations) {
            const names = new Map();
            for (const op of operations) {
                for (const address of [op.sender, op.recipient]) {
                    if (address && !names.has(address)) {
                        names.set(address, lookup.get(address)?.name || null);
                    }
                }
            }
            return operations.map(op => ({ ...op,
                sender_name: names.get(op.sender) || null,
                recipient_name: names.get(op.recipient) || null
            }));
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
