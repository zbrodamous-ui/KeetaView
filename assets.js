const client = KeetaNet.Client.fromNetwork("main");

const pageSize = 20;
const assetDetailsCacheKey = "keetaview_asset_details";
let assets = [];
let filteredAssets = [];
let currentPage = 1;

const knownAssetsList = document.getElementById("knownAssetsList");
const assetFilter = document.getElementById("assetFilter");
const assetResultCount = document.getElementById("assetResultCount");
const assetPagination = document.getElementById("assetPagination");
const assetPrevious = document.getElementById("assetPrevious");
const assetNext = document.getElementById("assetNext");
const assetPageStatus = document.getElementById("assetPageStatus");

function loadKnownAssets() {
    try {
        const saved = localStorage.getItem("keetascan_known_assets");
        const parsed = saved ? JSON.parse(saved) : [];

        return Array.isArray(parsed)
            ? [...new Set(parsed.filter((address) => typeof address === "string"))]
            : [];
    } catch (error) {
        console.error("Could not read known assets:", error);
        return [];
    }
}

function loadCachedAssetDetails() {
    try {
        const saved = localStorage.getItem(assetDetailsCacheKey);
        const parsed = saved ? JSON.parse(saved) : {};

        return parsed && typeof parsed === "object"
            ? parsed
            : {};
    } catch (error) {
        return {};
    }
}

function saveCachedAssetDetails() {
    try {
        const details = Object.fromEntries(
            assets.map((asset) => [asset.address, asset])
        );

        localStorage.setItem(
            assetDetailsCacheKey,
            JSON.stringify(details)
        );
    } catch (error) {
        console.warn("Could not cache asset details:", error);
    }
}

function createAssetFallback(address) {
    return {
        address,
        symbol: "Unknown",
        name: "Loading asset details…",
        supply: "—"
    };
}

function shortAddress(address) {
    if (!address || address.length <= 24) {
        return address || "Unknown";
    }

    return formatKeetaIdentifier(address, 14, 6);
}

function formatAssetSupply(rawSupply, decimalPlaces) {
    if (rawSupply === undefined || rawSupply === null) {
        return "—";
    }

    const raw = BigInt(rawSupply);
    const decimals = Math.max(0, Number(decimalPlaces || 0));

    if (decimals === 0) {
        return raw.toLocaleString();
    }

    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const remainder = raw % divisor;
    const fraction = remainder
        .toString()
        .padStart(decimals, "0")
        .replace(/0+$/, "");

    return fraction
        ? `${whole.toLocaleString()}.${fraction}`
        : whole.toLocaleString();
}

function readMetadata(assetInfo) {
    try {
        if (!assetInfo?.info?.metadata) {
            return {};
        }

        return JSON.parse(atob(assetInfo.info.metadata));
    } catch (error) {
        return {};
    }
}

function assetUrl(address) {
    return `asset.html?asset=${encodeURIComponent(address)}`;
}

function createAssetRow(asset) {
    const row = document.createElement("a");
    row.className = "asset-directory-row";
    row.href = assetUrl(asset.address);
    row.setAttribute("aria-label", `Open ${escapeKeetaHtml(asset.symbol)} asset details`);

    row.innerHTML = `
        <span class="asset-directory-symbol">
            ${escapeKeetaHtml(asset.symbol)}
        </span>

        <span class="asset-directory-name">
            ${escapeKeetaHtml(asset.name)}
        </span>

        <span class="asset-directory-address" title="${escapeKeetaHtml(asset.address)}">
            ${escapeKeetaHtml(shortAddress(asset.address))}
        </span>

        <span class="asset-directory-supply">
            ${escapeKeetaHtml(asset.supply)} ${asset.symbol === "Unknown" ? "" : escapeKeetaHtml(asset.symbol)}
        </span>
    `;

    return row;
}

function renderAssets() {
    knownAssetsList.innerHTML = "";

    const totalResults = filteredAssets.length;
    const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));

    if (currentPage > totalPages) {
        currentPage = totalPages;
    }

    assetResultCount.textContent =
        `${totalResults.toLocaleString()} ${totalResults === 1 ? "asset" : "assets"}`;

    if (totalResults === 0) {
        const empty = document.createElement("p");
        empty.className = "assets-empty";
        empty.textContent = assets.length
            ? "No assets match that filter."
            : "No known assets yet.";
        knownAssetsList.appendChild(empty);
        assetPagination.hidden = true;
        return;
    }

    const start = (currentPage - 1) * pageSize;
    const pageAssets = filteredAssets.slice(start, start + pageSize);

    pageAssets.forEach((asset) => {
        knownAssetsList.appendChild(createAssetRow(asset));
    });

    assetPageStatus.textContent = `Page ${currentPage} of ${totalPages}`;
    assetPrevious.disabled = currentPage === 1;
    assetNext.disabled = currentPage === totalPages;
    assetPagination.hidden = totalPages <= 1;
}

