// Compare public access with container-local access. No credentials are required.
const base = new URL(process.argv[2] || 'https://keetaview.com');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw Error('Supply an HTTP(S) base URL without credentials or query parameters');
const results=[];
for(const pathname of ['/', '/shared.js', '/api/health', '/api/status', '/api/blocks?limit=6&offset=0', '/api/transfers?limit=6', '/api/operations?limit=20&offset=0']) {
 const started=performance.now();
 try {
  const r=await fetch(new URL(pathname,base),{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
  await r.arrayBuffer();
  results.push({path:pathname,status:r.status,milliseconds:Math.round(performance.now()-started),requestId:r.headers.get('x-request-id')});
 }catch(error){results.push({path:pathname,error:error.name,milliseconds:Math.round(performance.now()-started)});}
}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),origin:base.origin,results},null,2));
if(results.some(r=>r.error || r.status!==200))process.exitCode=1;
