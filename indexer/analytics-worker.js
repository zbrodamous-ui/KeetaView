import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

// This read-only connection belongs exclusively to the analytics worker.
const database = new DatabaseSync(workerData.databaseFile, { readOnly: true });
try {
    database.exec('PRAGMA busy_timeout = 2000; PRAGMA query_only = ON;');
    database.aggregate('sum_bigint', {
        start: 0n,
        step: (total, value) => total + BigInt(value || 0),
        result: total => total.toString()
    });
    function readIndexerState() {
        try { return JSON.parse(fs.readFileSync(workerData.stateFile, 'utf8')); }
        catch { return {}; }
    }
    const blockSummary =
        database.prepare(`
            SELECT
                COUNT(*) AS blocks,
                COALESCE(
                    SUM(operation_count),
                    0
                ) AS operations,
                COALESCE(
                    AVG(operation_count),
                    0
                ) AS average_operations,
                MIN(timestamp) AS first_timestamp,
                MAX(timestamp) AS latest_timestamp
            FROM blocks
        `).get();

    const savedIndexerState =
        readIndexerState();

    const savedAccountTotal = Number(
        savedIndexerState?.accountsFound
    );
    const savedTransferTotal = Number(
        savedIndexerState?.transfersFound
    );

    const accountTotal =
        Number.isFinite(savedAccountTotal)
            ? savedAccountTotal
            : database.prepare(`
                SELECT COUNT(*) AS total
                FROM accounts
            `).get().total;

    const transferTotal =
        Number.isFinite(savedTransferTotal)
            ? savedTransferTotal
            : database.prepare(`
                SELECT COUNT(*) AS total
                FROM transfers
            `).get().total;

    const operationTotal =
        Number(blockSummary.operations);

    const topSenders =
        database.prepare(`
            SELECT
                sender AS address,
                COUNT(*) AS total
            FROM transfers
                INDEXED BY transfers_by_timestamp
            WHERE sender IS NOT NULL
                AND timestamp >= (
                    SELECT datetime(
                        MAX(timestamp),
                        '-24 hours'
                    )
                    FROM transfers
                )
            GROUP BY sender
            ORDER BY total DESC
            LIMIT 100
        `).all();

    const topRecipients =
        database.prepare(`
            SELECT
                recipient AS address,
                COUNT(*) AS total
            FROM transfers
                INDEXED BY transfers_by_timestamp
            WHERE recipient IS NOT NULL
                AND timestamp >= (
                    SELECT datetime(
                        MAX(timestamp),
                        '-24 hours'
                    )
                    FROM transfers
                )
            GROUP BY recipient
            ORDER BY total DESC
            LIMIT 100
        `).all();

    const tokenActivity =
        database.prepare(`
            SELECT
                token,
                COUNT(*) AS transfers,
                sum_bigint(amount) AS total_amount
            FROM transfers
                INDEXED BY transfers_by_timestamp
            WHERE token IS NOT NULL
                AND timestamp >= (
                    SELECT datetime(
                        MAX(timestamp),
                        '-24 hours'
                    )
                    FROM transfers
                )
            GROUP BY token
            ORDER BY transfers DESC
        `).all();

    const activityNewestFirst =
        database.prepare(`
            SELECT
                substr(timestamp, 1, 10) AS day,
                COUNT(*) AS transfers
            FROM transfers
                INDEXED BY transfers_by_timestamp
            WHERE timestamp >= (
                SELECT date(
                    MAX(timestamp),
                    '-13 days'
                )
                FROM transfers
            )
            GROUP BY day
            ORDER BY day DESC
            LIMIT 14
        `).all();

    const recentTransfers =
        database.prepare(`
            SELECT
                block_hash,
                operation_index,
                sender,
                recipient,
                token,
                amount,
                timestamp
            FROM transfers
            ORDER BY timestamp DESC
            LIMIT 100
        `).all();

    const anchorSummary =
        database.prepare(`
            SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT source_address) AS accounts,
                MAX(timestamp) AS latest_timestamp,
                SUM(signature_status = 'verified') AS verified,
                SUM(signature_status = 'unsigned') AS unsigned,
                SUM(signature_status = 'invalid') AS invalid,
                (SELECT COUNT(*) FROM anchor_inputs) AS relationships
            FROM anchors
        `).get();

    const anchorActivityNewestFirst =
        database.prepare(`
            SELECT
                day,
                COUNT(*) AS anchors
            FROM (
                SELECT
                    substr(
                        timestamp,
                        1,
                        10
                    ) AS day,
                    block_hash,
                    operation_index
                FROM anchors
                WHERE timestamp >= (
                    SELECT date(
                        MAX(timestamp),
                        '-13 days'
                    )
                    FROM anchors
                )
                GROUP BY
                    day,
                    block_hash,
                    operation_index
            )
            GROUP BY day
            ORDER BY day DESC
            LIMIT 14
        `).all();

    const recentAnchors =
        database.prepare(`
            SELECT
                anchors.block_hash,
                anchors.operation_index,
                anchors.source_address,
                anchors.signature_status,
                COUNT(anchor_inputs.input_index) AS relationships,
                anchors.timestamp
            FROM anchors
            LEFT JOIN anchor_inputs
                ON anchor_inputs.anchor_block_hash = anchors.block_hash
                AND anchor_inputs.anchor_operation_index = anchors.operation_index
            GROUP BY anchors.block_hash, anchors.operation_index
            ORDER BY anchors.timestamp DESC
            LIMIT 20
        `).all();

    const analyticsData = {
        summary: {
            blocks:
                blockSummary.blocks,
            operations:
                operationTotal,
            transfers:
                transferTotal,
            accounts:
                accountTotal,
            averageOperations:
                Number(
                    blockSummary
                        .average_operations
                ),
            firstTimestamp:
                blockSummary
                    .first_timestamp,
            latestTimestamp:
                blockSummary
                    .latest_timestamp
        },
        activity:
            activityNewestFirst
                .reverse(),
        topSenders,
        topRecipients,
        tokenActivity,
        recentTransfers,
        anchors: {
            summary: {
                total:
                    Number(
                        anchorSummary.total || 0
                    ),
                relationships:
                    Number(
                        anchorSummary.relationships || 0
                    ),
                accounts:
                    Number(
                        anchorSummary.accounts || 0
                    ),
                latestTimestamp:
                    anchorSummary.latest_timestamp,
                verified: Number(anchorSummary.verified || 0),
                unsigned: Number(anchorSummary.unsigned || 0),
                invalid: Number(anchorSummary.invalid || 0)
            },
            activity:
                anchorActivityNewestFirst
                    .reverse(),
            recent:
                recentAnchors
        }
    };


    parentPort.postMessage({ data: analyticsData });
} catch (error) {
    parentPort.postMessage({ error: error.message });
} finally {
    database.close();
}
