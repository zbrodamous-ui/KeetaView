import { businessListings } from './business-directory-data.js';
import { validateBusinessListings, filterBusinessListings } from './business-directory-model.js';

const search = document.getElementById('businessSearch');
const list = document.getElementById('businessList');
const count = document.getElementById('businessCount');
const total = document.getElementById('businessTotal');
const clear = document.getElementById('businessSearchClear');
const params = new URLSearchParams(location.search);
search.value = params.get('q') || '';
let listings;
try { listings = validateBusinessListings(businessListings); }
catch (error) {
    list.textContent = 'Business listings are temporarily unavailable.';
    count.textContent = 'Unavailable';
    total.textContent = '—';
    search.disabled = true;
    console.error('Business directory validation failed:', error.message);
}

function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
}
function render() {
    if (!listings) return;
    const matches = filterBusinessListings(listings, search.value);
    total.textContent = listings.length.toLocaleString();
    count.textContent = `${matches.length.toLocaleString()} ${matches.length === 1 ? 'listing' : 'listings'}`;
    clear.hidden = !search.value;
    list.replaceChildren();
    if (!matches.length) {
        const empty = element('div', '', 'business-empty');
        empty.append(element('h3', listings.length ? 'No matching businesses' : 'No public business listings yet'));
        empty.append(element('p', listings.length ? 'Try another business name, Keeta tag, or account address.' : 'We have not confirmed a public business-to-account connection for this directory yet. Listings will appear here with supporting source links.'));
        list.append(empty);
        return;
    }
    for (const entry of matches) {
        const card = element('article', '', 'business-card');
        card.append(element('span', 'Public listing', 'business-label'), element('h3', entry.name));
        if (entry.tag) card.append(element('p', entry.tag));
        const account = element('a', entry.address, 'business-address');
        account.href = `address.html?address=${encodeURIComponent(entry.address)}`;
        card.append(account);
        card.append(element('p', `Listed on KeetaView: ${entry.listedOn}`, 'business-date'));
        const sources = element('ul', '', 'business-sources');
        for (const source of entry.sources) {
            const item = element('li', '');
            const link = element('a', source.label);
            link.href = source.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            item.append(link);
            sources.append(item);
        }
        card.append(element('h4', 'Public sources'), sources);
        list.append(card);
    }
}
search.addEventListener('input', () => {
    const url = new URL(location.href);
    if (search.value.trim()) url.searchParams.set('q', search.value.trim());
    else url.searchParams.delete('q');
    history.replaceState({}, '', url);
    render();
});
clear.addEventListener('click', () => { search.value = ''; search.dispatchEvent(new Event('input')); search.focus(); });
render();
