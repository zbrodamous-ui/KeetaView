import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openAccountNames } from './account-names.js';
import { transactionSearch } from './transaction-search.js';

test('cached-name searches use only matching sender/recipient indexes, deduplicate and count exactly', () => {
    const cache = openAccountNames(':memory:');
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(`CREATE TABLE operations (
            block_hash TEXT, operation_index INTEGER, operation_type TEXT,
            sender TEXT, recipient TEXT, token TEXT, timestamp TEXT,
            PRIMARY KEY(block_hash, operation_index));
            CREATE INDEX operations_by_sender ON operations(sender);
            CREATE INDEX operations_by_recipient ON operations(recipient);
            CREATE INDEX operations_by_type ON operations(operation_type);
            CREATE INDEX operations_by_timestamp ON operations(timestamp);`);
        const insert = db.prepare('INSERT INTO operations VALUES (?, 0, ?, ?, ?, NULL, ?)');
        for (let i = 0; i < 10000; i++) insert.run(`noise${i}`, 'SET INFO', 'unrelated', 'other', '2026-10-07');
        insert.run('one', 'SEND', 'alice', 'other', '2026-10-06');
        insert.run('two', 'SEND', 'other', 'alice', '2026-10-06');
        insert.run('both', 'SEND', 'alice', 'alice', '2026-10-06');
        cache.saveUsername('alice', 'alice$keeta.xyz');
        cache.save('alice', 'Friendly name');
        for (const query of ['alice$keeta.xyz', 'Friendly name']) {
            const match = transactionSearch(cache, query);
            const sql = `SELECT * FROM operations WHERE ${match.sql} ORDER BY timestamp DESC LIMIT 20`;
            const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...match.parameters);
            assert.ok(plan.some(row => row.detail.includes('operations_by_sender')));
            assert.ok(plan.some(row => row.detail.includes('operations_by_recipient')));
            assert.ok(plan.every(row => !/SCAN operations/.test(row.detail)), JSON.stringify(plan));
            assert.equal(db.prepare(sql).all(...match.parameters).length, 3);
            const countSQL = `SELECT COUNT(*) AS total FROM operations WHERE ${match.sql}`;
            const countPlan = db.prepare(`EXPLAIN QUERY PLAN ${countSQL}`).all(...match.parameters);
            assert.ok(countPlan.every(row => !/SCAN operations/.test(row.detail)), JSON.stringify(countPlan));
            assert.equal(db.prepare(countSQL).get(...match.parameters).total, 3);
        }
        const type = transactionSearch(cache, 'send');
        assert.equal(db.prepare(`SELECT COUNT(*) AS total FROM operations WHERE ${type.sql}`).get(...type.parameters).total, 3);
    } finally { db.close(); cache.db.close(); }
});

test('typing partial names and queuing uncached usernames require no chain search', () => {
    const cache = openAccountNames(':memory:');
    try {
        assert.equal(transactionSearch(cache, 'xes').empty, true);
        assert.equal(transactionSearch(cache, 'xescure$keeta.xyz').empty, true);
        assert.equal(cache.usernameStatus('xescure$keeta.xyz'), 'pending');
        assert.equal(transactionSearch(cache, 'keeta_fulladdress').empty, false);
        assert.equal(transactionSearch(cache, 'a'.repeat(64)).empty, false);
    } finally { cache.db.close(); }
});
