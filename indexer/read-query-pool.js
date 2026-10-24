import {Worker} from 'node:worker_threads';
export function createReadQueryPool({databaseFile,concurrency=2,maxQueue=8,timeoutMs=8000,workerURL=new URL('./read-query-worker.js',import.meta.url)}) {
 const active=new Set(),queue=[];
 let closed=false;
 function settle(job,error,result){if(job.settled)return;job.settled=true;clearTimeout(job.timer);error?job.reject(error):job.resolve(result);}
 function pump(){
  while(!closed && active.size<concurrency && queue.length){
   const job=queue.shift();if(job.settled)continue;
   let worker;
   try{worker=new Worker(workerURL,{workerData:{databaseFile,...job.task}});}catch{settle(job,Error('Indexed query temporarily unavailable.'));continue;}
   job.worker=worker;active.add(job);worker.unref();
   let result,received=false,failure;
   worker.on('message',message=>{if(message.error)failure=Error('Indexed query temporarily unavailable.');else{received=true;result=message.result;}});
   worker.on('error',()=>{failure=Error('Indexed query temporarily unavailable.');});
   worker.on('exit',code=>{
    active.delete(job);
    settle(job,failure || (code!==0 || !received?Error('Indexed query temporarily unavailable.'):null),result);
    pump();
   });
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
     // Keep the slot occupied until exit, even if native SQLite cancellation is delayed.
     if(job.worker)void job.worker.terminate();
    },Math.max(1,Math.min(timeoutMs,deadline-Date.now())));
    queue.push(job);pump();
   });
  },
  get pending(){return queue.length;},
  get running(){return active.size;},
  async close(){closed=true;for(const job of queue.splice(0))settle(job,Error('Query service is closing.'));await Promise.all([...active].map(job=>{settle(job,Error('Query service is closing.'));return job.worker.terminate();}));}
 };
}
