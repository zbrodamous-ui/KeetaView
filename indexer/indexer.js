import fs from "fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
    decodeAnchorPayload
} from "./anchor.js";
import * as KeetaNet from "@keetanetwork/keetanet-client";

const client =
    KeetaNet.Client.fromNetwork("main");

const dataDirectory =
    process.env.KEETAVIEW_DATA_DIR ||
    "./indexer";

fs.mkdirSync(
    dataDirectory,
    {
        recursive: true
    }
);

const stateFile =
    path.join(
        dataDirectory,
        "state.json"
    );

const databaseFile =
    path.join(
        dataDirectory,
        "keetascan.db"
    );

const databaseResetId =
    process.env.KEETAVIEW_DATABASE_RESET || "";

const databaseResetMarker =
    path.join(
        dataDirectory,
        "database-reset-marker.txt"
    );

const previousDatabaseResetId =
    fs.existsSync(databaseResetMarker)
        ? fs.readFileSync(
            databaseResetMarker,
            "utf8"
        ).trim()
        : "";

if (
    databaseResetId &&
    databaseResetId !== previousDatabaseResetId
) {
    console.warn(
        "Performing requested KeetaView database reset:",
        databaseResetId
    );

    for (
        const file of [
            databaseFile,
            `${databaseFile}-wal`,
            `${databaseFile}-shm`,
            stateFile
        ]
    ) {
        if (fs.existsSync(file)) {
            fs.unlinkSync(file);
        }
    }

    fs.writeFileSync(
        databaseResetMarker,
        databaseResetId
    );

    console.log(
        "KeetaView database reset completed."
    );
}

const databaseAlreadyExisted =
    fs.existsSync(databaseFile);

const database =
    new DatabaseSync(databaseFile);

const operationsTableAlreadyExisted =
    Boolean(
        database.prepare(`
            SELECT 1
            FROM sqlite_master
            WHERE type = 'table'
              AND name = 'operations'
            LIMIT 1
        `).get()
    );

database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA wal_autocheckpoint = 1000;
    PRAGMA journal_size_limit = 67108864;
`);

    database.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
        hash TEXT PRIMARY KEY,
        timestamp TEXT,
        operation_count INTEGER
    )
`);
database.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
        address TEXT PRIMARY KEY,
        first_seen_timestamp TEXT NOT NULL
    )
`);
database.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        block_hash TEXT NOT NULL,
        operation_index INTEGER NOT NULL,
        sender TEXT,
        recipient TEXT,
        token TEXT,
        amount TEXT,
        timestamp TEXT NOT NULL,
        UNIQUE(block_hash, operation_index)
    )
`);

database.exec(`
    CREATE TABLE IF NOT EXISTS operations (
        block_hash TEXT NOT NULL,
        operation_index INTEGER NOT NULL,
        operation_type TEXT NOT NULL,
        sender TEXT,
        recipient TEXT,
        token TEXT,
        amount TEXT,
        timestamp TEXT NOT NULL,
        details_json TEXT,
        PRIMARY KEY (block_hash, operation_index)
    )
`);

database.exec(`
    DROP TABLE IF EXISTS anchor_references;

    CREATE TABLE IF NOT EXISTS anchor_inputs (
        anchor_block_hash TEXT NOT NULL,
        anchor_operation_index INTEGER NOT NULL,
        input_index INTEGER NOT NULL,
        source_address TEXT NOT NULL,
        anchor_transaction_id TEXT,
        referenced_block_hash TEXT NOT NULL,
        referenced_operation_index INTEGER,
        payload_version INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        PRIMARY KEY (
            anchor_block_hash,
            anchor_operation_index,
            source_address,
            input_index
        )
    )
`);

database.exec(`
    CREATE INDEX IF NOT EXISTS
        blocks_by_timestamp
    ON blocks(timestamp);

    CREATE INDEX IF NOT EXISTS
        accounts_by_first_seen_timestamp
    ON accounts(first_seen_timestamp);

    CREATE INDEX IF NOT EXISTS
        transfers_by_timestamp
    ON transfers(timestamp);

    CREATE INDEX IF NOT EXISTS
        transfers_by_sender
    ON transfers(sender);

    CREATE INDEX IF NOT EXISTS
        transfers_by_recipient
    ON transfers(recipient);

    CREATE INDEX IF NOT EXISTS
        transfers_by_token
    ON transfers(token);

    CREATE INDEX IF NOT EXISTS
        operations_by_timestamp
    ON operations(timestamp);

    CREATE INDEX IF NOT EXISTS
        operations_by_type
    ON operations(operation_type);

    CREATE INDEX IF NOT EXISTS
        operations_by_sender
    ON operations(sender);

    CREATE INDEX IF NOT EXISTS
        operations_by_recipient
    ON operations(recipient);

           CREATE INDEX IF NOT EXISTS
        anchor_inputs_by_reference
    ON anchor_inputs(
        referenced_block_hash,
        referenced_operation_index
    );

    CREATE INDEX IF NOT EXISTS
        anchor_inputs_by_source
    ON anchor_inputs(source_address);
`);

