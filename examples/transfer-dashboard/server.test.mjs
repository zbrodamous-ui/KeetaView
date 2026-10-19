import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemo} from './server.mjs';

test('local demo contains key, restricts proxy requests, and forwards pagination and quotas', async t => {
    const calls=[];
    const server=createDemo({key:'private-test-secret',fetcher:async(url,opts)=>{
        calls.push({url:new URL(url),opts});
        return new Response(JSON.stringify({data:[],nextBefore:null}),{status:200,headers:{'X-RateLimit-Remaining-Day':'997'}});
    }});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const base=`http://127.0.0.1:${server.address().port}`;
    const page=await fetch(base);assert.equal(page.status,200);assert.ok(!(await page.text()).includes('private-test-secret'));
    assert.equal((await fetch(base+'/data/transfers?token=bad')).status,400);
    assert.equal((await fetch(base+'/data/status',{headers:{Origin:'https://other.example'}})).status,403);
    assert.equal((await fetch(base+'/data/usage')).status,404);
    assert.equal(calls.length,0);
    const token='keeta_'+'a'.repeat(60);
    const r=await fetch(base+`/data/transfers?token=${token}&before=42&limit=100&url=https://other.example`);
    assert.equal(r.status,200);assert.equal(r.headers.get('X-RateLimit-Remaining-Day'),'997');
    assert.equal(calls[0].url.origin,'https://keetaview.com');assert.equal(calls[0].url.searchParams.get('before'),'42');assert.equal(calls[0].url.searchParams.get('limit'),'20');assert.equal(calls[0].url.searchParams.has('url'),false);
    assert.equal(calls[0].opts.headers.Authorization,'Bearer private-test-secret');
});
test('upstream failure does not expose credentials and retry guidance survives',async t=>{
    const server=createDemo({key:'private-test-secret',fetcher:async()=>new Response(JSON.stringify({error:'private-test-secret'}),{status:429,headers:{'Retry-After':'59'}})});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    const r=await fetch(`http://127.0.0.1:${server.address().port}/data/status`);
    assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'59');assert.ok(!(await r.text()).includes('private-test-secret'));
    assert.throws(()=>createDemo({key:''}),/KEETAVIEW_API_KEY/);
});
