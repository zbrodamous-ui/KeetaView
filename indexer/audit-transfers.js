// Operator-only audit: no network calls and no database mutations.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AUDIT_QUERY = `
    WITH batch AS MATERIALIZED (
        SELECT id, block_hash, operation_index, sender, recipient, token, amount
        FROM transfers
        WHERE id < ?
        ORDER BY id DESC
        LIMIT ?
    )
    SELECT batch.*, o.operation_type
    FROM batch
    LEFT JOIN operations o
      ON o.block_hash = batch.block_hash
     AND o.operation_index = batch.operation_index
    ORDER BY batch.id DESC`;

function integer(value, name, min, max) {
    if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) ||
        Number(value) < min || Number(value) > max) {
        throw new Error(`${name} must be an integer from ${min} to ${max}.`);
    }
    return Number(value);
}

export function auditTransfers(database, { before = Number.MAX_SAFE_INTEGER,
    limit = 1000, samples = 10 } = {}) {
    before = integer(before, 'before', 1, Number.MAX_SAFE_INTEGER);
    limit = integer(limit, 'limit', 1, 10000);
    samples = integer(samples, 'samples', 0, 20);
    const rows = database.prepare(AUDIT_QUERY).all(before, limit);
    const counts = { eligibleSend: 0, nonSend: 0, missingOperation: 0, incompleteSend: 0 };
    const examples = { nonSend: [], missingOperation: [], incompleteSend: [] };
    const operationTypes = Object.create(null);
    for (const row of rows) {
        const missingFields = ['sender', 'recipient', 'token', 'amount']
            .filter(field => row[field] === null || row[field] === undefined || row[field] === '');
        const invalidAmount = !/^\d+$/.test(row.amount ?? '');
        let category;
        if (row.operation_type === null) category = 'missingOperation';
        else if (row.operation_type !== 'SEND') category = 'nonSend';
        else if (missingFields.length || invalidAmount) category = 'incompleteSend';
        else category = 'eligibleSend';
        counts[category]++;
        const type = row.operation_type ?? '(missing operation)';
        operationTypes[type] = (Object.hasOwn(operationTypes, type) ? operationTypes[type] : 0) + 1;
        if (examples[category]?.length < samples) {
            examples[category].push({ id: row.id, blockHash: row.block_hash,
                operationIndex: row.operation_index, operationType: row.operation_type,
                missingFields, invalidAmount });
        }
    }
    return {
        readOnly: true,
        scope: 'One bounded batch of indexed transfer rows; not a complete database or blockchain audit.',
        before, limit, checked: rows.length,
        nextBefore: rows.length === limit ? rows.at(-1).id : null,
        counts, operationTypes, examples,
        note: 'Categories describe stored evidence only. Missing operations require investigation; no rows are deleted or marked for automatic deletion. Eligible SEND rows are not independently verified against the network.'
    };
}

export function parseAuditArgs(args) {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        const name = args[i];
        if (!['--before', '--limit', '--samples'].includes(name) || args[i + 1] === undefined || Object.hasOwn(options, name.slice(2))) {
            throw new Error('Usage: node indexer/audit-transfers.js [--before ID] [--limit 1–10000] [--samples 0–20]');
        }
        options[name.slice(2)] = args[i + 1];
    }
    return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let database;
    try {
        const options = parseAuditArgs(process.argv.slice(2));
        const databaseFile = path.join(process.env.KEETAVIEW_DATA_DIR || './indexer', 'keetascan.db');
        database = new DatabaseSync(databaseFile, { readOnly: true });
        database.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;');
        console.log(JSON.stringify(auditTransfers(database, options), null, 2));
    } catch (error) {
        console.error('Transfer audit failed:', error.message);
        process.exitCode = 1;
    } finally {
        database?.close();
    }
}
