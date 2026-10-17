import fs from 'node:fs';
import crypto from 'node:crypto';
import { Certificate as IdentityCertificate } from '@keetanetwork/anchor/lib/certificates.js';
import * as KeetaNet from '@keetanetwork/keetanet-client';
const { Certificate } = KeetaNet.lib.Utils.Certificate;

// Shared by rkeene in Keeta's developers channel on 2026-10-16; independently
// matched against mainnet service discovery's "Keeta KYB" CA. Pin the exact DER.
export const KEETA_ROOT_PEM = fs.readFileSync(new URL('./certificates/keeta-root.pem', import.meta.url), 'utf8');
export const KEETA_ROOT_SHA256 = '1e9eee1d84b7729e99c93a9f1f6365e09421cb3f3ecfe8658e1ebeddafd987b2';
export function certificateFingerprint(pem) {
    return crypto.createHash('sha256').update(Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64')).digest('hex');
}
if (certificateFingerprint(KEETA_ROOT_PEM) !== KEETA_ROOT_SHA256) throw new Error('Pinned Keeta root fingerprint mismatch');

// This reports cryptographic evidence only. It never emits a KYB-verified badge.
// Revocation is deliberately unknown until a supported status source is integrated.
export async function inspectCertificate({ account, certificate, intermediates = [], roots = [KEETA_ROOT_PEM], now = new Date() }) {
    const result = {
        status: 'unreadable', chainTrusted: false, accountMatches: false,
        withinValidity: false, credentialType: 'unknown', revocation: 'not_checked',
        kybVerified: false, checkedAt: now.toISOString()
    };
    try {
        const cert = new Certificate(certificate, { moment: now });
        result.fingerprint = certificateFingerprint(cert.toPEM());
        result.issuer = cert.issuer;
        result.validFrom = cert.notBefore.toISOString();
        result.validUntil = cert.notAfter.toISOString();
        result.accountMatches = cert.subjectPublicKey.publicKeyString.get() === account;
        result.withinValidity = cert.checkValid(now);
        const trustedRoots = new Set(roots.map(pem => new Certificate(pem, { moment: now })));
        const supplied = new Set(intermediates.map(pem => new Certificate(pem, { moment: now })));
        const chain = cert.verifyChain({ root: trustedRoots, intermediate: supplied });
        result.chainTrusted = Boolean(chain?.length);
        result.chainFingerprints = chain?.map(c => certificateFingerprint(c.toPEM())) || [];
        // Never decrypt sensitive attributes, expose identity details, or infer
        // business status from issuer names or the presence of encrypted fields.
        try {
            const identity = new IdentityCertificate(certificate, { moment: now });
            if (identity.attributes.entityType && !identity.attributes.entityType.sensitive) {
                const entity = await identity.getAttributeValue('entityType');
                const organization = Object.hasOwn(entity, 'organization');
                const person = Object.hasOwn(entity, 'person');
                result.credentialType = organization && !person ? 'organization'
                    : person && !organization ? 'person' : 'unknown';
            }
        } catch {
            // An unsupported identity extension must not discard valid base
            // certificate evidence. Keep classification explicitly unknown.
        }
        result.status = !result.accountMatches ? 'account_mismatch'
            : !result.withinValidity ? 'outside_validity'
            : !result.chainTrusted ? 'untrusted_chain'
            : 'trusted_chain';
        return result;
    } catch {
        // Clear partial successes if decoding/validation failed midway.
        return { ...result, status: 'unreadable', chainTrusted: false, kybVerified: false };
    }
}