function filterAssets() {
    const query = assetFilter.value.trim().toLowerCase();

    filteredAssets = query
        ? assets.filter((asset) =>
            [asset.symbol, asset.name, asset.address]
                .some((value) => value.toLowerCase().includes(query))
        )
        : [...assets];

    currentPage = 1;
    renderAssets();
}

async function loadIndexedAssets() {
    try {
        const response =
            await fetch(
                "/api/assets?limit=1000",
                {
                    headers: {
                        Accept: "application/json"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `Assets API returned ${response.status}.`
            );
        }

        const indexedAssets =
            await response.json();

        if (!Array.isArray(indexedAssets)) {
            return [];
        }

        return indexedAssets
            .map((asset) => asset?.address)
            .filter(
                (address) =>
                    typeof address === "string" &&
                    address.length > 0
            );
    } catch (error) {
        console.warn(
            "Could not load indexed assets:",
            error
        );

        return [];
    }
}

async function loadAsset(address) {
    const fallback = createAssetFallback(address);
    fallback.name = "Unnamed asset";

    try {
        const assetInfo = await withKeetaViewTimeout(
            client.getAccountInfo(address)
        );

        if (!assetInfo?.info) {
            return fallback;
        }

        const metadata = readMetadata(assetInfo);
        const symbol = assetInfo.info.name || "Unknown";
        const name = assetInfo.info.description || metadata.name || "Unnamed asset";

        let supply = "—";

        try {
            supply = formatAssetSupply(
                assetInfo.info.supply,
                metadata.decimalPlaces
            );
        } catch (error) {
            supply = assetInfo.info.supply?.toString() || "—";
        }

        return {
            address,
            symbol,
            name,
            supply
        };
    } catch (error) {
        console.error("ASSET INFO ERROR:", address, error);
        return fallback;
    }
}

async function loadAssetsPage() {
    const savedAssets =
    loadKnownAssets();

const indexedAssets =
    await loadIndexedAssets();

const knownAssets = [
    ...new Set([
        ...savedAssets,
        ...indexedAssets
    ])
];

    if (knownAssets.length === 0) {
        assets = [];
        filteredAssets = [];
        renderAssets();
        return;
    }

    const cachedDetails = loadCachedAssetDetails();

    assets = knownAssets.map(
        (address) =>
            cachedDetails[address] ||
            createAssetFallback(address)
    );
    filteredAssets = [...assets];
    renderAssets();

    const firstPageAssets = assets.slice(0, pageSize);
    const remainingAssets = assets.slice(pageSize);

    await Promise.all(
        firstPageAssets.map(async (asset) => {
            Object.assign(
                asset,
                await loadAsset(asset.address)
            );
        })
    );

    assets.sort((first, second) =>
        first.symbol.localeCompare(second.symbol, undefined, {
            numeric: true,
            sensitivity: "base"
        })
    );
    filteredAssets = [...assets];
    renderAssets();
    saveCachedAssetDetails();

   (async () => {
    const batchSize = 8;

    for (
        let start = 0;
        start < remainingAssets.length;
        start += batchSize
    ) {
        const batch =
            remainingAssets.slice(
                start,
                start + batchSize
            );

        await Promise.all(
            batch.map(async (asset) => {
                Object.assign(
                    asset,
                    await loadAsset(
                        asset.address
                    )
                );
            })
        );

        assets.sort((first, second) =>
            first.symbol.localeCompare(
                second.symbol,
                undefined,
                {
                    numeric: true,
                    sensitivity: "base"
                }
            )
        );

        filteredAssets = [
            ...assets
        ];

        renderAssets();
        saveCachedAssetDetails();
    }
})().catch((error) => {
    console.warn(
        "Some asset details could not be loaded:",
        error
    );
});
}

assetFilter.addEventListener("input", filterAssets);

assetPrevious.addEventListener("click", () => {
    if (currentPage > 1) {
        currentPage -= 1;
        renderAssets();
        document.querySelector(".assets-list-card")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
});

assetNext.addEventListener("click", () => {
    const totalPages = Math.ceil(filteredAssets.length / pageSize);

    if (currentPage < totalPages) {
        currentPage += 1;
        renderAssets();
        document.querySelector(".assets-list-card")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
});

loadAssetsPage();
