import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

test('asset transfer listing uses the token index without a history sort', () => {
    const db = new DatabaseSync(':memory:');
    try {
        const source = fs.readFileSync(new URL('./indexer.js', import.meta.url), 'utf8');
        for (const match of source.matchAll(/database\.exec\(`([\s\S]*?)`\);/g)) {
            if (/CREATE TABLE|CREATE INDEX/.test(match[1])) db.exec(match[1]);
        }
        const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT block_hash, sender, recipient, amount, timestamp
            FROM transfers INDEXED BY transfers_by_token WHERE token = ? ORDER BY id DESC LIMIT 10`).all('token');
        assert.ok(plan.some(row => row.detail.includes('transfers_by_token')));
        assert.ok(plan.every(row => !row.detail.includes('SCAN transfers') && !row.detail.includes('TEMP B-TREE')));
    } finally { db.close(); }
});
