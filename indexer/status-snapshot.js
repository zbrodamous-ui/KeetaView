export const validStatusData = data => data &&
    ['blocks', 'accounts', 'transfers', 'operations', 'assets', 'anchors', 'databaseBytes', 'averageOperations']
        .every(key => typeof data[key] === 'number' && Number.isFinite(data[key]) && data[key] >= 0) &&
    ['firstTimestamp', 'latestTimestamp'].every(key => data[key] === null || typeof data[key] === 'string');
