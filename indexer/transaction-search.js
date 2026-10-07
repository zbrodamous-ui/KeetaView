import { nameSearchCondition } from "./account-names.js";

const operationTypes = new Set([
    "SEND", "SET REP", "SET INFO", "MODIFY PERMISSIONS", "CREATE IDENTIFIER",
    "TOKEN ADMIN SUPPLY", "TOKEN ADMIN MODIFY BALANCE", "RECEIVE", "MANAGE CERTIFICATE", "OPERATION"
]);

export function transactionSearch(cache, query) {
    const nameMatch = nameSearchCondition(cache, query);
    const type = query.toUpperCase();
    const hasType = !query.includes("$") && operationTypes.has(type);
    const addresses = nameMatch.parameters.slice(0, nameMatch.parameters.length / 2);
    if (addresses.length || hasType) {
        const sources = [];
        const parameters = [];
        if (addresses.length) {
            const placeholders = addresses.map(() => "?").join(",");
            // Materialize matching row IDs via existing indexes. This prevents the
            // ORDER BY planner from scanning the entire timestamp index for names.
            sources.push(`SELECT rowid FROM operations INDEXED BY operations_by_sender
                WHERE sender IN (${placeholders})`);
            sources.push(`SELECT rowid FROM operations INDEXED BY operations_by_recipient
                WHERE recipient IN (${placeholders})`);
            parameters.push(...addresses, ...addresses);
        }
        if (hasType) {
            sources.push("SELECT rowid FROM operations INDEXED BY operations_by_type WHERE operation_type = ?");
            parameters.push(type);
        }
        return { sql: `operations.rowid IN (${sources.join(" UNION ")})`, parameters, empty: false };
    }
    // Partial/unknown names cannot match chain identifiers. Return immediately;
    // cache.search above may have queued an exact registered username locally.
    if (!query.startsWith("keeta_") && !/^[0-9a-f]{64}$/i.test(query)) {
        return { sql: "0", parameters: [], empty: true };
    }
    // Preserve the existing identifier search behavior.
    return {
        sql: `(operations.block_hash = ? OR operations.sender = ? OR operations.recipient = ?
            OR operations.token = ?)`,
        parameters: [query, query, query, query], empty: false
    };
}
