# Read-only transfer audit

Run inside the deployed service, from `/app`, using its existing `KEETAVIEW_DATA_DIR`. This script is an operator tool, not a public API route. It opens the existing chain database read-only, enables query-only mode, and never calls the network or changes rows.

Start small while observing site responsiveness:

```sh
node indexer/audit-transfers.js --limit 1000 --samples 5
```

The query selects at most 1,000 transfers by descending primary-key ID, then joins that bounded set against the operations primary key. The maximum allowed batch is 10,000. This is not a full-table count or scan. Samples are limited to 20 per suspicious category and show operation identifiers and field-presence flags, not amounts or account addresses.

- `eligibleSend`: stored operation is SEND and required transfer fields/unsigned integer amount are present. Zero and arbitrarily large integer strings are accepted. This is not independent chain verification.
- `nonSend`: a matching stored operation exists with a type other than SEND, including RECEIVE and balance adjustments.
- `missingOperation`: the matching operation is absent. Treat as unresolved, not proof that a transfer is invalid.
- `incompleteSend`: stored SEND has missing required fields or a malformed raw amount.

Counts apply only to the selected batch and are mutually exclusive. `operationTypes` shows the stored type distribution. When `nextBefore` is non-null, manually inspect the next batch using that exact value:

```sh
node indexer/audit-transfers.js --before 123456 --limit 1000 --samples 5
```

Replace `123456` with the returned cursor. Stop when `nextBefore` is null. A full batch at the end can produce one final empty page. IDs are index-local; this is not chronological pagination or a frozen database snapshot. Do not loop through the whole production database while investigating load problems.

This tool provides evidence for planning a future repair. It does not create backups, quarantine data, or delete rows. Confirm the SEND-only indexer is deployed and take a verified backup before considering a separate repair procedure.

Tests: `node --test indexer/audit-transfers.test.mjs`.
