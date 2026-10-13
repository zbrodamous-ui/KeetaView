import path from 'node:path';
import fs from 'node:fs';
import { openDeveloperKeys } from './developer-api.js';
const dir = process.env.KEETAVIEW_DATA_DIR || './indexer';
fs.mkdirSync(dir,{recursive:true});
const keys = openDeveloperKeys(path.join(dir,'developer-api.db'));
try {
    const [command, value] = process.argv.slice(2);
    if (command === 'create' && value?.trim() && value.length<=100) console.log(JSON.stringify(keys.create(value.trim())));
    else if (command === 'list') console.log(JSON.stringify(keys.list()));
    else if (command === 'revoke' && value) console.log(JSON.stringify({ revoked:keys.revoke(value) }));
    else { console.error('Usage: node indexer/api-keys.js create "label" | list | revoke <id>'); process.exitCode=1; }
} finally { keys.close(); }
