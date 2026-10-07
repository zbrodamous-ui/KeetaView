import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openHolders, KTA_TOKEN, walletOperationCondition } from './holders.js';
import { runInNewContext } from 'node:vm';
import fs from 'node:fs';

test('observed holders rank exact network balance snapshots, keep zero/failure coverage and deduplicate candidates', () => {
    const cache = openHolders(':memory:');
    try {
        cache.discover([{sender:'a',recipient:'b',amount:'100'}, {sender:'a',recipient:'a',amount:'200'},
            {sender:'c',recipient:null,amount:'1'}], 10);
        assert.equal(cache.state('discovered'), 3);
        cache.discover([{sender:'a',recipient:'b',amount:'50'}], 10);
        assert.equal(cache.state('discovered'), 3);
        cache.saveBalance('a', '900719925474099299999999999', 1000);
        cache.saveBalance('b', '900719925474099300000000000', 1000);
        cache.saveBalance('c', '0', 1000);
        assert.deepEqual(cache.list().holders.map(row => row.address), ['b','a']);
        assert.equal(cache.list().checked_wallets, 3);
        cache.fail('b',2000);
        assert.equal(cache.list().holders[0].address, 'b');
        assert.equal(cache.due(4,3000).length, 0);
        cache.saveBalance('b', '0',4000);
        assert.equal(cache.list().holders.length,1);
        assert.equal(cache.list().checked_wallets,3);
        assert.throws(()=>cache.saveBalance('a','-1'), /Negative/);
        const plan=cache.db.prepare(`EXPLAIN QUERY PLAN SELECT address FROM holders
            WHERE balance_digits > 0 ORDER BY balance_digits DESC,balance DESC,address LIMIT 25`).all();
        assert.ok(plan.some(row=>row.detail.includes('holders_rank')));
        assert.ok(plan.every(row=>!row.detail.includes('TEMP B-TREE')));
    } finally { cache.db.close(); }
});

test('candidate discovery and focused activity use existing indexes with no unrelated transfer scans', () => {
    const db=new DatabaseSync(':memory:');
    try {
        const source=fs.readFileSync(new URL('./indexer.js',import.meta.url),'utf8');
        for (const match of source.matchAll(/database\.exec\(`([\s\S]*?)`\);/g)) {
            if (/CREATE TABLE|CREATE INDEX/.test(match[1])) db.exec(match[1]);
        }
        const discovery=db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM transfers INDEXED BY transfers_by_token
            WHERE token = ? AND id > ? ORDER BY id LIMIT 1000`).all(KTA_TOKEN,0);
        assert.ok(discovery.every(row=>!row.detail.includes('SCAN transfers') && !row.detail.includes('TEMP B-TREE')));
        const wallet=walletOperationCondition('wallet');
        const plan=db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM operations WHERE ${wallet.sql}
            AND token = ? ORDER BY timestamp DESC LIMIT 20`).all(...wallet.parameters,KTA_TOKEN);
        assert.ok(plan.every(row=>!row.detail.includes('SCAN operations')));
        assert.ok(plan.some(row=>row.detail.includes('operations_by_sender')));
        assert.ok(plan.some(row=>row.detail.includes('operations_by_recipient')));
        const joined=`FROM transfers AS indexed_transfers INNER JOIN operations
            ON operations.block_hash=indexed_transfers.block_hash AND operations.operation_index=indexed_transfers.operation_index
            WHERE ${wallet.sql} AND operations.token = ? AND operations.operation_type IN ('SEND','RECEIVE')`;
        for (const sql of [`SELECT operations.* ${joined} ORDER BY indexed_transfers.timestamp DESC LIMIT 20`,
            `SELECT COUNT(*) ${joined}`]) {
            const joinedPlan=db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...wallet.parameters,KTA_TOKEN);
            assert.ok(joinedPlan.every(row=>!/SCAN (operations|indexed_transfers)/.test(row.detail)),JSON.stringify(joinedPlan));
        }
    } finally {db.close();}
});

test('holder links preserve wallet and asset scope; direction handles self-transfers and receive operations', () => {
    const source=fs.readFileSync(new URL('../holder-ui.js',import.meta.url),'utf8');
    const functions=runInNewContext(`${source}; ({holderActivityUrl,walletTransferDirection})`, {URLSearchParams});
    const link=new URL(functions.holderActivityUrl('keeta_wallet',KTA_TOKEN),'https://keetaview.com');
    assert.equal(link.searchParams.get('address'),'keeta_wallet');
    assert.equal(link.searchParams.get('token'),KTA_TOKEN);
    assert.equal(link.searchParams.get('view'),'transfers');
    const direction=functions.walletTransferDirection;
    assert.equal(direction({sender:'wallet',recipient:'other'},'wallet'),'Sent');
    assert.equal(direction({sender:'other',recipient:'wallet'},'wallet'),'Received');
    assert.equal(direction({sender:'wallet',recipient:'wallet'},'wallet'),'Self transfer');
    assert.equal(direction({sender:'wallet',operation_type:'RECEIVE'},'wallet'),'Received');
});

test('holder table renders partial coverage, exact 18-decimal amounts and names safely with one cached request', async () => {
    class Element {
        constructor(tag) {this.tag=tag;this.children=[];this.hidden=true;}
        append(...children) {this.children.push(...children);}
        replaceChildren() {this.children=[];}
        addEventListener() {}
        set innerHTML(_) {throw new Error('Unsafe HTML rendering');}
    }
    const elements=new Map(['assetHolders','holderCoverage','assetHoldersList','refreshHolders'].map(id=>[id,new Element('div')]));
    let calls=0;
    const source=fs.readFileSync(new URL('../holder-ui.js',import.meta.url),'utf8');
    const assetSource=fs.readFileSync(new URL('../asset.js',import.meta.url),'utf8');
    const formatter=assetSource.slice(assetSource.indexOf('function formatAssetSupply'),assetSource.indexOf('async function loadAsset'));
    const render=runInNewContext(`${formatter}\n${source}; loadKtaHolders`, {
        document:{getElementById:id=>elements.get(id),createElement:tag=>new Element(tag)},
        window:{setInterval() {}},URLSearchParams,
        formatKeetaIdentifier:value=>value,timeAgo:()=> '1 minute ago',
        fetchKeetaView:async()=>{calls++;return {ok:true,json:async()=>({token:KTA_TOKEN,decimals:18,
            checked_wallets:2,discovered_wallets:20,
            holders:[{address:'keeta_a',username:'<img onerror=alert(1)>',balance:'1000000000000000001',checked_at:1000},
                {address:'keeta_b',name:null,balance:'2000000000000000000',checked_at:1000}]})};}
    });
    await render(KTA_TOKEN);
    assert.equal(calls,1);
    assert.equal(elements.get('assetHolders').hidden,false);
    assert.ok(elements.get('holderCoverage').textContent.includes('Coverage is still growing'));
    const rows=elements.get('assetHoldersList').children;
    assert.equal(rows.length,2);
    assert.equal(rows[0].children[2].textContent,'1.000000000000000001 KTA');
    assert.equal(rows[0].children[1].children[0].textContent,'<img onerror=alert(1)> (keeta_a)');
    assert.ok(rows[0].children[1].children[0].href.includes('address=keeta_a'));
});
