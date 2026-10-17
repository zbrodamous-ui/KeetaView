// Read-only operator tool; no account creation, signing, writes, or bulk scan.
import * as KeetaNet from '@keetanetwork/keetanet-client';
import { inspectCertificate } from './certificate-checker.js';
const account = process.argv[2];
try {
    if (!account || !account.startsWith('keeta_')) throw new Error('Usage: node indexer/check-certificates.js <full-account-address>');
    KeetaNet.lib.Account.fromPublicKeyString(account).assertAccount();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, options = {}) => originalFetch(input, {
        ...options, signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000)
    });
    const client = KeetaNet.Client.fromNetwork('main');
    const entries = await client.getAllCertificates(account);
    if (entries.length > 100) throw new Error('Too many certificates for this bounded inspection.');
    const reports = [];
    for (const entry of entries) reports.push(await inspectCertificate({
        account, certificate: entry.certificate.toPEM(),
        intermediates: entry.intermediates?.getCertificates().map(c => c.toPEM()) || []
    }));
    console.log(JSON.stringify({ account, network: 'mainnet', certificates: reports,
        note: 'Chain checks only. Revocation is not checked; no KYB verification claim. Empty results do not prove an account is personal.' }, null, 2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