function getFileSize(file) {
    try {
        return fs.statSync(file).size;
    } catch (error) {
        if (error.code === "ENOENT") {
            return 0;
        }

        throw error;
    }
}

function reportDatabaseStorage() {
    const databaseBytes =
        getFileSize(databaseFile);

    const walBytes =
        getFileSize(`${databaseFile}-wal`);

    const sharedMemoryBytes =
        getFileSize(`${databaseFile}-shm`);

    const totalBytes =
        databaseBytes +
        walBytes +
        sharedMemoryBytes;

    const bytesToMegabytes =
        (bytes) =>
            Number(
                (
                    bytes /
                    1024 /
                    1024
                ).toFixed(2)
            );

    console.log(
        "Database storage:",
        {
            databaseMB:
                bytesToMegabytes(
                    databaseBytes
                ),
            walMB:
                bytesToMegabytes(
                    walBytes
                ),
            sharedMemoryMB:
                bytesToMegabytes(
                    sharedMemoryBytes
                ),
            totalMB:
                bytesToMegabytes(
                    totalBytes
                )
        }
    );
}

function checkpointDatabase() {
    try {
        const result = database
            .prepare("PRAGMA wal_checkpoint(TRUNCATE)")
            .get();

        if (result.busy > 0) {
            console.warn(
                "Database checkpoint postponed because the database is busy."
            );

            return;
        }

        console.log(
            "Database WAL checkpoint completed.",
            result
        );

        reportDatabaseStorage();

    } catch (error) {
        console.error(
            "Database WAL checkpoint failed:",
            error
        );
    }
}

checkpointDatabase();

