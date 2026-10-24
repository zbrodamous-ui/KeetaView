import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
function element(){return {value:'',disabled:false,children:[],addEventListener(){},setAttribute(){},removeAttribute(){},appendChild(x){this.children.push(x);},append(){},replaceChildren(){}};}
test('Blocks renders rows while status totals remain pending',async()=>{
 const source=fs.readFileSync(new URL('../blocks.js',import.meta.url),'utf8'),els=new Map();let resolveStatus;
 const context=vm.createContext({document:{getElementById:id=>{if(!els.has(id))els.set(id,element());return els.get(id);},createElement:element},fetchKeetaView:url=>url==='/api/status'?new Promise(r=>resolveStatus=r):Promise.resolve({ok:true,json:async()=>[{hash:'block',timestamp:'now',operation_count:2}]}),timeAgo:()=> 'now',console});
 vm.runInContext(source.replace(/loadBlocksPage\(\);\s*$/,''),context);
 await context.loadBlocksPage();assert.equal(els.get('blocksPageList').children.length,1);assert.match(els.get('blockResultCount').textContent,/Total unavailable/);
 resolveStatus({ok:true,json:async()=>({blocks:30})});await new Promise(r=>setImmediate(r));assert.match(els.get('blockResultCount').textContent,/of 30/);
});
test('Transactions renders raw indexed rows without waiting for metadata',async()=>{
 const source=fs.readFileSync(new URL('../transactions.js',import.meta.url),'utf8'),start=source.indexOf('let operationsLoadGeneration ='),end=source.indexOf('\ntransactionFilter.addEventListener(',start);let renders=0;
 const context=vm.createContext({currentPage:1,rowsPerPage:20,transactionFilter:element(),transactionFilterClear:element(),transactionsPageList:element(),transactionResultCount:element(),pageNumber:element(),previousPageButton:element(),nextPageButton:element(),transactionScope:{value:'all'},anchorStatus:{value:'all'},hideTinyKta:{checked:false},fetchKeetaView:async()=>({ok:true,json:async()=>({total:null,hasMore:false,operations:[{amount:'900719925474099312345',token:'token'}]})}),prepareOperation:()=>new Promise(()=>{}),renderCurrentPage:()=>renders++,shortValue:v=>v,URLSearchParams,console,loadedOperations:[],totalOperations:0,filteredPagination:false});
 vm.runInContext(source.slice(start,end),context);await context.loadOperationsPage();assert.equal(renders,1);assert.match(context.loadedOperations[0].displayAmount,/raw units/);assert.equal(context.transactionFilterClear.disabled,false);
});
test('default operation listing returns rows even when block aggregates are unavailable',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kv-directory-'));const db=new DatabaseSync(path.join(directory,'keetascan.db'));
 const source=fs.readFileSync(new URL('./indexer.js',import.meta.url),'utf8');for(const match of source.matchAll(/database\.exec\(`([\s\S]*?)`\);/g)){if(/CREATE TABLE|CREATE INDEX/.test(match[1]))db.exec(match[1]);}
 db.prepare("INSERT INTO operations(block_hash,operation_index,operation_type,sender,timestamp,details_json) VALUES('block',0,'SEND','sender','2026-10-24','{}')").run();db.exec('DROP TABLE blocks');db.close();
 const child=spawn(process.execPath,['indexer/server.js'],{env:{...process.env,KEETAVIEW_DATA_DIR:directory,PORT:'31990',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 try{const end=Date.now()+10000;while(!logs.includes('KeetaView running at')){if(Date.now()>end)throw Error(logs);await new Promise(r=>setTimeout(r,10));}const r=await fetch('http://127.0.0.1:31990/api/operations?limit=1&offset=0');assert.equal(r.status,200);const payload=await r.json();assert.equal(payload.operations.length,1);assert.equal(payload.total,null);assert.equal(payload.hasMore,false);}finally{const done=once(child,'exit');child.kill('SIGTERM');await done;fs.rmSync(directory,{recursive:true,force:true});}
});
