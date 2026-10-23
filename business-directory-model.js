export function validateBusinessListings(entries) {
    if (!Array.isArray(entries)) throw new Error('Business listings must be an array.');
    const ids = new Set();
    for (const entry of entries) {
        if (!entry || typeof entry.id !== 'string' || !/^[a-z0-9-]+$/.test(entry.id) || ids.has(entry.id)) {
            throw new Error('Each listing needs a unique, stable ID.');
        }
        ids.add(entry.id);
        if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 160) throw new Error('A business name is required.');
        if (typeof entry.address !== 'string' || !/^keeta_[a-z0-9]{50,100}$/.test(entry.address)) throw new Error('A full Keeta account address is required.');
        if (entry.tag && !/^[a-z0-9_]{2,24}\$keeta\.xyz$/.test(entry.tag)) throw new Error('Invalid Keeta tag.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.listedOn) || !Number.isFinite(Date.parse(entry.listedOn))) throw new Error('A listing date is required.');
        if (!Array.isArray(entry.sources) || !entry.sources.length) throw new Error('Every listing needs public evidence.');
        for (const source of entry.sources) {
            const url = new URL(source.url);
            if (url.protocol !== 'https:' || url.username || url.password || !source.label?.trim()) throw new Error('Sources need an HTTPS URL and label.');
        }
    }
    return entries;
}

export function filterBusinessListings(entries, query) {
    const term = query.trim().toLowerCase();
    return entries.filter(entry => [entry.name, entry.tag || '', entry.address].some(value => value.toLowerCase().includes(term)));
}