const insertBlock =
    database.prepare(`
        INSERT OR REPLACE INTO blocks (
            hash,
            timestamp,
            operation_count
        )
        VALUES (?, ?, ?)
    `);

    const insertAccount =
    database.prepare(`
        INSERT INTO accounts (
    address,
    first_seen_timestamp
)
VALUES (?, ?)
ON CONFLICT(address) DO UPDATE SET
    first_seen_timestamp = MIN(
        accounts.first_seen_timestamp,
        excluded.first_seen_timestamp
    )
    `);

    const insertTransfer =
    database.prepare(`
        INSERT OR REPLACE INTO transfers (
            block_hash,
            operation_index,
            sender,
            recipient,
            token,
            amount,
            timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertOperation =
    database.prepare(`
        INSERT OR REPLACE INTO operations (
            block_hash,
            operation_index,
            operation_type,
            sender,
            recipient,
            token,
            amount,
            timestamp,
            details_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

const insertAnchorInput =
    database.prepare(`
        INSERT OR REPLACE INTO anchor_inputs (
            anchor_block_hash,
            anchor_operation_index,
            input_index,
            source_address,
            anchor_transaction_id,
            referenced_block_hash,
            referenced_operation_index,
            payload_version,
            timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

const selectHistoricalAnchorOperations =
    database.prepare(`
        SELECT
            rowid AS operation_rowid,
            block_hash,
            operation_index,
            timestamp,
            details_json
        FROM operations
        WHERE rowid > ?
        ORDER BY rowid
        LIMIT ?
    `);

    const countAccounts =
    database.prepare(`
        SELECT COUNT(*) AS total
        FROM accounts
    `);

const countTransfers =
    database.prepare(`
        SELECT COUNT(*) AS total
        FROM transfers
    `);

console.log("KeetaView Indexer starting...");

async function testConnection() {
    const maximumAttempts = 5;

    for (
        let attempt = 1;
        attempt <= maximumAttempts;
        attempt++
    ) {
        try {
            const status =
                await client.getNetworkStatus();

            const blockCounts =
                status
                    .map(
                        (node) =>
                            node?.ledger?.blockCount
                    )
                    .filter(
                        (blockCount) =>
                            Number.isFinite(blockCount)
                    );

            if (blockCounts.length === 0) {
                throw new Error(
                    "No valid block counts were returned."
                );
            }

            const latestBlock =
                Math.max(...blockCounts);

            console.log(
                "Keeta latest block:",
                latestBlock
            );

            console.log(
                "KeetaView indexed through:",
                state.lastIndexedBlockHash
            );

            return true;
        } catch (error) {
            console.warn(
                `Keeta connection check failed (attempt ${attempt} of ${maximumAttempts}):`,
                error
            );

            if (attempt < maximumAttempts) {
                await new Promise(
                    (resolve) =>
                        setTimeout(
                            resolve,
                            attempt * 2000
                        )
                );
            }
        }
    }

    console.warn(
        "Keeta connection check remains unavailable; continuing so the service stays online."
    );

    return false;
}
async function testHistoryFetch() {
    const batchStart =
        performance.now();

   const history =
    await client.getHistory(
        null,
        {
            startBlocksHash:
            state.historyCursor ||
            undefined,
            depth: 50
        }
    );
    if (history.length === 0) {
    console.log(
        "No more history entries."
    );

    return false;
}
       const lastVoteStaple =
    history[history.length - 1].voteStaple;

    const nextHistoryCursor =
    lastVoteStaple.blocksHash.toString();

    state.historyCursor =
    nextHistoryCursor;

console.log(
    "Next history cursor:",
    nextHistoryCursor
);

for (const entry of history) {
    await processHistoryEntry(entry);
}

fs.writeFileSync(
    stateFile,
    JSON.stringify(state, null, 2)
);

checkpointDatabase();

console.log(
    "Indexer progress saved."
);
console.log(
    "History entries:",
    history.length
);

console.log(
    "Accounts discovered:",
    state.accountsFound
);
console.log(
    "Transfers discovered:",
    state.transfersFound
);
const batchEnd =
    performance.now();

console.log(
    "Batch time:",
    `${((batchEnd - batchStart) / 1000).toFixed(2)} seconds`
);
return true;
}


async function refreshLatestHistory() {
    const refreshStart =
        performance.now();

    const history =
        await client.getHistory(
            null,
            {
                depth: 100
            }
        );

    if (history.length === 0) {
        console.log(
            "No latest history entries were returned."
        );

        return false;
    }

    const orderedHistory =
        [...history].sort(
            (first, second) =>
                first.voteStaple.timestamp() -
                second.voteStaple.timestamp()
        );

    for (const entry of orderedHistory) {
        await processHistoryEntry(entry);
    }

    const newestEntry =
        orderedHistory[
            orderedHistory.length - 1
        ];

    const newestBlocks =
        newestEntry.voteStaple.blocks;

    const newestBlock =
        newestBlocks[
            newestBlocks.length - 1
        ];

    if (newestBlock?.hash) {
        state.lastIndexedBlockHash =
            newestBlock.hash.toString();
    }

    state.lastTipRefreshAt =
        new Date().toISOString();

    fs.writeFileSync(
        stateFile,
        JSON.stringify(state, null, 2)
    );

    console.log(
        "Latest network history refreshed.",
        {
            entries: history.length,
            latestTimestamp:
                newestEntry.voteStaple
                    .timestamp()
                    .toISOString(),
            milliseconds:
                Math.round(
                    performance.now() -
                    refreshStart
                )
        }
    );

    return true;
}

function getOperationType(operation) {
    const constructorName =
        operation?.constructor?.name || "Operation";

    const normalizedName =
        constructorName
            .replace(/^.*BlockOperation/, "")
            .replace(/_/g, " ")
            .trim();

    return normalizedName || "Operation";
}

function serializeOperation(operation) {
    const seen = new WeakSet();

    function normalize(value, depth = 0) {
        if (
            value === null ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
        ) {
            return value;
        }

        if (typeof value === "bigint") {
            return value.toString();
        }

        if (typeof value === "undefined") {
            return null;
        }

        if (value instanceof Date) {
            return value.toISOString();
        }

        if (value instanceof Uint8Array) {
            return Buffer.from(value).toString("hex");
        }

        if (typeof value !== "object") {
            return String(value);
        }

        if (seen.has(value)) {
            return "[Circular]";
        }

        if (depth >= 5) {
            return value.toString?.() || "[Object]";
        }

        seen.add(value);

        if (Array.isArray(value)) {
            return value.map(
                (item) => normalize(item, depth + 1)
            );
        }

        const normalized = {};

        for (const key of Object.keys(value)) {
            try {
                normalized[key] =
                    normalize(value[key], depth + 1);
            } catch {
                normalized[key] =
                    "[Unavailable]";
            }
        }

        return normalized;
    }

    try {
        return JSON.stringify(normalize(operation));
    } catch (error) {
        console.warn(
            "Unable to serialize operation details:",
            error
        );

        return null;
    }
}

function getAnchorTransactionId(anchorMetadata) {
    for (const field of ["t", "p", "d"]) {
        if (typeof anchorMetadata?.[field] === "string") {
            return anchorMetadata[field];
        }
    }

    return null;
}

function storeAnchorInputs(
    anchorBlockHash,
    anchorOperationIndex,
    timestamp,
    anchorPayload
) {
    if (
        !anchorPayload ||
        !Array.isArray(anchorPayload.i)
    ) {
        return 0;
    }

    let inserted = 0;

    for (
        const [
            sourceAddress,
            anchorMetadata
        ] of Object.entries(anchorPayload.a)
    ) {
        for (
            const [inputIndex, input]
            of anchorPayload.i.entries()
        ) {
            if (
                typeof input?.h !== "string" ||
                (
                    input.o !== undefined &&
                    !Number.isInteger(input.o)
                )
            ) {
                continue;
            }

            insertAnchorInput.run(
                anchorBlockHash,
                anchorOperationIndex,
                inputIndex,
                sourceAddress,
                getAnchorTransactionId(
                    anchorMetadata
                ),
                input.h,
                input.o ?? null,
                anchorPayload.v,
                timestamp
            );

            inserted += 1;
        }
    }

    return inserted;
}

async function processHistoryEntry(entry) {
    const blocks =
        entry.voteStaple.blocks;

const newestBlock =
    blocks[blocks.length - 1];

    const timestamp =
    entry.voteStaple
        .timestamp()
        .toISOString();

    for (const block of blocks) {

           insertBlock.run(
        block.hash.toString(),
        timestamp,
        block.operations.length
    );
        const sender =
            block.account
                ?.publicKeyString
                ?.toString?.();

        if (sender) {


           insertAccount.run(
                sender,
                timestamp
            );
        }

       for (
    const [operationIndex, operation]
    of block.operations.entries()
) {
            const recipient =
                operation.to
                    ?.publicKeyString
                    ?.toString?.();

                    const token =
    operation.token
        ?.publicKeyString
        ?.toString?.();

      const operationBlockHash =
    block.hash.toString();

const operationDetails =
    serializeOperation(operation);

insertOperation.run(
    operationBlockHash,
    operationIndex,
    getOperationType(operation),
    sender || null,
    recipient || null,
    token || null,
    operation.amount?.toString?.() || null,
    timestamp,
    operationDetails
);

let external = null;

try {
    external =
        JSON.parse(
            operationDetails
        )?.external;
} catch {
    external = null;
}

const anchorPayload =
    decodeAnchorPayload(external);

storeAnchorInputs(
    operationBlockHash,
    operationIndex,
    timestamp,
    anchorPayload
);

            if (recipient) {


                insertAccount.run(
                    recipient,
                    timestamp
                );
            }

           if (
    token &&
    operation.amount &&
    block.hash
) {
    insertTransfer.run(
        block.hash.toString(),
        operationIndex,
        sender || null,
        recipient || null,
        token,
        operation.amount.toString(),
        timestamp
    );

}
        }
    }

state.accountsFound =
    Number(
        countAccounts.get().total
    );

delete state.discoveredAccounts;

state.transfersFound =
    Number(
        countTransfers.get().total
    );

    if (newestBlock?.hash) {
    state.lastIndexedBlockHash =
        newestBlock.hash.toString();
}
}

function backfillHistoricalAnchorInputs(
    batchSize = 10_000
) {
    if (state.anchorInputBackfillComplete) {
        return;
    }

    const cursor =
        Number(
            state.anchorInputBackfillCursor
        ) || 0;

    const operations =
        selectHistoricalAnchorOperations.all(
            cursor,
            batchSize
        );

    let nextCursor = cursor;
    let inserted = 0;

    for (const operation of operations) {
        nextCursor =
            Number(operation.operation_rowid);

        let external = null;

        try {
            external =
                JSON.parse(
                    operation.details_json
                )?.external;
        } catch {
            continue;
        }

        inserted +=
            storeAnchorInputs(
                operation.block_hash,
                operation.operation_index,
                operation.timestamp,
                decodeAnchorPayload(external)
            );
    }

    state.anchorInputBackfillCursor =
        nextCursor;

    if (operations.length < batchSize) {
        state.anchorInputBackfillComplete =
            true;
    }

    fs.writeFileSync(
        stateFile,
        JSON.stringify(state, null, 2)
    );

    console.log(
        "Historical Anchor input backfill batch completed.",
        {
            operationsScanned:
                operations.length,
            relationshipsStored:
                inserted,
            cursor:
                state.anchorInputBackfillCursor,
            complete:
                state.anchorInputBackfillComplete
        }
    );
}

let state;

if (fs.existsSync(stateFile)) {
    state =
        JSON.parse(
            fs.readFileSync(
                stateFile,
                "utf8"
            )
        );

    console.log(
        "Existing indexer state loaded."
    );
} else {
    state = {
        historyCursor: null,
        lastIndexedBlockHash: null,
        accountsFound: 0,
        transfersFound: 0
    };

    console.log(
    "Indexer totals:",
    {
        accountsFound:
            state.accountsFound,
        transfersFound:
            state.transfersFound
    }
);

}

    if (
        databaseAlreadyExisted &&
        !operationsTableAlreadyExisted
    ) {
        console.log(
            "New operations index detected. Restarting historical cursor for complete operation coverage."
        );

        state.historyCursor = null;
    }

    if (!databaseAlreadyExisted) {
    console.log(
        "New database detected. Resetting index position."
    );

    state.historyCursor = null;
    state.lastIndexedBlockHash = null;
    state.accountsFound = 0;
    state.transfersFound = 0;
    state.anchorInputBackfillCursor = 0;
    state.anchorInputBackfillComplete = true;

}

fs.writeFileSync(
    stateFile,
    JSON.stringify(state, null, 2)
);

console.log(
    "Indexer state saved."
);
console.log(
    "Indexer totals:",
    {
        accountsFound:
            state.accountsFound,
        transfersFound:
            state.transfersFound
    }
);

await testConnection();

const watchMode =
    process.argv.includes("--watch");

const requestedBatchCount =
    Number(
        process.argv.find(
            (argument) =>
                /^\d+$/.test(argument)
        )
    );

const batchesToIndex =
    Number.isInteger(requestedBatchCount) &&
    requestedBatchCount >= 0
        ? requestedBatchCount
        : 5;

await refreshLatestHistory();

for (
    let batchNumber = 1;
    batchNumber <= batchesToIndex;
    batchNumber++
) {
    console.log(
        `Backfilling batch ${batchNumber} of ${batchesToIndex}...`
    );

    try {
        const historyFound =
            await testHistoryFetch();

        if (!historyFound) {
            console.log(
                "Indexer reached the end of historical data."
            );

            break;
        }
    } catch (error) {
        console.error(
            `Backfill batch ${batchNumber} failed. Progress was preserved; the batch can be retried later:`,
            error
        );

        break;
    }
}

if (watchMode) {
    const refreshInterval =
        60 * 1000;

    const requestedBackfillIntervalMinutes =
        Number(
            process.env
                .HISTORICAL_BACKFILL_INTERVAL_MINUTES ??
            10
        );

    const backfillIntervalMinutes =
        Number.isFinite(
            requestedBackfillIntervalMinutes
        ) &&
        requestedBackfillIntervalMinutes >= 1
            ? requestedBackfillIntervalMinutes
            : 10;

    const historicalBackfillInterval =
        backfillIntervalMinutes *
        60 *
        1000;

    const historicalBackfillEnabled =
        process.env.HISTORICAL_BACKFILL === "true";

    let historicalBackfillComplete =
        !historicalBackfillEnabled;

    let lastHistoricalBackfillAt = 0;

    console.log(
        "Live indexer is watching for new history every 60 seconds."
    );

    if (historicalBackfillEnabled) {
        console.log(
            `Historical backfill enabled: one batch every ${backfillIntervalMinutes} minutes.`
        );
    } else {
        console.log(
            "Historical backfill is disabled."
        );
    }

    while (true) {
        await new Promise(
            (resolve) =>
                setTimeout(
                    resolve,
                    refreshInterval
                )
        );

        try {
            await refreshLatestHistory();
        } catch (error) {
            console.error(
                "Latest history refresh failed:",
                error
            );
        }

        try {
            backfillHistoricalAnchorInputs();
        } catch (error) {
            console.error(
                "Historical Anchor input backfill failed:",
                error
            );
        }

        const historicalBackfillDue =
            Date.now() -
                lastHistoricalBackfillAt >=
            historicalBackfillInterval;

        if (
            !historicalBackfillComplete &&
            historicalBackfillDue
        ) {
            lastHistoricalBackfillAt =
                Date.now();

            try {
                console.log(
                    "Running one controlled historical backfill batch..."
                );

                const historyFound =
                    await testHistoryFetch();

                if (!historyFound) {
                    historicalBackfillComplete =
                        true;

                    console.log(
                        "Historical backfill is complete."
                    );
                }
            } catch (error) {
                console.error(
                    "Historical backfill failed:",
                    error
                );
            }
        }
    }
}


database.close();
process.exit(0);
