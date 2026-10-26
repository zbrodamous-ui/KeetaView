import {DatabaseSync} from 'node:sqlite';
// One read-only query per subprocess. SQL travels over IPC, never command-line arguments.
process.once('message', ({databaseFile,sql,parameters,mode}) => {
 let db, message;
 try {
  db=new DatabaseSync(databaseFile,{readOnly:true});
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000');
  const statement=db.prepare(sql);
  message={result:mode==='get'?statement.get(...parameters):statement.all(...parameters)};
 } catch {
  message={error:'Indexed query temporarily unavailable.'};
 } finally {db?.close();}
 process.send(message, error => {
  if(process.connected)process.disconnect();
  process.exit(error?1:0);
 });
});
