import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openAccountNames, nameSearchCondition } from './account-names.js';

 test('persistent names, negative cache, rename, removal and failed refresh', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeta-names-'));
    const file = path.join(directory, 'names.db');
    let cache = openAccountNames(file);
    try {
        cache.save('alice', ' Alice ', 1000);
        cache.save('unnamed', '', 1000);
        cache.fail('alice', 2000);
        assert.equal(cache.decorate([{ sender: 'alice', recipient: 'unnamed' }])[0].sender_name, 'Alice');
        assert.equal(cache.db.prepare('SELECT retry_at FROM account_names WHERE address = ?').get('unnamed').retry_at, 1000 + 86400000);
        cache.db.close();
        cache = openAccountNames(file);
        assert.equal(cache.search('ALICE')[0].address, 'alice');
        cache.save('alice', 'Bob');
        assert.deepEqual(cache.search('Alice'), []);
        cache.save('alice', null);
        assert.deepEqual(cache.search('Bob'), []);
        cache.save('bad', 'line\nbreak');
        assert.equal(cache.decorate([{ sender: 'bad' }])[0].sender_name, null);
        assert.equal(cache.decorate([{ sender: 'missing' }])[0].sender_name, null);
    } finally {
        cache.db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('duplicate name search is parameterized, indexed and bounded', () => {
    const cache = openAccountNames(':memory:');
    try {
        const name = "O'Reilly %_<script>";
        cache.save('a', name);
        cache.save('b', name);
        const match = nameSearchCondition(cache, name.toUpperCase());
        assert.deepEqual(match.parameters, ['a', 'b', 'a', 'b']);
        assert.ok(!match.sql.includes(name));
        assert.deepEqual(nameSearchCondition(cache, 'unknown').parameters, []);
        const plan = cache.db.prepare('EXPLAIN QUERY PLAN SELECT address FROM account_names WHERE name = ? COLLATE NOCASE').all(name);
        assert.ok(plan.some(row => row.detail.includes('account_names_by_name')));
        for (let i = 0; i < 101; i++) cache.save(`many-${i}`, 'Shared');
        assert.throws(() => nameSearchCondition(cache, 'Shared'), /full address/);
    } finally { cache.db.close(); }
});

test('transaction API searches and returns cached names without a network worker', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'keeta-name-api-'));
    const db = new DatabaseSync(path.join(directory, 'keetascan.db'));
    const source = fs.readFileSync(new URL('./indexer.js', import.meta.url), 'utf8');
    for (const match of source.matchAll(/database\.exec\(`([\s\S]*?)`\);/g)) {
        if (/CREATE TABLE|CREATE INDEX/.test(match[1])) db.exec(match[1]);
    }
    db.prepare('INSERT INTO blocks VALUES (?, ?, ?)').run('block', '2026-10-06', 3);
    const insert = db.prepare(`INSERT INTO operations
        (block_hash, operation_index, operation_type, sender, recipient, timestamp, details_json)
        VALUES ('block', ?, 'SEND', ?, ?, '2026-10-06', '{}')`);
    insert.run(0, 'a', 'other');
    insert.run(1, 'other', 'b');
    insert.run(2, 'keeta_unknown', 'other');
    db.close();
    const cache = openAccountNames(path.join(directory, 'account-names.db'));
    cache.save('a', 'Shared');
    cache.save('b', 'Shared');
    cache.saveUsername('a', 'alice$keeta.xyz');
    cache.db.close();
    // Only the API runs; fixtures supply all names, with no Keeta client involved.
    const child = spawn(process.execPath, ['indexer/server.js'], {
        env: { ...process.env, KEETAVIEW_DATA_DIR: directory, PORT: '31987', HOST: '127.0.0.1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('API startup timed out')), 10000);
            child.stdout.on('data', chunk => {
                if (chunk.toString().includes('KeetaView running')) { clearTimeout(timer); resolve(); }
            });
            child.on('exit', code => { clearTimeout(timer); reject(new Error(`API exited ${code}`)); });
        });
        const payload = await (await fetch('http://127.0.0.1:31987/api/operations?q=shared')).json();
        assert.equal(payload.total, 2);
        assert.equal(payload.operations.length, 2);
        assert.equal(payload.operations.find(op => op.sender === 'a').sender_name, 'Shared');
        assert.equal(payload.operations.find(op => op.recipient === 'b').recipient_name, 'Shared');
        const detail = await (await fetch('http://127.0.0.1:31987/api/transaction?block=block&operation=0')).json();
        assert.equal(detail.sender_name, 'Shared');
        assert.equal(detail.recipient_name, null);
        assert.equal(detail.sender_username, 'alice$keeta.xyz');
        const username = await (await fetch('http://127.0.0.1:31987/api/operations?q=alice%24keeta.xyz')).json();
        assert.equal(username.total, 1);
        assert.equal(username.operations[0].sender_username, 'alice$keeta.xyz');
        assert.equal(username.name_lookup, 'cached');
        const pending = await (await fetch('http://127.0.0.1:31987/api/operations?q=new_user%24keeta.xyz')).json();
        assert.equal(pending.name_lookup, 'pending');
        assert.equal(pending.total, 0);
        const address = await (await fetch('http://127.0.0.1:31987/api/operations?q=keeta_unknown')).json();
        assert.equal(address.total, 1);
        const missing = await (await fetch('http://127.0.0.1:31987/api/operations?q=missing')).json();
        assert.equal(missing.total, 0);
    } finally {
        child.kill();
        await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('sender links render untrusted names as text and preserve address destinations', async () => {
    const { runInNewContext } = await import('node:vm');
    const source = fs.readFileSync(new URL('../transactions.js', import.meta.url), 'utf8');
    const functionSource = source.slice(source.indexOf('function createAddressLink('), source.indexOf('function createOperationRow('));
    const create = runInNewContext(`${functionSource}; createAddressLink`, {
        document: { createElement: tag => ({ tag, addEventListener() {} }) },
        shortValue: address => address.slice(0, 5),
        // A lookup here would fail the test.
        fetch: () => { throw new Error('Per-row network request'); }
    });
    const name = '<img src=x onerror=alert(1)>';
    const link = create('keeta_full_address', name);
    assert.equal(link.textContent, `${name} (keeta)`);
    assert.equal(link.innerHTML, undefined);
    assert.equal(link.href, 'address.html?address=keeta_full_address');
    assert.ok(link.title.includes('keeta_full_address'));
    assert.equal(create('keeta_full_address', null).textContent, 'keeta');
    assert.equal(create(null, name).textContent, '—');
    const registered = create('keeta_full_address', 'Self assigned', 'alice$keeta.xyz');
    assert.equal(registered.textContent, 'alice$keeta.xyz (keeta)');
    assert.ok(registered.title.includes('registered username'));
    assert.equal(registered.href, link.href);
});
