import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createReadQueryPool} from './read-query-pool.js';
const fixtureDirectories=[];
const fixture=code=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kv-child-fixture-'));fixtureDirectories.push(dir);
 const file=path.join(dir,'worker.mjs');
 fs.writeFileSync(file,`process.once('message',workerData=>{const parentPort={postMessage:result=>process.send(result,()=>process.exit(0))};${code}});`);
 return file;
};
test.after(()=>{for(const dir of fixtureDirectories)fs.rmSync(dir,{recursive:true,force:true});});
test('worker reads preserve exact values and refuse writes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kv-query-')),databaseFile=path.join(dir,'chain.db');const db=new DatabaseSync(databaseFile);db.exec("CREATE TABLE evidence(amount TEXT); INSERT INTO evidence VALUES('900719925474099312345')");db.close();const pool=createReadQueryPool({databaseFile});
 try{assert.deepEqual(await pool.query('SELECT amount FROM evidence'),[{amount:'900719925474099312345'}]);await assert.rejects(pool.query('DELETE FROM evidence'));assert.equal((await pool.query('SELECT COUNT(*) n FROM evidence',[],'get')).n,1);}finally{await pool.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('concurrency and queue are bounded while main loop remains responsive',async()=>{
 const pool=createReadQueryPool({concurrency:1,maxQueue:1,workerURL:fixture("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);parentPort.postMessage({result:workerData.sql})")});
 try{const one=pool.query('one'),two=pool.query('two');assert.equal(pool.running,1);assert.equal(pool.pending,1);await assert.rejects(pool.query('three'),/busy/);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(pool.running,1);assert.deepEqual(await Promise.all([one,two]),['one','two']);}finally{await pool.close();}
});
test('deadline includes queue time and close rejects queued and active work',async()=>{
 const pool=createReadQueryPool({concurrency:1,maxQueue:2,timeoutMs:1000,workerURL:fixture("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);parentPort.postMessage({result:1})")});
 try{const active=pool.query('one');const queued=pool.query('two',[],'all',Date.now()+30);await assert.rejects(queued,/too long/);assert.equal(pool.pending,0);const rejected=assert.rejects(active,/closing/);await pool.close();await rejected;await assert.rejects(pool.query('later'),/closing/);}finally{await pool.close();}
});
test('timeout rejects slow work and later tasks recover after worker exits',async()=>{
 const pool=createReadQueryPool({concurrency:1,maxQueue:1,timeoutMs:500,workerURL:fixture("if(workerData.sql==='slow')Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1000);parentPort.postMessage({result:1})")});
 try{await assert.rejects(pool.query('slow'),/too long/);const end=Date.now()+3000;while(pool.running){if(Date.now()>end)throw Error('worker did not exit');await new Promise(r=>setTimeout(r,10));}assert.equal(await pool.query('fast',[],'all',Date.now()+1000),1);}finally{await pool.close();}
});

test('native recursive SQL is forcibly stopped and its slot recovers',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kv-native-')),databaseFile=path.join(dir,'chain.db');const db=new DatabaseSync(databaseFile);db.exec('CREATE TABLE evidence(value TEXT);');db.close();
 const diagnostics=[];const pool=createReadQueryPool({databaseFile,concurrency:1,timeoutMs:500,onDiagnostic:event=>diagnostics.push(event)});
 try{
  await assert.rejects(pool.query('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT SUM(x) FROM n'),/too long/);
  const end=Date.now()+3000;while(pool.running){if(Date.now()>end)throw Error('Native SQL process remained alive');await new Promise(r=>setTimeout(r,10));}
  assert.equal((await pool.query('SELECT 1 AS ok',[],'get')).ok,1);assert.equal(diagnostics[0].phase,'running');
 }finally{await pool.close();fs.rmSync(dir,{recursive:true,force:true});}
});
