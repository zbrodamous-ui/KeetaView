import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
const {databaseFile,sql,parameters,mode}=workerData;
let db;
try {
 db=new DatabaseSync(databaseFile,{readOnly:true});
 db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000');
 const statement=db.prepare(sql);
 const result=mode==='get'?statement.get(...parameters):statement.all(...parameters);
 parentPort.postMessage({result});
} catch {
 // SQL and supplied search parameters must not appear in logs or responses.
 parentPort.postMessage({error:'Indexed query temporarily unavailable.'});
} finally {db?.close();}
