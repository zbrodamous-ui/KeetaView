import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Fixed manifest from the reviewed 2,000-row production audit.
export const manifest = [
 [59874099,'FBA45640A04EFC0317431E133D9A2532D5839B322BAED56EA2E08087825714C8',1],
 [59873343,'5CCFA37E1C783685DD6893FC37F94A129CFF23E7BA94BA34B55CD852946FA451',2],
 [59873333,'8680407E8DB7A99F38FD887F3E22D7D7430BE90AADC83F81CA84A5DC8F7CE923',1],
 [59873310,'BE41DAA03D4F4F179959E0374F89EE59236A4F5E70A20B2193EB4397E4E7F074',2],
 [59872879,'E4260A53AFCF04EE7AEC3F2EC0C9E99C8448F6656D0C6FFE7EC9CF68B840B7A6',1]
];
export function cleanup(db, { apply = false } = {}) {
 db.exec('PRAGMA busy_timeout=1000');
 db.exec(apply ? 'BEGIN IMMEDIATE' : 'BEGIN');
 try {
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='transfers'").all();
  if (triggers.length) throw new Error('Transfer triggers require separate review');
  const rows = manifest.map(([id, hash, index]) => {
   const row = db.prepare('SELECT * FROM transfers WHERE id=?').get(id);
   if (!row || row.block_hash !== hash || row.operation_index !== index || (row.recipient !== null && row.recipient !== '')) throw new Error(`Transfer ${id} differs from reviewed evidence`);
   const ops = db.prepare('SELECT operation_type FROM operations WHERE block_hash=? AND operation_index=?').all(hash,index);
   if (ops.length !== 1 || ops[0].operation_type !== 'RECEIVE') throw new Error(`Operation for ${id} is not exactly one RECEIVE`);
   return row;
  });
  if (apply) {
   db.exec('CREATE TABLE IF NOT EXISTS reviewed_transfer_archive_v1 (transfer_id INTEGER PRIMARY KEY, archived_at TEXT NOT NULL, reason TEXT NOT NULL, row_json TEXT NOT NULL)');
   const archive = db.prepare('INSERT INTO reviewed_transfer_archive_v1 VALUES(?,?,?,?)');
   const remove = db.prepare('DELETE FROM transfers WHERE id=? AND block_hash=? AND operation_index=?');
   const at = new Date().toISOString();
   for (const row of rows) {
    archive.run(row.id,at,'Reviewed RECEIVE row excluded from SEND transfer listing',JSON.stringify(row));
    const removed = remove.run(row.id,row.block_hash,row.operation_index);
    if (removed.changes !== 1) throw new Error('Unexpected deletion count');
   }
  }
  db.exec(apply ? 'COMMIT' : 'ROLLBACK');
  return { applied: apply, reviewedIds: rows.map(r=>r.id), archived: apply ? rows.length : 0, deleted: apply ? rows.length : 0, operationsChanged: 0 };
 } catch (error) { db.exec('ROLLBACK'); throw error; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 let db;
 try {
  const args=process.argv.slice(2);
  if (args.length && !(args.length===1 && args[0]==='--apply-reviewed-five')) throw new Error('Only optional argument: --apply-reviewed-five');
  const apply=args.length===1;
  db=new DatabaseSync(path.join(process.env.KEETAVIEW_DATA_DIR || './indexer','keetascan.db'),{readOnly:!apply});
  if (!apply) db.exec('PRAGMA query_only=ON');
  console.log(JSON.stringify(cleanup(db,{apply}),null,2));
 } catch(error) { console.error(error.message); process.exitCode=1; }
 finally { db?.close(); }
}
