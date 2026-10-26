# Ordered account search rollout

The legacy cached-name search materializes every matching sender/recipient row ID, orders all matching history, then calculates a full count. For a busy account, its ordered-index scan is not enough: the final historical sort can exceed the request deadline.

The optional pageOnly=true request path resolves cached names/usernames locally and reads only the top offset+limit+1 operation keys per matched address and direction. Composite covering indexes provide timestamp DESC, block_hash DESC, operation_index ASC ordering. A bounded candidate merge deduplicates self-transfers and accounts sharing a name; full details and Anchor status are fetched only for the requested page plus one row. Chronological ordering and exact raw values are retained. Scope, address, operation-type and tiny-KTA predicates apply before per-branch limits.

The browser opts into page-only results for searches. With both indexes installed, cached-name searches return total:null, hasMore and chronological ordering rather than waiting for a full-history count. At most 100 matched addresses and offset 2,000 are supported in this path. Beyond that, the API explicitly asks the user to refine the search; it does not delete or silently truncate records. Other identifier/type searches and legacy requests retain their previous behavior. If either index is missing, the API falls back to its previous query, so deploying this code alone will NOT resolve the busy-account search timeout.

## First step: read-only preflight

Inside Railway SSH, from /app:

```bash
/mise/installs/node/24.21.0/bin/node indexer/prepare-account-search.mjs
```

This checks current index definitions and reports database size, available volume space and temporary-filesystem space. It does not create indexes or execute a historical search. Unexpected index definitions fail closed. Review the output before proceeding. Index build size/time are UNKNOWN; free space is not an estimate or proof of sufficient capacity.

## Manual maintenance build (separate operator action)

Do NOT run this as application startup or automatically during deployment. Arrange a maintenance window, verify a current backup, and pause every process writing the chain database, especially the indexer, without deleting the volume or resetting state. Confirm the API is served read-only if kept online. The --writers-paused flag is an operator acknowledgement, not automatic detection. The exact hosting procedure must be reviewed separately; this script does not stop processes.

Review both volume and SQLite temporary-file capacity. Select a reserve based on observed capacity and the maintenance plan; the tool cannot estimate index growth. A pre-check cannot enforce that reserve while SQLite builds the index. Monitor storage throughout the build. Index creation can hold the SQLite writer lock for a long time; leaving the indexer running could cause its writes to fail and restart services.

Only after that review, apply with an explicitly selected reserve:

```text
node indexer/prepare-account-search.mjs --apply --writers-paused --reserve-gib OPERATOR_SELECTED_NUMBER
```

Each index is built separately and atomically by SQLite. Progress prints before and after each build. The second build checks remaining free space again; a failed second build leaves the first installed and can be resumed. Existing indexed records are never deleted, archived, transformed or reinserted. The database grows because indexes are added. WAL mode is required and is not changed by this tool. There is no forced checkpoint, VACUUM or journal-mode conversion. This CLI has no query deadline for an index build.

After success, restore normal ingestion using its existing saved state, confirm both indexes are installed, check the username search and ordinary listing, and verify the queue health. A large account search should then read an ordered candidate set, but heavily restrictive filters, deep offsets and shared disk/CPU can still be expensive. Do not claim a complete performance fix until production is measured.
