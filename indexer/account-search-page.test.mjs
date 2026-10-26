import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {accountSearchPage,SEARCH_INDEXES} from './account-search-page.js';
import {inspectIndexes,buildIndexes} from './prepare-account-search.mjs';
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE operations(block_hash TEXT,operation_index INTEGER,operation_type TEXT,sender TEXT,recipient TEXT,token TEXT,amount TEXT,timestamp TEXT,details_json TEXT,PRIMARY KEY(block_hash,operation_index)); CREATE TABLE anchors(block_hash TEXT,operation_index INTEGER,signature_status TEXT,PRIMARY KEY(block_hash,operation_index)); CREATE TABLE transfers(block_hash TEXT,operation_index INTEGER,PRIMARY KEY(block_hash,operation_index));`);
 const add=db.prepare('INSERT INTO operations VALUES(?,0,?,?,?,?,?,?,?)');
 for(let i=0;i<2000;i++){
  const hash=String(i).padStart(8,'0');
  add.run(hash,i%2?'SEND':'RECEIVE',i%3?'alice':'other',i%5?'bob':'alice','token','900719925474099312345',i%7===0?null:`2026-10-${String(1+i%24).padStart(2,'0')}`,'{}');
  if(i%2===0)db.prepare('INSERT INTO transfers VALUES(?,0)').run(hash);
  if(i%3===0)db.prepare("INSERT INTO anchors VALUES(?,0,'verified')").run(hash);
 }
 for(const index of SEARCH_INDEXES)db.exec(index.sql);
 return db;
}
test('ordered account pages match full chronological results, including self sends and duplicate-name accounts',()=>{
 const db=fixture();try{
  const expected=db.prepare("SELECT block_hash,operation_index FROM operations WHERE sender IN ('alice','bob') OR recipient IN ('alice','bob') ORDER BY timestamp DESC,block_hash DESC,operation_index ASC").all();
  const actual=[];
  for(let offset=0;offset<expected.length;offset+=100){
   const p=accountSearchPage({addresses:['alice','bob'],limit:100,offset});const rows=db.prepare(p.sql).all(...p.parameters);
   actual.push(...rows.slice(0,100).map(({block_hash,operation_index})=>({block_hash,operation_index})));
   if(rows.length)assert.equal(rows[0].amount,'900719925474099312345');
  }
  assert.deepEqual(actual,expected.map(row=>({...row})));assert.equal(new Set(actual.map(r=>r.block_hash)).size,actual.length);
 }finally{db.close();}
});
test('scope and parameterized filters run before branch limits; plans use covering ordered indexes',()=>{
 const db=fixture();try{
  const p=accountSearchPage({addresses:['alice'],limit:20,conditions:['operations.operation_type=?'],parameters:['RECEIVE'],transfersOnly:true,anchorsOnly:true,anchorStatus:'verified'});
  const rows=db.prepare(p.sql).all(...p.parameters);
  const expected=db.prepare(`SELECT operations.block_hash FROM operations WHERE (sender='alice' OR recipient='alice') AND operation_type='RECEIVE' AND EXISTS(SELECT 1 FROM transfers t WHERE t.block_hash=operations.block_hash AND t.operation_index=operations.operation_index) AND EXISTS(SELECT 1 FROM anchors a WHERE a.block_hash=operations.block_hash AND a.operation_index=operations.operation_index AND a.signature_status='verified') ORDER BY timestamp DESC,block_hash DESC,operation_index ASC LIMIT 21`).all();
  assert.deepEqual(rows.map(r=>r.block_hash),expected.map(r=>r.block_hash));
  const plain=accountSearchPage({addresses:['alice'],limit:20});
  const plainPlan=db.prepare('EXPLAIN QUERY PLAN '+plain.sql).all(...plain.parameters);
  assert.ok(plainPlan.some(r=>r.detail.includes('COVERING INDEX operations_by_sender_recent')));
  assert.ok(plainPlan.some(r=>r.detail.includes('COVERING INDEX operations_by_recipient_recent')));
  const plan=db.prepare('EXPLAIN QUERY PLAN '+p.sql).all(...p.parameters);
  assert.ok(plan.some(r=>r.detail.includes('INDEX operations_by_sender_recent')));
  assert.ok(plan.some(r=>r.detail.includes('INDEX operations_by_recipient_recent')));
  assert.ok(plan.every(r=>!/^SCAN operations/.test(r.detail)),JSON.stringify(plan));
  assert.throws(()=>accountSearchPage({addresses:['alice'],limit:20,offset:2001}),/Refine/);
 }finally{db.close();}
});
test('index preflight is read-only; unexpected existing definitions are rejected',()=>{
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE operations(sender TEXT,recipient TEXT,timestamp TEXT,block_hash TEXT,operation_index INTEGER)');
 assert.ok(inspectIndexes(db).every(i=>!i.installed));assert.throws(()=>buildIndexes(db,{hasSpace:()=>true}),/WAL/);
 db.exec('CREATE INDEX operations_by_sender_recent ON operations(sender)');assert.throws(()=>inspectIndexes(db),/Unexpected definition/);db.close();
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('manual index build preserves records, refuses low reserve and is resumable',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kv-index-build-'));const db=new DatabaseSync(path.join(dir,'chain.db'));
 try{
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE operations(sender TEXT,recipient TEXT,timestamp TEXT,block_hash TEXT,operation_index INTEGER,amount TEXT); INSERT INTO operations VALUES('a','b','2026-10-26','hash',1,'900719925474099312345')");
  const before=db.prepare('SELECT * FROM operations').all();
  assert.throws(()=>buildIndexes(db,{hasSpace:()=>false}),/reserve/);
  assert.ok(inspectIndexes(db).every(i=>!i.installed));
  let checks=0;assert.throws(()=>buildIndexes(db,{hasSpace:()=>++checks===1}),/reserve/);
  assert.equal(inspectIndexes(db)[0].installed,true);assert.equal(inspectIndexes(db)[1].installed,false);
  assert.ok(buildIndexes(db,{hasSpace:()=>true}).every(i=>i.installed));
  assert.deepEqual(db.prepare('SELECT * FROM operations').all(),before);
  assert.ok(buildIndexes(db,{hasSpace:()=>false}).every(i=>i.installed));
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});
