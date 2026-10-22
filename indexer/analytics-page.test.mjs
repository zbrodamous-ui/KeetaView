import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('analytics can retry a cold-cache response without removing render targets', async () => {
    const source=fs.readFileSync(new URL('../analytics.js',import.meta.url),'utf8');
    const nodes=new Map();
    function element() { return {children:[],events:{},textContent:'',setAttribute(){},append(...items){this.children.push(...items);for(const item of items)if(item.id)nodes.set(item.id,item);},prepend(item){this.children.unshift(item);if(item.id)nodes.set(item.id,item);},remove(){nodes.delete(this.id);},addEventListener(name,fn){this.events[name]=fn;}}; }
    for(const id of ['networkAnalytics','analyticsCacheStatus','analyticsBlocks','analyticsTransfers','analyticsAccounts','averageOperations','analyticsOperations','firstIndexed','latestIndexed','analyticsAnchors','anchorRelationships','verifiedAnchors','unsignedAnchors','invalidAnchors','anchorAccounts','latestAnchor'])nodes.set(id,element());
    let available=false,calls=0;
    const ctx=vm.createContext({console:{error(){}},document:{getElementById:id=>nodes.get(id),createElement:element},fetchKeetaView:async()=>{calls++;return {ok:available,status:503,json:async()=>({summary:{blocks:10,transfers:20,accounts:5,averageOperations:2,operations:20},activity:[],topSenders:[],topRecipients:[],tokenActivity:[],recentTransfers:[],cache:{generatedAt:'2026-10-22T12:00:00Z',refreshing:false}})};},formatIndexedDate:()=>'',timeAgo:()=>'',renderActivityChart(){},renderRecentAnchors(){},renderRankedAccounts(){},renderTokenActivity:async()=>{},renderRecentTransfers:async()=>{}});
    vm.runInContext(source.slice(source.indexOf('function showAnalyticsError('),source.lastIndexOf('initializeAnalyticsTabs();')),ctx);
    const target=nodes.get('analyticsBlocks');
    await ctx.loadAnalytics();
    assert.equal(nodes.get('analyticsBlocks'),target);
    const button=nodes.get('analyticsLoadError').children.find(x=>x.type==='button');
    assert.ok(button);
    available=true;
    await button.events.click();
    assert.equal(calls,2);
    assert.equal(nodes.has('analyticsLoadError'),false);
    assert.equal(target.textContent,'10');
    assert.match(nodes.get('analyticsCacheStatus').textContent,/Cached network analytics/);
});
