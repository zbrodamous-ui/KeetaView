import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../script.js',import.meta.url),'utf8');
const rowSource=source.slice(source.indexOf('function createTransferRow('),source.indexOf('\nfunction getMarketCurrency('));
function element(){return {children:[],textContent:'',append(...items){this.children.push(...items);}};}
test('homepage transfer appears before stalled metadata; optional names render as text',async()=>{
 let resolveMetadata;
 const context=vm.createContext({document:{createElement:element},shortValue:v=>v||'Not available',timeAgo:()=> 'now',getTokenDisplay:()=>new Promise(resolve=>resolveMetadata=resolve),encodeURIComponent,BigInt});
 vm.runInContext(rowSource,context);
 const row=context.createTransferRow({block_hash:'block',operation_index:1,sender:'sender',recipient:'recipient',token:'token',amount:'900719925474099312345'});
 assert.equal(row.href,'transaction.html?block=block&operation=1');assert.match(row.children[2].textContent,/raw units/);assert.equal(typeof row.then,'undefined');
 resolveMetadata({amount:'formatted',name:'<img src=x onerror=alert(1)>'});await Promise.resolve();
 assert.equal(row.children[2].textContent,'formatted <img src=x onerror=alert(1)>');assert.equal(row.children[2].innerHTML,undefined);
});
test('concurrent metadata requests share one external lookup and failed lookups may retry',async()=>{
 const start=source.indexOf('async function getTokenDisplay('),end=source.indexOf('\nfunction createBlockRow(',start);
 let calls=0,release;
 const context=vm.createContext({tokenDisplayCache:new Map(),KeetaNet:{lib:{Account:{fromPublicKeyString:v=>v}}},client:{getAccountInfo:()=>{calls++;return new Promise(resolve=>release=resolve);}},formatTokenAmount:(v,d)=>`${v}/${d}`,shortValue:v=>v,atob:v=>v});
 vm.runInContext(source.slice(start,end),context);
 const first=context.getTokenDisplay('token','1'),second=context.getTokenDisplay('token','2');await Promise.resolve();assert.equal(calls,1);release({info:{name:'TOKEN',metadata:'{"decimalPlaces":18}'}});assert.equal((await first).amount,'1/18');assert.equal((await second).amount,'2/18');
 context.client.getAccountInfo=()=>{calls++;return Promise.reject(Error('offline'));};await assert.rejects(context.getTokenDisplay('other','1'));await assert.rejects(context.getTokenDisplay('other','1'));assert.equal(calls,3);
});
