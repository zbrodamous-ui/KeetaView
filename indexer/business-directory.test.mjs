import test from 'node:test';
import assert from 'node:assert/strict';
import { businessListings } from '../business-directory-data.js';
import { validateBusinessListings, filterBusinessListings } from '../business-directory-model.js';

// Synthetic fixtures remain in tests only, never in the public directory.
const sample = () => ({ id: 'fixture', name: '<img src=x> Example', address: 'keeta_' + 'a'.repeat(60), tag: 'example$keeta.xyz', listedOn: '2026-10-15', sources: [{ label: 'Business announcement', url: 'https://example.com/announcement' }] });
test('business directory starts empty and rejects unsupported or unsafe listing shapes', () => {
    assert.deepEqual(validateBusinessListings(businessListings), []);
    assert.equal(validateBusinessListings([sample()]).length, 1);
    assert.throws(() => validateBusinessListings([{ ...sample(), sources: [] }]));
    assert.throws(() => validateBusinessListings([{ ...sample(), address: 'keeta_short' }]));
    assert.throws(() => validateBusinessListings([{ ...sample(), sources: [{ label: 'bad', url: 'javascript:alert(1)' }] }]));
    assert.throws(() => validateBusinessListings([sample(), sample()]));
});
test('directory search matches business name, exact-address substrings, and tags without inventing matches', () => {
    const entries = [sample()];
    assert.equal(filterBusinessListings(entries, ' EXAMPLE ').length, 1);
    assert.equal(filterBusinessListings(entries, 'example$keeta.xyz').length, 1);
    assert.equal(filterBusinessListings(entries, entries[0].address).length, 1);
    assert.equal(filterBusinessListings(entries, 'absent').length, 0);
    assert.equal(filterBusinessListings([], '').length, 0);
});
