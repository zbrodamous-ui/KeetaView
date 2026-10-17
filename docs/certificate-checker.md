# Certificate inspection foundation

Run from the deployed service or a local checkout with Node 24 and dependencies installed:

```sh
node indexer/check-certificates.js <full-keeta-account-address>
```

This operator command only reads mainnet account certificates. It never signs or publishes a transaction, reads private profiles, decrypts sensitive fields, or scans the account index. It does not expose a public endpoint or change business listings.

## Trust anchor

The pinned certificate is `indexer/certificates/keeta-root.pem`, supplied by rkeene in Keeta's developers channel on October 16, 2026 and matched byte-for-byte to the CA advertised by mainnet service discovery's `Keeta KYB` provider.

Subject: `Keeta Network KYC Root CA`

SHA-256 of certificate DER: `1e9eee1d84b7729e99c93a9f1f6365e09421cb3f3ecfe8658e1ebeddafd987b2`

Rkeene clarified on October 17 that anyone may attach certificates to the network, and certificates issued by Keeta chain to the supplied root. A carried self-signed certificate is not automatically trusted. Root changes require independent confirmation and a reviewed pin update, not automatic trust in fetched metadata or issuer display names. The root name includes KYC and does not by itself establish that a leaf is KYB.

## Output and limits

The checker uses the installed Keeta SDK to verify chain signatures, CA constraints and dates, and separately checks the leaf validity period and subject key against the requested account. It reports certificate fingerprints, issuer, dates, account binding and chain trust. A plain `entityType` attribute can distinguish organization/person; encrypted or missing attributes remain unknown. No identity attributes are output. For an untrusted chain, any reported credential type is only an untrusted claim.

`trusted_chain` means these cryptographic checks succeeded against the configured root. **It does not mean currently KYB verified.** `revocation` is always `not_checked`, and `kybVerified` is always false. No supported revocation/status integration has yet been established. Revocation, credential-purpose semantics and a genuine production KYB positive example are still required before a badge is appropriate. Do not infer a personal account from no certificates, or a business name from a tag.

The CLI fixes the root to the Keeta pin. The inspection helper accepts `roots` only for explicit trust-store configuration and isolated synthetic tests; never populate it from untrusted certificate bundles.

The lrtech01 sample supplied during investigation chains to a different self-signed `KYB Anchor CA`. It is a negative trust test, not a verified business listing and not evidence of fraud.

## Validation

Synthetic tests exercise direct trust rules, an intermediate chain, missing intermediates, carried untrusted roots, incorrect account binding, expired/future leaves, tampered signatures, malformed input, and plain versus encrypted entity types. Real network reads are operator checks, not test dependencies.
