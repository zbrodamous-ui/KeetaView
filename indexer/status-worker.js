import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const { databaseFile, stateFile } = workerData;
const database = new DatabaseSync(databaseFile, { readOnly: true });
function readIndexerState() {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); }
    catch { return null; }
}
function collectStatus() {
                const blockSummary =
                    database.prepare(`
                        SELECT
                            COUNT(*) AS total,
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

                const indexerState =
                    readIndexerState();

                const accounts =
                    Number.isFinite(
                        Number(indexerState?.accountsFound)
                    )
                        ? Number(indexerState.accountsFound)
                        : database.prepare(`
                            SELECT COUNT(*) AS total
                            FROM accounts
                        `).get().total;

                const transfers =
                    Number.isFinite(
                        Number(indexerState?.transfersFound)
                    )
                        ? Number(indexerState.transfersFound)
                        : database.prepare(`
                            SELECT COUNT(*) AS total
                            FROM transfers
                        `).get().total;

                const operations =
                    Number(blockSummary.operations);

                const assets =
                    database.prepare(`
                        SELECT COUNT(*) AS total
                        FROM assets
                    `).get().total;

                const anchors =
                    database.prepare(`
                        SELECT COUNT(*) AS total
                        FROM anchors
                    `).get().total;

                const databaseBytes = [
                    databaseFile,
                    `${databaseFile}-wal`,
                    `${databaseFile}-shm`
                ].reduce(
                    (total, file) =>
                        total + (
                            fs.existsSync(file)
                                ? fs.statSync(file).size
                                : 0
                        ),
                    0
                );

                let historicalBackfill = null;

                try {
                    const savedBackfill =
                        indexerState?.historicalBackfill;

                    if (savedBackfill) {
                        const startedAt =
                            Date.parse(
                                savedBackfill.startedAt
                            );

                        const elapsedHours =
                            Number.isFinite(startedAt)
                                ? Math.max(
                                    (Date.now() - startedAt) /
                                        3_600_000,
                                    0
                                )
                                : 0;

                        const blocksAdded =
                            Number(
                                savedBackfill.blocksAdded
                            ) || 0;

                        const bytesAdded =
                            Number(
                                savedBackfill.bytesAdded
                            ) || 0;

                        historicalBackfill = {
                            ...savedBackfill,
                            blocksPerHour:
                                elapsedHours > 0
                                    ? blocksAdded / elapsedHours
                                    : 0,
                            storageBytesPerHour:
                                elapsedHours > 0
                                    ? bytesAdded / elapsedHours
                                    : 0
                        };
                    }
                } catch (error) {
                    console.warn(
                        "Could not read historical backfill status:",
                        error
                    );
                }

                return (
                    {
                        blocks:
                            blockSummary.total,
                        accounts,
                        transfers,
                        operations,
                        assets,
                        anchors,
                        databaseBytes,
                        historicalBackfill,
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
                    }
                );

}
try {
    database.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000');
    parentPort.postMessage({ data: collectStatus() });
} catch (error) {
    parentPort.postMessage({ error: error.message });
} finally {
    database.close();
}
