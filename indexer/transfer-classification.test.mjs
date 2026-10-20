import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
    new URL('./indexer.js', import.meta.url), 'utf8'
);

const typeStart = source.indexOf('function getOperationType(');
const typeEnd = source.indexOf('\nfunction ', typeStart + 1);
assert.ok(typeStart >= 0 && typeEnd > typeStart);

const getOperationType = new Function(
    `${source.slice(typeStart, typeEnd)}; return getOperationType;`
)();

const match = source.match(
    /if\s*\(([^{}]+)\)\s*\{\s*insertTransfer\.run\(/
);
assert.ok(match, 'Locate the production transfer insertion condition');

const qualifies = new Function(
    'operation', 'sender', 'recipient', 'token', 'block',
    'getOperationType',
    `return Boolean(${match[1]});`
);

class BlockOperationSEND {}
class BlockOperationRECEIVE {}
class BlockOperationTOKEN_ADMIN_MODIFY_BALANCE {}

function check(Type, amount, overrides = {}) {
    const operation = Object.assign(new Type(), { amount });
    const values = {
        sender: 'sender',
        recipient: 'recipient',
        token: 'token',
        block: { hash: 'block-hash' },
        ...overrides
    };
    return qualifies(
        operation, values.sender, values.recipient,
        values.token, values.block, getOperationType
    );
}

test('SEND transfers include zero and large exact amounts', () => {
    assert.equal(check(BlockOperationSEND, 1n), true);
    assert.equal(check(BlockOperationSEND, 0n), true);
    assert.equal(
        check(BlockOperationSEND, 999999999999999999999n), true
    );
});

test('RECEIVE and balance adjustments are not transfer rows', () => {
    assert.equal(check(BlockOperationRECEIVE, 1n), false);
    assert.equal(
        check(BlockOperationTOKEN_ADMIN_MODIFY_BALANCE, 1n), false
    );
});

test('incomplete SEND records are not inserted as transfers', () => {
    for (const field of ['sender', 'recipient', 'token']) {
        assert.equal(
            check(BlockOperationSEND, 1n, { [field]: null }), false
        );
    }
    assert.equal(check(BlockOperationSEND, null), false);
    assert.equal(check(BlockOperationSEND, undefined), false);
    assert.equal(
        check(BlockOperationSEND, 1n, { block: {} }), false
    );
});