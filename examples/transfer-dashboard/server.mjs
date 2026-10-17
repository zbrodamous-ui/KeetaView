import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// A local backend keeps the beta key out of browser code and URLs.
export function createDemo({ key, upstream = 'https://keetaview.com', fetcher = fetch }) {
    if (!key) throw new Error('Set KEETAVIEW_API_KEY before starting the demo.');
    const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']]]);
    let busy = false;
    return http.createServer(async (req, res) => {
        const send = (status, value) => { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
        try {
            const url = new URL(req.url, 'http://localhost');
            if (req.method !== 'GET') return send(405, {error:'GET required.'});
            // Block cross-origin requests and DNS rebinding to this local key proxy.
            if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '') || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') return send(403, {error:'Open the local demo URL.'});
            if (files.has(url.pathname)) {
                const [name, type] = files.get(url.pathname);
                const content = await fs.readFile(new URL(name, import.meta.url));
                res.writeHead(200, {'Content-Type':type, 'Cache-Control':'no-store'}); return res.end(content);
            }
            if (!['/data/status','/data/transfers'].includes(url.pathname)) return send(404, {error:'Not found.'});
            const target = new URL(url.pathname.replace('/data/', '/api/v1/'), upstream);
            if (url.pathname === '/data/transfers') {
                const token = url.searchParams.get('token') || '';
                const before = url.searchParams.get('before');
                if (!/^keeta_[a-z2-7]{20,100}$/.test(token) || (before !== null && (!/^[1-9]\d*$/.test(before) || !Number.isSafeInteger(Number(before))))) return send(400, {error:'Enter a full token address and valid cursor.'});
                target.searchParams.set('token',token); target.searchParams.set('limit','20');
                if (before !== null) target.searchParams.set('before',before);
            }
            if (busy) return send(429, {error:'A request is already running.'});
            busy = true;
            try {
                const response = await fetcher(target, {headers:{Authorization:`Bearer ${key}`}, signal:AbortSignal.timeout(15000), redirect:'error'});
                for (const h of ['retry-after','x-ratelimit-remaining-day','x-ratelimit-remaining-minute']) { const v=response.headers.get(h); if(v) res.setHeader(h,v); }
                const data = await response.json();
                send(response.status, response.ok ? data : {error: response.status === 401 ? 'Demo API key is invalid or revoked.' : response.status === 429 ? 'Beta quota reached. Wait before retrying.' : 'API request failed. Try again later.'});
            } finally { busy = false; }
        } catch { send(503, {error:'Could not reach the API. Try again later.'}); }
    });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const server = createDemo({key:process.env.KEETAVIEW_API_KEY});
        server.listen(3210, '127.0.0.1', () => console.log('Transfer demo: http://127.0.0.1:3210'));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
