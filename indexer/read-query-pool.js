import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export function createReadQueryPool({databaseFile,concurrency=2,maxQueue=8,timeoutMs=8000,workerURL=new URL('./read-query-worker.js',import.meta.url),onDiagnostic=event=>console.warn(JSON.stringify(event))}) {
 const active=new Set(),queue=[];
 let closed=false;
 function stats(){return {running:active.size,pending:queue.length,oldestMs:active.size?Math.max(...[...active].map(job=>Date.now()-job.started)):0};}
 function settle(job,error,result){if(job.settled)return;job.settled=true;clearTimeout(job.timer);error?job.reject(error):job.resolve(result);}
 function pump(){
  while(!closed && active.size<concurrency && queue.length){
   const job=queue.shift();if(job.settled)continue;
   let child;
   try{child=fork(workerURL instanceof URL?fileURLToPath(workerURL):workerURL,[],{execArgv:[],stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced'});}catch{settle(job,Error('Indexed query temporarily unavailable.'));continue;}
   job.child=child;job.started=Date.now();active.add(job);
   let result,received=false,failure;
   job.done=new Promise(resolve=>child.once('close',(code)=>{
    active.delete(job);
    settle(job,failure || (code!==0 || !received?Error('Indexed query temporarily unavailable.'):null),result);
    resolve();pump();
   }));
   child.on('message',message=>{if(message.error)failure=Error('Indexed query temporarily unavailable.');else{received=true;result=message.result;}});
   child.on('error',()=>{failure=Error('Indexed query temporarily unavailable.');});
   child.send({databaseFile,...job.task},error=>{if(error){failure=Error('Indexed query temporarily unavailable.');child.kill('SIGKILL');}});
  }
 }
 return {
  query(sql,parameters=[],mode='all',deadline=Date.now()+timeoutMs){
   if(Date.now()>=deadline)return Promise.reject(Error('Search deadline exceeded.'));
   if(closed)return Promise.reject(Error('Query service is closing.'));
   if(!['all','get'].includes(mode))return Promise.reject(Error('Invalid query mode.'));
   if(active.size>=concurrency && queue.length>=maxQueue)return Promise.reject(Error('Search is busy. Please retry shortly.'));
   return new Promise((resolve,reject)=>{
    const job={task:{sql,parameters,mode},resolve,reject,settled:false};
    job.timer=setTimeout(()=>{
     settle(job,Error('Search took too long. Narrow the search and retry.'));
     const index=queue.indexOf(job);if(index>=0)queue.splice(index,1);
     onDiagnostic({event:'query_pool_timeout',phase:job.child?'running':'queued',...stats()});
     // Process-level kill interrupts native SQL; reserve the slot until close confirms exit.
     if(job.child)job.child.kill('SIGKILL');
    },Math.max(1,Math.min(timeoutMs,deadline-Date.now())));
    queue.push(job);pump();
   });
  },
  get pending(){return queue.length;},
  get running(){return active.size;},
  diagnostics:stats,
  async close(){
   closed=true;for(const job of queue.splice(0))settle(job,Error('Query service is closing.'));
   await Promise.all([...active].map(job=>{settle(job,Error('Query service is closing.'));job.child.kill('SIGKILL');return job.done;}));
  }
 };
}
