import test from 'node:test';
import assert from 'node:assert/strict';
import * as K from '@keetanetwork/keetanet-client';
import { CertificateBuilder as AnchorBuilder } from '@keetanetwork/anchor/lib/certificates.js';
import { inspectCertificate, certificateFingerprint, KEETA_ROOT_PEM, KEETA_ROOT_SHA256 } from './certificate-checker.js';
const { CertificateBuilder } = K.lib.Utils.Certificate;
const now = new Date('2026-10-17T12:00:00Z');
const key = () => K.lib.Account.fromSeed(K.lib.Account.generateRandomSeed(), 0);
const dn = value => [{ name: 'commonName', value }];
async function fixtures() {
    const rootKey = key(), intermediateKey = key(), account = key();
    const root = await new CertificateBuilder().build({ issuer: rootKey, subjectPublicKey: rootKey, issuerDN: dn('Test Root'), subjectDN: dn('Test Root'), serial: 1, validFrom: new Date('2026-01-01'), validTo: new Date('2028-01-01'), isCA: true });
    const intermediate = await new CertificateBuilder().build({ issuer: rootKey, subjectPublicKey: intermediateKey, issuerDN: dn('Test Root'), subjectDN: dn('Test Intermediate'), serial: 2, validFrom: new Date('2026-01-01'), validTo: new Date('2028-01-01'), isCA: true });
    const params = { issuer: intermediateKey, subjectPublicKey: account, issuerDN: dn('Test Intermediate'), subjectDN: dn('Account'), serial: 3, validFrom: new Date('2026-01-01'), validTo: new Date('2027-01-01'), isCA: false };
    const leaf = await new CertificateBuilder().build(params);
    return { root, intermediate, leaf, account, params, intermediateKey };
}
test('root pin matches the supplied certificate DER fingerprint', () => {
    assert.equal(certificateFingerprint(KEETA_ROOT_PEM), KEETA_ROOT_SHA256);
});
test('chain inspection requires a trusted anchor, intermediates, dates and account binding', async () => {
    const f = await fixtures();
    const input = { account: f.account.publicKeyString.get(), certificate: f.leaf.toPEM(), intermediates: [f.intermediate.toPEM()], roots: [f.root.toPEM()], now };
    const valid = await inspectCertificate(input);
    assert.equal(valid.status, 'trusted_chain');
    assert.equal(valid.chainFingerprints.length, 2);
    assert.equal(valid.revocation, 'not_checked');
    assert.equal(valid.kybVerified, false);
    assert.equal(valid.credentialType, 'unknown');
    assert.equal((await inspectCertificate({ ...input, roots: undefined })).status, 'untrusted_chain');
    assert.equal((await inspectCertificate({ ...input, intermediates: [] })).status, 'untrusted_chain');
    assert.equal((await inspectCertificate({ ...input, account: key().publicKeyString.get() })).status, 'account_mismatch');
    assert.equal((await inspectCertificate({ ...input, now: new Date('2027-02-01') })).status, 'outside_validity');
    assert.equal((await inspectCertificate({ ...input, now: new Date('2025-12-01') })).status, 'outside_validity');
    // A carried self-signed root never becomes trusted just by appearing in the bundle.
    assert.equal((await inspectCertificate({ ...input, roots: undefined, intermediates: [f.intermediate.toPEM(), f.root.toPEM()] })).chainTrusted, false);
    assert.equal((await inspectCertificate({ ...input, certificate: 'not a certificate' })).status, 'unreadable');
    const altered = Buffer.from(f.leaf.toDER()); altered[altered.length - 1] ^= 1;
    const damaged = await inspectCertificate({ ...input, certificate: altered });
    assert.notEqual(damaged.status, 'trusted_chain');
});
test('plain organization/person attributes classify credentials without revealing identity; encrypted attributes remain unknown', async () => {
    const f = await fixtures();
    for (const [entity, sensitive, expected] of [[{organization: []}, false, 'organization'], [{person: []}, false, 'person'], [{organization: []}, true, 'unknown']]) {
        const builder = new AnchorBuilder({ issuer: f.intermediateKey, subject: f.account, issuerDN: dn('Test Intermediate'), subjectDN: dn('Account'), serial: 5, validFrom: new Date('2026-01-01'), validTo: new Date('2027-01-01'), isCA: false });
        builder.setAttribute('entityType', sensitive, entity);
        const leaf = await builder.build();
        const report = await inspectCertificate({ account: f.account.publicKeyString.get(), certificate: leaf.toPEM(), intermediates: [f.intermediate.toPEM()], roots: [f.root.toPEM()], now });
        assert.equal(report.status, 'trusted_chain');
        assert.equal(report.credentialType, expected);
        assert.equal(report.kybVerified, false);
        assert.equal(Object.hasOwn(report, 'attributes'), false);
    }
});
