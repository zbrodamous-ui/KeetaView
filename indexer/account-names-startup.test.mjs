import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openAccountNames } from './account-names.js';

test('cache startup waits for another process and preserves cached names', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'names-startup-'));
    const file = path.join(directory, 'names.db');
    let child, cache;
    try {
        cache = openAccountNames(file);
        cache.db.prepare('INSERT INTO account_names VALUES (?, ?, ?, ?)').run('account', 'Existing name', 1, 2);
        cache.db.exec('DROP TABLE account_usernames');
        cache.db.close();
        cache = undefined;
        child = spawn(process.execPath, ['--input-type=module', '-e', `
            import { DatabaseSync } from 'node:sqlite';
            const db = new DatabaseSync(process.argv[1]);
            db.exec('BEGIN EXCLUSIVE; CREATE TABLE startup_lock_probe (id INTEGER)');
            process.stdout.write('locked');
            setTimeout(() => { db.exec('COMMIT'); db.close(); }, 1400);
        `, file], { stdio: ['ignore', 'pipe', 'pipe'] });
        const exited = once(child, 'exit');
        await Promise.race([
            once(child.stdout, 'data'),
            exited.then(() => { throw new Error('Lock holder exited before acquiring lock'); })
        ]);
        cache = openAccountNames(file);
        assert.equal(cache.db.prepare('SELECT name FROM account_names WHERE address = ?').get('account').name, 'Existing name');
        assert.ok(cache.db.prepare("SELECT name FROM sqlite_master WHERE name = 'startup_lock_probe'").get());
        assert.equal(cache.db.prepare('PRAGMA busy_timeout').get().timeout, 1000);
        assert.equal((await exited)[0], 0);
    } finally {
        cache?.db.close();
        if (child && child.exitCode === null) {
            child.kill('SIGKILL');
            await once(child, 'exit');
        }
        rmSync(directory, { recursive: true, force: true });
    }
});

test('cache startup surfaces permanent open errors', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'names-invalid-'));
    try {
        assert.throws(() => openAccountNames(directory));
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
