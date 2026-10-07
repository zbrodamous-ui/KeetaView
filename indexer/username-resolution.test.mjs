import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeKeetaUsername, resolveRegisteredUsername } from './username-resolution.js';
import { openAccountNames, nameSearchCondition } from './account-names.js';

const account = address => ({ publicKeyString: { get: () => address } });
const mapping = (address = 'keeta_alice', username = 'alice$keeta.xyz') => ({
    account: account(address), username: username.split('$')[0],
    providerID: 'keeta.xyz', globallyIdentifiableUsername: username
});

test('registered handles normalize without accepting another provider or malformed input', () => {
    assert.equal(normalizeKeetaUsername(' ALICE$KEETA.XYZ '), 'alice$keeta.xyz');
    for (const value of ['alice', 'alice.xyz', 'alice$evil.xyz', 'alice$keeta.xyz/path', 'a$keeta.xyz', '<img>$keeta.xyz', null]) {
        assert.equal(normalizeKeetaUsername(value), null);
    }
});

test('forward and reverse resolution each confirm both directions', async () => {
    const calls = [];
    const provider = { async resolve(input) { calls.push(input); return mapping(); } };
    assert.deepEqual(await resolveRegisteredUsername(provider, 'ALICE$KEETA.XYZ'), {
        address: 'keeta_alice', username: 'alice$keeta.xyz'
    });
    assert.deepEqual(calls, ['alice', 'keeta_alice']);
    calls.length = 0;
    await resolveRegisteredUsername(provider, 'keeta_alice');
    assert.deepEqual(calls, ['keeta_alice', 'alice']);
});

test('missing, mismatched, transferred, and failed username responses are not confirmed', async () => {
    assert.equal(await resolveRegisteredUsername({ resolve: async () => null }, 'keeta_alice'), null);
    await assert.rejects(resolveRegisteredUsername({ resolve: async () => mapping('keeta_other') }, 'keeta_alice'), /different/);
    await assert.rejects(resolveRegisteredUsername({ resolve: async () => ({ ...mapping(), providerID: 'evil.xyz' }) }, 'keeta_alice'), /Unexpected/);
    let calls = 0;
    assert.equal(await resolveRegisteredUsername({ resolve: async () => ++calls === 1 ? mapping() : mapping('keeta_new') }, 'keeta_alice'), null);
    await assert.rejects(resolveRegisteredUsername({ resolve: async () => { throw new Error('offline'); } }, 'keeta_alice'), /offline/);
});

test('registered cache migration, priority, transfer, removal and failure backoff', () => {
    const cache = openAccountNames(':memory:');
    try {
        cache.save('keeta_alice', 'Account label');
        cache.saveUsername('keeta_alice', 'alice$keeta.xyz', 1000);
        assert.equal(cache.decorate([{sender: 'keeta_alice'}])[0].sender_username, 'alice$keeta.xyz');
        cache.failUsername('keeta_alice', 2000);
        assert.equal(cache.decorate([{sender: 'keeta_alice'}])[0].sender_username, 'alice$keeta.xyz');
        cache.saveUsername('keeta_new', 'alice$keeta.xyz');
        assert.equal(cache.decorate([{sender: 'keeta_alice'}])[0].sender_username, null);
        assert.deepEqual(nameSearchCondition(cache, 'ALICE$KEETA.XYZ').parameters, ['keeta_new', 'keeta_new']);
        cache.saveUsername('keeta_new', null);
        assert.equal(cache.decorate([{sender: 'keeta_alice'}])[0].sender_name, 'Account label');
        assert.throws(() => cache.saveUsername('keeta_alice', 'bad$evil.xyz'), /Invalid/);
    } finally { cache.db.close(); }
});

test('uncached full-name search queues once locally, rejects label spoofing and caps pending searches', () => {
    const cache = openAccountNames(':memory:');
    try {
        cache.save('keeta_spoof', 'alice$keeta.xyz');
        assert.deepEqual(cache.search('alice$keeta.xyz'), []);
        cache.search('ALICE$KEETA.XYZ');
        assert.equal(cache.db.prepare('SELECT COUNT(*) AS n FROM username_queries').get().n, 1);
        assert.equal(cache.usernameStatus('alice$keeta.xyz'), 'pending');
        cache.finishUsernameQuery('alice$keeta.xyz', null);
        assert.equal(cache.usernameStatus('alice$keeta.xyz'), 'not_found');
        cache.search('alice$keeta.xyz');
        assert.equal(cache.usernameStatus('alice$keeta.xyz'), 'not_found');
        for (let i = 0; i < 101; i++) cache.search(`user${i}$keeta.xyz`);
        assert.equal(cache.db.prepare('SELECT COUNT(*) AS n FROM username_queries WHERE checked_at = 0').get().n, 100);
        assert.equal(cache.usernameStatus('user100$keeta.xyz'), 'busy');
        cache.finishUsernameQuery('user0$keeta.xyz', {address: 'keeta_user0', username: 'user0$keeta.xyz'});
        assert.equal(cache.usernameStatus('user0$keeta.xyz'), 'cached');
        assert.equal(cache.search('user0$keeta.xyz')[0].address, 'keeta_user0');
    } finally { cache.db.close(); }
});
