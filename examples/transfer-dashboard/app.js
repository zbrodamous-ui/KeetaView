const $ = id => document.getElementById(id);
let token = '', cursor = null, busy = false, total = 0, retryUntil = 0;
const seen = new Set();
function controls() { $('load').disabled = busy; $('more').disabled = busy || cursor === null; }
async function request(path) {
    if (Date.now() < retryUntil) throw new Error(`Retry in ${Math.ceil((retryUntil-Date.now())/1000)} seconds.`);
    const r = await fetch(path, {signal:AbortSignal.timeout(20000)});
    if (r.status === 429) retryUntil = Date.now() + Math.max(1, Number(r.headers.get('retry-after')) || 60)*1000;
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Request failed.');
    return j;
}
function link(text, page, params) {
    const a=document.createElement('a');a.textContent=text;
    a.href=`https://keetaview.com/${page}?${new URLSearchParams(params)}`;a.target='_blank';a.rel='noopener noreferrer';return a;
}
const short = value => value.length > 24 ? `${value.slice(0,14)}…${value.slice(-7)}` : value;
async function load(reset) {
    if (busy) return;
    if (reset && !/^keeta_[a-z2-7]{20,100}$/.test($('token').value.trim())) { $('message').textContent='Enter a full token address.';return; }
    busy=true;controls();
    const selected = reset ? $('token').value.trim() : token;
    const p=new URLSearchParams({token:selected});if(!reset && cursor !== null) p.set('before',cursor);
    $('message').textContent='Loading indexed transfers…';
    try {
        const j=await request(`/data/transfers?${p}`);
        if (!Array.isArray(j.data)) throw new Error('Unexpected API response.');
        if(reset){token=selected;total=0;seen.clear();$('rows').replaceChildren();}
        for(const row of j.data){
            const identity=`${row.block_hash}:${row.operation_index}`;if(seen.has(identity))continue;seen.add(identity);
            const tr=document.createElement('tr');
            const time=document.createElement('td');time.textContent=row.timestamp || 'Unknown';tr.append(time);
            for(const key of ['sender','recipient']){const td=document.createElement('td');td.append(link(short(row[key]),'address.html',{address:row[key]}));tr.append(td);}
            const amount=document.createElement('td');amount.className='amount';amount.textContent=row.amount;tr.append(amount);
            const operation=document.createElement('td');operation.append(link(`${short(row.block_hash)} · #${row.operation_index}`,'transaction.html',{block:row.block_hash,operation:row.operation_index}));tr.append(operation);
            $('rows').append(tr);total++;
        }
        cursor=j.nextBefore ?? null;
        $('count').textContent=`${total} transfers shown`;
        $('message').textContent=total===0?'No transfers found in this index. This does not prove none occurred.':cursor===null?'End of available indexed results.':'Results loaded. Load more to continue through the index.';
    }catch(error){$('message').textContent=error.message;}
    finally{busy=false;controls();}
}
$('search').addEventListener('submit',e=>{e.preventDefault();load(true);});
$('more').addEventListener('click',()=>load(false));
// One status read; no automatic polling consumes the beta quota.
busy=true;controls();
request('/data/status').then(j=>{$('coverage').textContent=`Mainnet · ${j.data.historicalComplete?'Indexer reports historical backfill complete':'Historical backfill incomplete'} · Latest indexed: ${j.data.latestIndexedTimestamp || 'unknown'}`;}).catch(e=>{$('coverage').textContent=`Index status unavailable: ${e.message}`;}).finally(()=>{busy=false;controls();});
