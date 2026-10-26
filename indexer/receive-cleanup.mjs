import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function integer(value, max) {
 if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error('Invalid batch boundary or limit');
 return value;
}
const batchSQL = `SELECT * FROM transfers WHERE id < ? ORDER BY id DESC LIMIT ?`;
function eligible(db,row) {
 if (row.recipient !== null && row.recipient !== '') return false;
 const ops=db.prepare('SELECT operation_type FROM operations WHERE block_hash=? AND operation_index=?').all(row.block_hash,row.operation_index);
 return ops.length === 1 && ops[0].operation_type === 'RECEIVE';
}
export function preview(db,{before,limit=1000}) {
 integer(before,Number.MAX_SAFE_INTEGER);integer(limit,1000);
 db.exec('PRAGMA busy_timeout=1000; BEGIN');
 try {
  const batch=db.prepare(batchSQL).all(before,limit);
  const rows=batch.filter(row=>eligible(db,row));
  const plan={version:1,before,limit,checked:batch.length,nextBefore:batch.length===limit?batch.at(-1).id:null,rows};
  db.exec('ROLLBACK');
  return {...plan,sha256:digest(plan)};
 } catch(error){db.exec('ROLLBACK');throw error;}
}
export function apply(db,plan,confirmation) {
 const {sha256,...payload}=plan;
 if (!/^[a-f0-9]{64}$/.test(sha256 || '') || confirmation!==sha256 || digest(payload)!==sha256) throw new Error('Plan digest and explicit confirmation must match');
 if(payload.version!==1)throw new Error('Unsupported plan');
 integer(payload.before,Number.MAX_SAFE_INTEGER);integer(payload.limit,1000);
 if(!Array.isArray(payload.rows)||payload.rows.length>payload.limit)throw new Error('Invalid plan rows');
 const ids=new Set();
 for(const row of payload.rows){integer(row.id,Number.MAX_SAFE_INTEGER);if(row.id>=payload.before||ids.has(row.id))throw new Error('Invalid or duplicate row ID');ids.add(row.id);}
 db.exec('PRAGMA busy_timeout=1000; BEGIN IMMEDIATE');
 try {
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='transfers'").all().length)throw new Error('Transfer triggers require separate review');
  // Validate every record before making any change; fail closed on drift.
  for(const row of payload.rows){
   const current=db.prepare('SELECT * FROM transfers WHERE id=?').get(row.id);
   if(!current || digest(current)!==digest(row) || !eligible(db,current))throw new Error(`Evidence changed for ${row.id}`);
  }
  if(payload.rows.length){
   db.exec('CREATE TABLE IF NOT EXISTS reviewed_transfer_archive_v1 (transfer_id INTEGER PRIMARY KEY, archived_at TEXT NOT NULL, reason TEXT NOT NULL, row_json TEXT NOT NULL)');
   const save=db.prepare('INSERT INTO reviewed_transfer_archive_v1 VALUES(?,?,?,?)');
   const remove=db.prepare('DELETE FROM transfers WHERE id=? AND block_hash=? AND operation_index=?');
   const at=new Date().toISOString();
   for(const row of payload.rows){
    save.run(row.id,at,`Reviewed RECEIVE cleanup plan ${sha256}`,JSON.stringify(row));
    if(remove.run(row.id,row.block_hash,row.operation_index).changes!==1)throw new Error('Unexpected deletion count');
   }
  }
  db.exec('COMMIT');return {applied:true,archived:ids.size,deleted:ids.size,operationsChanged:0,sha256};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let db;
 try{
  const args=process.argv.slice(2), mode=args.shift();
  const options={};
  while(args.length){const flag=args.shift();if(!['--before','--limit','--plan','--confirm'].includes(flag)||Object.hasOwn(options,flag)||!args.length)throw new Error('Invalid arguments');options[flag]=args.shift();}
  if(mode!=='preview'&&mode!=='apply')throw new Error('Use preview --before ID [--limit 1000], or apply --plan FILE --confirm SHA256');
  const applying=mode==='apply';
  if(applying ? !options['--plan']||!options['--confirm']||options['--before']||options['--limit'] : !options['--before']||options['--plan']||options['--confirm'])throw new Error('Invalid arguments for mode');
  const numeric=value=>{if(!/^\d+$/.test(value))throw new Error('Expected integer');return Number(value);};
  const databaseFile=path.join(process.env.KEETAVIEW_DATA_DIR||'./indexer','keetascan.db');
  if(!fs.existsSync(databaseFile))throw new Error('Database does not exist');
  db=new DatabaseSync(databaseFile,{readOnly:!applying});if(!applying)db.exec('PRAGMA query_only=ON');
  const result=applying?apply(db,JSON.parse(fs.readFileSync(options['--plan'],'utf8')),options['--confirm']):preview(db,{before:numeric(options['--before']),limit:numeric(options['--limit']||'1000')});
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}finally{db?.close();}
}
