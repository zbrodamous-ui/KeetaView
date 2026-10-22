import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { auditTransfers, parseAuditArgs, AUDIT_QUERY } from './audit-transfers.js';

function fixture() {
    const db = new DatabaseSync(':memory:');
    db.exec(`CREATE TABLE transfers(id INTEGER PRIMARY KEY, block_hash TEXT, operation_index INTEGER, sender TEXT, recipient TEXT, token TEXT, amount TEXT);
        CREATE TABLE operations(block_hash TEXT, operation_index INTEGER, operation_type TEXT, PRIMARY KEY(block_hash, operation_index));`);
    const transfer = db.prepare('INSERT INTO transfers VALUES(?, ?, 0, ?, ?, ?, ?)');
    const operation = db.prepare('INSERT INTO operations VALUES(?, 0, ?)');
    for (const [id, type, recipient, amount] of [
        [1, 'SEND', 'recipient', '0'],
        [2, 'SEND', 'recipient', '900719925474099312345'],
        [3, 'RECEIVE', null, '12'],
        [4, 'TOKEN ADMIN MODIFY BALANCE', 'recipient', '14'],
        [5, null, 'recipient', '7'],
        [6, 'SEND', '', '8'],
        [7, 'SEND', 'recipient', 'NaN']
    ]) {
        transfer.run(id, `block${id}`, 'sender', recipient, 'token', amount);
        if (type) operation.run(`block${id}`, type);
    }
    return db;
}

test('audit separates non-SEND evidence, missing operations and malformed SEND rows without changing data', () => {
    const db = fixture();
    try {
        const before = db.prepare('SELECT * FROM transfers ORDER BY id').all();
        db.exec('PRAGMA query_only = ON');
        const report = auditTransfers(db, { limit: 100, samples: 1 });
        assert.deepEqual(report.counts, { eligibleSend: 2, nonSend: 2, missingOperation: 1, incompleteSend: 2 });
        assert.equal(report.checked, 7);
        assert.equal(report.nextBefore, null);
        assert.equal(report.examples.nonSend.length, 1);
        assert.equal(report.examples.missingOperation[0].id, 5);
        assert.deepEqual(db.prepare('SELECT * FROM transfers ORDER BY id').all(), before);
        assert.equal(Object.values(report.counts).reduce((a, b) => a + b, 0), report.checked);
    } finally { db.close(); }
});

test('bounded cursor pages have no overlap; joining operations uses the primary-key index', () => {
    const db = fixture();
    try {
        const a = auditTransfers(db, { limit: 3 });
        const b = auditTransfers(db, { limit: 3, before: a.nextBefore });
        const c = auditTransfers(db, { limit: 3, before: b.nextBefore });
        assert.equal(a.nextBefore, 5);
        assert.equal(b.nextBefore, 2);
        assert.equal(c.checked, 1);
        assert.equal(c.counts.eligibleSend, 1);
        assert.equal(c.nextBefore, null);
        const plan = db.prepare('EXPLAIN QUERY PLAN ' + AUDIT_QUERY).all(Number.MAX_SAFE_INTEGER, 3);
        assert.ok(plan.some(x => /SEARCH transfers USING INTEGER PRIMARY KEY/.test(x.detail)));
        assert.ok(plan.some(x => /SEARCH o USING INDEX sqlite_autoindex_operations_1/.test(x.detail)));
        assert.ok(plan.every(x => !/SCAN o\b/.test(x.detail)));
    } finally { db.close(); }
});

test('audit rejects unsafe limits, malformed cursors, unknown and repeated flags', () => {
    const db = fixture();
    try {
        for (const options of [{ limit: 0 }, { limit: 10001 }, { before: -1 }, { before: '1 OR 1=1' }, { samples: 21 }]) {
            assert.throws(() => auditTransfers(db, options));
        }
        assert.throws(() => parseAuditArgs(['--apply', 'true']));
        assert.throws(() => parseAuditArgs(['--limit']));
        assert.throws(() => parseAuditArgs(['--limit', '5', '--limit', '6']));
        assert.deepEqual(parseAuditArgs(['--limit', '100', '--before', '50']), { limit: '100', before: '50' });
    } finally { db.close(); }
});
