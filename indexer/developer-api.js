import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const digest = key => crypto.createHash('sha256').update(key).digest('hex');
export function openDeveloperKeys(file) {
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS api_usage (key_id TEXT PRIMARY KEY, day TEXT NOT NULL, daily INTEGER NOT NULL, minute INTEGER NOT NULL, minute_count INTEGER NOT NULL);`);
    return {
        create(label) {
            const id = crypto.randomUUID();
            const key = 'kv_beta_' + crypto.randomBytes(32).toString('hex');
            db.prepare('INSERT INTO api_keys(id,hash,label) VALUES(?,?,?)').run(id,digest(key),label);
            return { id, key };
        },
        list() { return db.prepare('SELECT id,label,revoked FROM api_keys').all(); },
        revoke(id) { return db.prepare('UPDATE api_keys SET revoked=1 WHERE id=?').run(id).changes; },
        consume(key, now = Date.now()) {
            if (typeof key !== 'string' || !/^kv_beta_[a-f0-9]{64}$/.test(key)) return { status:401 };
            const row = db.prepare('SELECT id FROM api_keys WHERE hash=? AND revoked=0').get(digest(key));
            if (!row) return { status:401 };
            const day = new Date(now).toISOString().slice(0,10), minute = Math.floor(now/60000);
            db.exec('BEGIN IMMEDIATE');
            try {
                const old = db.prepare('SELECT * FROM api_usage WHERE key_id=?').get(row.id);
                const daily = old?.day === day ? old.daily : 0;
                const count = old?.minute === minute ? old.minute_count : 0;
                if (daily >= 1000 || count >= 30) {
                    db.exec('COMMIT');
                    return { status:429, retry:daily >= 1000 ? Math.ceil((Date.parse(day+'T00:00:00Z')+86400000-now)/1000) : 60-Math.floor(now/1000)%60 };
                }
                db.prepare(`INSERT INTO api_usage VALUES(?,?,?,?,?) ON CONFLICT(key_id) DO UPDATE SET day=excluded.day,daily=excluded.daily,minute=excluded.minute,minute_count=excluded.minute_count`).run(row.id,day,daily+1,minute,count+1);
                db.exec('COMMIT');
                return { status:200, day, requestsToday:daily+1, remainingToday:999-daily, remainingMinute:29-count };
            } catch (error) { db.exec('ROLLBACK'); throw error; }
        },
        close() { db.close(); }
    };
}

export function developerResponse(url, database, state, usage) {
    if (url.pathname === '/api/v1/usage') return { data:usage };
    if (url.pathname === '/api/v1/status') return { data:{
        network:'mainnet', historicalComplete:state.historicalBackfill?.complete === true,
        latestIndexedTimestamp:database.prepare('SELECT timestamp FROM blocks ORDER BY timestamp DESC LIMIT 1').get()?.timestamp ?? null,
        coverageNote:'Indexed records only. Historical coverage is incomplete unless historicalComplete is true.'
    } };
    if (url.pathname === '/api/v1/block') {
        const hash = url.searchParams.get('hash');
        if (!/^[a-fA-F0-9]{64}$/.test(hash || '')) return { status:400, error:'A 64-character block hash is required.' };
        const row = database.prepare('SELECT hash,timestamp,operation_count FROM blocks WHERE hash=?').get(hash.toUpperCase());
        return row ? { data:row } : { status:404, error:'Block not found in this index.' };
    }
    const token = url.searchParams.get('token');
    if (!/^keeta_[a-z2-7]{20,100}$/.test(token || '')) return { status:400, error:'A token address is required.' };
    const limit = Number(url.searchParams.get('limit') || 20);
    const before = url.searchParams.get('before');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (before !== null && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)) || Number(before)<1))) return { status:400, error:'limit must be 1–100; before must be a positive safe integer cursor.' };
    const rows = database.prepare(`SELECT id,block_hash,operation_index,sender,recipient,token,amount,timestamp FROM transfers INDEXED BY transfers_by_token WHERE token=? AND id < ? ORDER BY id DESC LIMIT ?`).all(token,before === null ? Number.MAX_SAFE_INTEGER : Number(before),limit+1);
    const more = rows.length > limit;
    if (more) rows.pop();
    return { data:rows, nextBefore:more ? rows.at(-1).id : null, amountUnit:'raw integer units', order:'insertion ID descending; not necessarily timestamp order', coverageNote:'Indexed transfers only; not guaranteed complete network history.' };
}
