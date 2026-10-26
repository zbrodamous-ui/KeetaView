# Bounded RECEIVE transfer cleanup

This maintenance CLI is never run by application startup. It only considers a batch of at most 1,000 transfer rows below an explicit ID boundary. It selects rows with an absent recipient and exactly one matching stored RECEIVE operation. Missing operations, SEND rows, other operation types, and populated recipients are left alone. This is stored database evidence, not independent blockchain verification.

Run inside the production container, from /app. Review a current backup before applying changes. Preview mode opens the database read-only. Save the plan outside the public web root, preferably on the persistent data volume:

```bash
node indexer/receive-cleanup.mjs preview --before 59872489 --limit 1000 > "$KEETAVIEW_DATA_DIR/receive-plan.json"
cat "$KEETAVIEW_DATA_DIR/receive-plan.json"
```

Only use that location if KEETAVIEW_DATA_DIR is set to the persistent data directory. Otherwise choose an explicit private file path. Plans contain the complete selected public transfer records, including exact raw amount strings. Do not commit generated plans to Git. Review the row IDs, operation evidence and sha256. The nextBefore field advances through examined rows, even if none qualify; it is not a historical coverage guarantee. Do not loop automatically over the database.

Apply one reviewed plan explicitly, replacing REVIEWED_SHA256 with its actual digest:

```bash
node indexer/receive-cleanup.mjs apply --plan "$KEETAVIEW_DATA_DIR/receive-plan.json" --confirm REVIEWED_SHA256
```

Apply takes one short write transaction with a 1-second busy timeout. It rejects transfer-table triggers and rechecks full row contents, operation type and missing recipient before any changes. It archives full records into reviewed_transfer_archive_v1, then deletes only their exact transfer IDs and operation identities. An archive collision, stale plan or any failure rolls back the transaction. A successful plan cannot be applied twice. The digest binds confirmation to the reviewed content; it is not an authentication signature. Keep plans from trusted operators only.

Operations, blocks, accounts and assets are not modified. Cached analytics and state-file totals are not recalculated by this tool and may temporarily retain earlier counts. No VACUUM, full-table scan, automatic batch loop or network request runs. This does not reclaim database file space or complete historical cleanup. Verify the applied IDs and rerun a bounded audit afterward. Archives retain row_json for a separately reviewed restoration; there is no automatic restore command.
