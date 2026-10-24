import { Worker } from 'node:worker_threads';
import fs from 'node:fs/promises';

const validAnalyticsData = data => data?.summary && ['activity', 'topSenders', 'topRecipients',
    'tokenActivity', 'recentTransfers'].every(key => Array.isArray(data[key]));
const validSnapshot = (value, validateData) => value && Number.isFinite(value.createdAt) &&
    value.createdAt > 0 && value.createdAt <= Date.now() &&
    validateData(value.data);

export function createAnalyticsCache({ databaseFile, stateFile, cacheFile,
    refreshMs = 10 * 60 * 1000, retryMs = 60 * 1000,
    validateData = validAnalyticsData,
    workerURL = new URL('./analytics-worker.js', import.meta.url),
    onError = error => console.error('Analytics refresh failed:', error.message) }) {
    let snapshot = null;
    let active = null;
    let retryAfter = 0;
    let closed = false;
    const ready = fs.readFile(cacheFile, 'utf8').then(text => {
        const saved = JSON.parse(text);
        if (validSnapshot(saved, validateData)) snapshot = saved;
    }).catch(() => {});

    function refresh() {
        if (closed || active || Date.now() < retryAfter) return;
        let worker;
        try {
            worker = new Worker(workerURL, { workerData: { databaseFile, stateFile } });
        } catch (error) {
            retryAfter = Date.now() + retryMs;
            onError(error);
            return;
        }
        active = worker;
        worker.unref();
        let result = null;
        let failure = null;
        worker.on('message', message => {
            if (message.error) failure = new Error(message.error);
            else {
                const candidate = { createdAt: Date.now(), data: message.data };
                if (validSnapshot(candidate, validateData)) result = candidate;
                else failure = new Error('Invalid analytics worker response');
            }
        });
        worker.on('error', error => { failure = error; });
        worker.on('exit', async code => {
            try {
                if (closed) return;
                if (failure || code !== 0 || !result) {
                    throw failure || new Error(`Analytics worker exited with code ${code}`);
                }
                snapshot = result;
                // Write on the same volume and atomically replace the last good snapshot.
                const temporary = `${cacheFile}.${process.pid}.tmp`;
                try {
                    await fs.writeFile(temporary, JSON.stringify(result));
                    await fs.rename(temporary, cacheFile);
                } finally {
                    await fs.unlink(temporary).catch(() => {});
                }
            } catch (error) {
                retryAfter = Date.now() + retryMs;
                onError(error);
            } finally {
                active = null;
            }
        });
    }
    return {
        async get() {
            await ready;
            if (!snapshot || Date.now() - snapshot.createdAt >= refreshMs) refresh();
            return snapshot;
        },
        get refreshing() { return active !== null; },
        async close() {
            closed = true;
            if (active) await active.terminate();
        }
    };
}
