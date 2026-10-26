import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createAnalyticsCache} from './analytics-cache.js';
import {validStatusData} from './status-snapshot.js';
const data={blocks:1,accounts:2,transfers:3,operations:4,assets:1,anchors:0,databaseBytes:1,averageOperations:4,firstTimestamp:'2026-10-24',latestTimestamp:'2026-10-24'};
async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out');}
test('status cache serves stale data while a slow refresh runs, and rejects analytics-shaped snapshots',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kv-status-')),cacheFile=path.join(dir,'cache.json');
 await fs.writeFile(cacheFile,JSON.stringify({createdAt:Date.now()-60000,data}));
 const workerURL=new URL('data:text/javascript,'+encodeURIComponent(`import {parentPort} from 'node:worker_threads';Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);parentPort.postMessage({data:${JSON.stringify({...data,blocks:2})}})`));
 const cache=createAnalyticsCache({cacheFile,workerURL,validateData:validStatusData,refreshMs:30000});
 try{const result=await Promise.race([cache.get(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Blocked')),150))]);assert.equal(result.data.blocks,1);assert.equal(cache.refreshing,true);await until(()=>!cache.refreshing);assert.equal((await cache.get()).data.blocks,2);assert.equal(validStatusData({summary:{}}),false);}finally{await cache.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('status worker preserves endpoint fields and uses persisted state or database fallback',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kv-status-'));const databaseFile=path.join(dir,'keetascan.db'),stateFile=path.join(dir,'state.json');
 const db=new DatabaseSync(databaseFile);db.exec("CREATE TABLE blocks(timestamp TEXT,operation_count INTEGER); INSERT INTO blocks VALUES('2026-10-24',4); CREATE TABLE accounts(address TEXT); INSERT INTO accounts VALUES('a'); CREATE TABLE transfers(id INTEGER); INSERT INTO transfers VALUES(1); CREATE TABLE assets(token TEXT); CREATE TABLE anchors(id INTEGER);");db.close();
 async function collect(){const w=new Worker(new URL('./status-worker.js',import.meta.url),{workerData:{databaseFile,stateFile}});const done=once(w,'exit');const [r]=await once(w,'message');await done;assert.equal(r.error,undefined);return r.data;}
 try{let r=await collect();assert.equal(r.accounts,1);assert.equal(r.transfers,1);assert.equal(r.operations,4);assert.equal(validStatusData(r),true);await fs.writeFile(stateFile,JSON.stringify({accountsFound:8,transfersFound:9}));r=await collect();assert.equal(r.accounts,8);assert.equal(r.transfers,9);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('database route errors return 503 without killing API; health remains available',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'kv-health-'));const db=new DatabaseSync(path.join(dir,'keetascan.db'));db.close();
 const child=spawn(process.execPath,['indexer/server.js'],{env:{...process.env,KEETAVIEW_DATA_DIR:dir,PORT:'31989',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 try{await until(()=>logs.includes('KeetaView running at'));const failed=await fetch('http://127.0.0.1:31989/api/blocks?secret=never-log-this');assert.equal(failed.status,503);assert.ok(failed.headers.get('x-request-id'));const health=await fetch('http://127.0.0.1:31989/api/health');assert.equal(health.status,200);const healthBody=await health.json();assert.equal(healthBody.api,'up');assert.equal(healthBody.queries.listing.running,0);assert.equal(logs.includes('never-log-this'),false);assert.match(logs,/api_request_failed/);}finally{const done=once(child,'exit');child.kill('SIGTERM');await done;await fs.rm(dir,{recursive:true,force:true});}
});
