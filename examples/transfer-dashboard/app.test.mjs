import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('missing transfer fields render without broken links and pagination continues',async()=>{
    class Element {
        children=[];textContent='';value='';disabled=false;
        append(...items){this.children.push(...items);}
        replaceChildren(){this.children=[];}
        addEventListener(){}
    }
    const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
    let page=0;
    const context=vm.createContext({document:{getElementById:get,createElement:()=>new Element()},URLSearchParams,AbortSignal,fetch:async path=>({ok:true,status:200,json:async()=>path==='/data/status'?{data:{historicalComplete:false}}:++page===1?{data:[{id:2,sender:null,recipient:null,block_hash:null,operation_index:null,amount:'0'},{id:1,sender:'keeta_sender',recipient:'keeta_recipient',block_hash:'A'.repeat(64),operation_index:0,amount:'999999999999999999999'}],nextBefore:1}:{data:[{id:0,sender:null,recipient:'keeta_recipient',block_hash:null,operation_index:null,amount:null}],nextBefore:null}})});
    vm.runInContext(await fs.readFile(new URL('./app.js',import.meta.url),'utf8'),context);
    await new Promise(resolve=>setImmediate(resolve));
    get('token').value='keeta_'+'a'.repeat(60);
    await vm.runInContext('load(true)',context);
    assert.equal(get('rows').children.length,2);
    const cells=get('rows').children[0].children;
    assert.equal(cells[1].textContent,'Unknown');assert.equal(cells[1].children.length,0);assert.equal(cells[4].textContent,'Unknown');assert.equal(cells[3].textContent,'0');
    assert.equal(get('rows').children[1].children[3].textContent,'999999999999999999999');assert.equal(get('more').disabled,false);
    await vm.runInContext('load(false)',context);
    assert.equal(get('rows').children.length,3);assert.equal(get('count').textContent,'3 transfers shown');assert.equal(get('more').disabled,true);
});
