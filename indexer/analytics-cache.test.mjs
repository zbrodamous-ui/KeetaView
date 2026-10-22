import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { createAnalyticsCache } from './analytics-cache.js';

const data = { summary: { blocks: 1 }, activity: [], topSenders: [], topRecipients: [], tokenActivity: [], recentTransfers: [] };
const fixtureWorker = code => new URL('data:text/javascript,' + encodeURIComponent(`import {parentPort} from 'node:worker_threads';${code}`));
async function until(fn) {
    const end = Date.now() + 10000;
    while (!(await fn())) {
        if (Date.now() > end) throw Error('Timed out waiting for worker');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

test('cold cache returns promptly, coalesces refreshes and persists the worker result', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kv-analytics-'));
    const cacheFile = path.join(dir, 'snapshot.json');
    const cache = createAnalyticsCache({ cacheFile, workerURL: fixtureWorker(`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);parentPort.postMessage({data:${JSON.stringify(data)}});`) });
    try {
        const pending = cache.get();
        const first = await Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(Error('Main thread blocked')), 150))]);
        assert.equal(first, null);
        assert.equal(cache.refreshing, true);
        for (let i=0; i<5; i++) assert.equal(await cache.get(), null);
        await until(() => !cache.refreshing);
        assert.equal((await cache.get()).data.summary.blocks, 1);
        assert.equal(JSON.parse(await fs.readFile(cacheFile, 'utf8')).data.summary.blocks, 1);
    } finally { await cache.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('restart serves persisted stale data; failed refresh retains it and backs off', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kv-analytics-'));
    const cacheFile = path.join(dir, 'snapshot.json');
    const saved = { createdAt: Date.now()-1000000, data };
    await fs.writeFile(cacheFile, JSON.stringify(saved));
    const errors=[];
    const cache = createAnalyticsCache({cacheFile, workerURL:fixtureWorker(`throw Error('fixture failure')`), onError:e=>errors.push(e.message)});
    try {
        assert.deepEqual(await cache.get(),saved);
        await until(()=>!cache.refreshing);
        assert.match(errors[0], /fixture failure/);
        assert.deepEqual(await cache.get(),saved);
        assert.equal(cache.refreshing,false);
        assert.deepEqual(JSON.parse(await fs.readFile(cacheFile,'utf8')),saved);
    } finally { await cache.close(); await fs.rm(dir,{recursive:true,force:true}); }
});

test('real read-only analytics worker preserves raw amount precision and response shape', async () => {
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kv-analytics-'));
    const databaseFile=path.join(dir,'chain.db'), stateFile=path.join(dir,'state.json');
    const db=new DatabaseSync(databaseFile);
    db.exec(`CREATE TABLE blocks(hash TEXT, timestamp TEXT, operation_count INTEGER);
        CREATE TABLE accounts(address TEXT);
        CREATE TABLE transfers(block_hash TEXT, operation_index INTEGER,sender TEXT,recipient TEXT,token TEXT,amount TEXT,timestamp TEXT);
        CREATE INDEX transfers_by_timestamp ON transfers(timestamp);
        CREATE TABLE anchors(block_hash TEXT,operation_index INTEGER,source_address TEXT,signature_status TEXT,timestamp TEXT);
        CREATE TABLE anchor_inputs(anchor_block_hash TEXT,anchor_operation_index INTEGER,input_index INTEGER);
        INSERT INTO blocks VALUES('block','2026-10-22T12:00:00Z',2);
        INSERT INTO accounts VALUES('sender');
        INSERT INTO transfers VALUES('block',0,'sender','recipient','token','900719925474099312345','2026-10-22T12:00:00Z');
        INSERT INTO transfers VALUES('block',1,'sender','recipient','token','1','2026-10-22T12:00:00Z');`);
    db.close();
    await fs.writeFile(stateFile,JSON.stringify({accountsFound:1,transfersFound:2}));
    try {
        const worker=new Worker(new URL('./analytics-worker.js',import.meta.url),{workerData:{databaseFile,stateFile}});
        const report=await new Promise((resolve,reject)=>{worker.on('message',resolve);worker.on('error',reject);});
        assert.equal(report.error,undefined);
        assert.equal(report.data.tokenActivity[0].total_amount,'900719925474099312346');
        assert.equal(report.data.summary.transfers,2);
        assert.equal(report.data.summary.operations,2);
        assert.equal(report.data.topSenders[0].total,2);
        assert.equal(report.data.recentTransfers.length,2);
        await new Promise(resolve=>worker.on('exit',resolve));
        const check=new DatabaseSync(databaseFile,{readOnly:true});
        assert.equal(check.prepare('SELECT COUNT(*) AS n FROM transfers').get().n,2);check.close();
    } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
