import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {SEARCH_INDEXES} from './account-search-page.js';
export function inspectIndexes(db) {
 return SEARCH_INDEXES.map(index=>{
  const actual=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").get(index.name)?.sql;
  if(actual && actual.replace(/\s+/g,' ').trim().toLowerCase()!==index.sql.toLowerCase())throw Error(`Unexpected definition for ${index.name}; separate review required`);
  return {name:index.name,installed:!!actual};
 });
}
export function buildIndexes(db,{hasSpace,onProgress=()=>{}}) {
 const indexes=inspectIndexes(db);
 if(db.prepare('PRAGMA journal_mode').get().journal_mode!=='wal')throw Error('WAL mode is required; this tool will not change journal mode');
 db.exec('PRAGMA busy_timeout=1000');
 for(const [i,index] of SEARCH_INDEXES.entries()){
  if(indexes[i].installed)continue;
  if(!hasSpace())throw Error('Available space is below the operator-selected reserve');
  onProgress({building:index.name});
  db.exec(index.sql);
  onProgress({completed:index.name});
 }
 return inspectIndexes(db);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let db;
 try {
  const args=process.argv.slice(2);const apply=args[0]==='--apply';
  if(args.length && !(apply && args.length===4 && args[1]==='--writers-paused' && args[2]==='--reserve-gib' && /^\d+(\.\d+)?$/.test(args[3]) && Number(args[3])>=1))throw Error('Preview: no arguments. Build only after pausing chain writers: --apply --writers-paused --reserve-gib NUMBER (at least 1)');
  const file=path.join(process.env.KEETAVIEW_DATA_DIR||'./indexer','keetascan.db');
  if(!fs.existsSync(file))throw Error('Database not found');
  const available=directory=>{const stats=fs.statfsSync(directory);return stats.bavail*stats.bsize;};
  const tempDirectory=process.env.SQLITE_TMPDIR || os.tmpdir();
  const space=()=>Math.min(available(path.dirname(file)),available(tempDirectory));
  db=new DatabaseSync(file,{readOnly:!apply});
  console.log(JSON.stringify({readOnly:!apply,databaseBytes:fs.statSync(file).size,availableBytes:available(path.dirname(file)),temporaryAvailableBytes:available(tempDirectory),indexes:inspectIndexes(db),note:'Index build size and duration are unknown. Review capacity and schedule a maintenance window before applying.'},null,2));
  if(apply){const reserve=Number(args[3])*1024**3;console.log(JSON.stringify(buildIndexes(db,{hasSpace:()=>space()>=reserve,onProgress:event=>console.log(JSON.stringify(event))}),null,2));}
 }catch(error){console.error(error.message);process.exitCode=1;}finally{db?.close();}
}
