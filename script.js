const searchType =
    document.getElementById("searchType");

const searchInput =
    document.getElementById("searchInput");

const searchButton =
    document.getElementById("searchButton");

const homeSearchForm =
    document.getElementById("homeSearchForm");

const homeBlocksList =
    document.getElementById("homeBlocksList");

const homeTransactionsList =
    document.getElementById("homeTransactionsList");

const marketPrice =
    document.getElementById("marketPrice");
const marketStatus =
    document.getElementById("marketStatus");
const marketChartPath =
    document.getElementById("marketChartPath");
const marketVolumeBars =
    document.getElementById("marketVolumeBars");
const marketAreaPath =
    document.getElementById("marketAreaPath");
const marketAreaStart =
    document.getElementById("marketAreaStart");
const marketAreaEnd =
    document.getElementById("marketAreaEnd");
const marketAxisLabels = [
    document.getElementById("marketAxisTop"),
    document.getElementById("marketAxisUpper"),
    document.getElementById("marketAxisLower"),
    document.getElementById("marketAxisBottom")
];
const marketTimeLabels = [
    document.getElementById("marketTimeStart"),
    document.getElementById("marketTimeFirst"),
    document.getElementById("marketTimeSecond"),
    document.getElementById("marketTimeEnd")
];
const marketCurrentBadge =
    document.getElementById("marketCurrentBadge");
const marketCurrentBadgeRect =
    document.getElementById("marketCurrentBadgeRect");
const marketCurrentBadgeText =
    document.getElementById("marketCurrentBadgeText");
const marketHoverLine =
    document.getElementById("marketHoverLine");
const marketHoverPoint =
    document.getElementById("marketHoverPoint");
const marketTooltip =
    document.getElementById("marketTooltip");
const marketTooltipTime =
    document.getElementById("marketTooltipTime");
const marketTooltipPrice =
    document.getElementById("marketTooltipPrice");
const marketTooltipVolume =
    document.getElementById("marketTooltipVolume");
const marketRangeButtons =
    document.querySelectorAll(
        "[data-market-range]"
    );

const client =
    KeetaNet.Client.fromNetwork("main");

const tokenDisplayCache =
    new Map();

let marketRequestInProgress = false;
let hasMarketData = false;
let marketChartPoints = [];
let marketChartVolumes = [];
let activeMarketRange = "1d";

searchType.addEventListener("change", () => {
    searchInput.setCustomValidity("");
});

async function runSearch() {
    const searchText =
        searchInput.value.trim();

    if (!searchText) {
        searchInput.focus();
        return;
    }

    const selectedType =
        searchType.value.toLowerCase();

    if (selectedType === "transaction") {
        const selectedTransaction =
            searchText.match(
                /^([0-9a-f]{64})(?::(\d+))?$/i
            );

        if (selectedTransaction) {
            window.location.assign(
                `transaction.html?block=${encodeURIComponent(
                    selectedTransaction[1]
                )}&operation=${encodeURIComponent(
                    selectedTransaction[2] || "0"
                )}`
            );
            return;
        }

        searchInput.setCustomValidity(
            "Enter a 64-character block hash, optionally followed by :operation."
        );
        searchInput.reportValidity();
        searchInput.addEventListener(
            "input",
            () => searchInput.setCustomValidity(""),
            { once: true }
        );
        return;
    }

    if (selectedType === "asset") {
        const assetAddress =
            await resolveAssetAddress(searchText);

        if (assetAddress) {
            window.location.assign(
                `asset.html?asset=${encodeURIComponent(
                    assetAddress
                )}`
            );
            return;
        }

        searchInput.setCustomValidity(
            "No matching asset was found."
        );
        searchInput.reportValidity();
        searchInput.addEventListener(
            "input",
            () => searchInput.setCustomValidity(""),
            { once: true }
        );
        return;
    }

    if (selectedType === "anchor") {
        const destination =
            await resolveAnchorDestination(searchText);

        if (destination) {
            window.location.assign(destination);
            return;
        }

        searchInput.setCustomValidity(
            "No indexed Anchor matches that ID."
        );
        searchInput.reportValidity();
        searchInput.addEventListener(
            "input",
            () => searchInput.setCustomValidity(""),
            { once: true }
        );
        return;
    }

    if (searchText.startsWith("keeta_")) {
        window.location.assign(
            `address.html?address=${encodeURIComponent(
                searchText
            )}`
        );
        return;
    }

    const transactionMatch =
        searchText.match(
            /^([0-9a-f]{64}):(\d+)$/i
        );

    if (transactionMatch) {
        window.location.assign(
            `transaction.html?block=${encodeURIComponent(
                transactionMatch[1]
            )}&operation=${encodeURIComponent(
                transactionMatch[2]
            )}`
        );
        return;
    }

    if (/^[0-9a-f]{64}$/i.test(searchText)) {
        window.location.assign(
            `block.html?hash=${encodeURIComponent(
                searchText
            )}`
        );
        return;
    }

    const routes = {
        transaction:
            `transaction.html?search=${encodeURIComponent(
                searchText
            )}`,
        address:
            `address.html?address=${encodeURIComponent(
                searchText
            )}`,
        block:
            `block.html?hash=${encodeURIComponent(
                searchText
            )}`,
        asset:
            `asset.html?asset=${encodeURIComponent(
                searchText
            )}`
    };

    const destination =
        routes[selectedType];

    if (!destination) {
        console.error(
            "Unknown search type:",
            searchType.value
        );
        return;
    }

    window.location.assign(destination);
}

homeSearchForm.addEventListener(
    "submit",
    (event) => {
        event.preventDefault();
        runSearch();
    }
);

function shortValue(
    value,
    start = 10,
    end = 6
) {
    if (!value) {
        return "Not available";
    }

    return `${value.slice(0, start)}...${value.slice(-end)}`;
}

async function getTokenDisplay(
    tokenAddress,
    rawAmount
) {
    let tokenInfo =
        tokenDisplayCache.get(
            tokenAddress
        );

    if (!tokenInfo) {
        const tokenAccount =
            KeetaNet.lib.Account
                .fromPublicKeyString(
                    tokenAddress
                );

        tokenInfo =
            await client.getAccountInfo(
                tokenAccount
            );

        tokenDisplayCache.set(
            tokenAddress,
            tokenInfo
        );
    }

    let decimals = 0;

    if (tokenInfo?.info?.metadata) {
        const metadata =
            JSON.parse(
                atob(
                    tokenInfo.info.metadata
                )
            );

        decimals =
            Number(
                metadata.decimalPlaces ||
                0
            );
    }

    return {
        amount:
            formatTokenAmount(
                rawAmount,
                decimals
            ),
        name:
            tokenInfo?.info?.name ||
            shortValue(
                tokenAddress,
                8,
                0
            )
    };
}

function createBlockRow(block) {
    const row =
        document.createElement("a");

    row.className =
        "home-preview-row";

    row.href =
        `block.html?hash=${encodeURIComponent(
            block.hash
        )}`;

    const operationCount =
        Number(
            block.operation_count
        );

    row.innerHTML = `
        <span class="preview-icon">□</span>

        <span class="preview-main">
            <strong>
                ${shortValue(block.hash, 10, 6)}
            </strong>

            <small>
                ${timeAgo(block.timestamp)}
            </small>
        </span>

        <span class="preview-value">
            ${operationCount.toLocaleString()}
            operation${operationCount === 1 ? "" : "s"}
        </span>
    `;

    return row;
}

async function createTransferRow(
    transfer
) {
    const row =
        document.createElement("a");

    row.className =
        "home-preview-row";

    row.href =
        `transaction.html?block=${encodeURIComponent(
            transfer.block_hash
        )}&operation=${transfer.operation_index}`;

    let amountText =
        BigInt(
            transfer.amount
        ).toLocaleString();

    let tokenText =
        shortValue(
            transfer.token,
            8,
            4
        );

    try {
        const tokenDisplay =
            await getTokenDisplay(
                transfer.token,
                transfer.amount
            );

        amountText =
            tokenDisplay.amount;

        tokenText =
            tokenDisplay.name;
    } catch (error) {
        console.warn(
            "Unable to format homepage token:",
            transfer.token,
            error
        );
    }

    row.innerHTML = `
        <span class="preview-icon">⇄</span>

        <span class="preview-main">
            <strong>
                ${shortValue(transfer.sender, 9, 5)}
                →
                ${shortValue(transfer.recipient, 9, 5)}
            </strong>

            <small>
                ${timeAgo(transfer.timestamp)}
            </small>
        </span>

        <span class="preview-value">
            ${amountText}
            ${tokenText}
        </span>
    `;

    return row;
}

function getMarketCurrency() {
    const currency =
        getSavedPreferences().currency
            ?.toUpperCase();

    return [
        "USD",
        "EUR",
        "GBP",
        "CAD",
        "AUD",
        "JPY"
    ].includes(currency)
        ? currency
        : "USD";
}

function formatMarketCurrency(
    value,
    maximumFractionDigits = 0
) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "—";
    }

    return new Intl.NumberFormat(
        undefined,
        {
            style: "currency",
            currency: getMarketCurrency(),
            maximumFractionDigits
        }
    ).format(number);
}

function formatMarketCompact(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "—";
    }

    return new Intl.NumberFormat(
        undefined,
        {
            notation: "compact",
            maximumFractionDigits: 2
        }
    ).format(number);
}

function formatMarketTimeLabel(timestamp) {
    const date = new Date(timestamp);

    if (
        activeMarketRange === "1h" ||
        activeMarketRange === "1d"
    ) {
        return date.toLocaleTimeString(
            [],
            {
                hour: "numeric",
                minute:
                    activeMarketRange === "1h"
                        ? "2-digit"
                        : undefined
            }
        );
    }

    return date.toLocaleDateString(
        [],
        {
            month: "short",
            day: "numeric"
        }
    );
}

function createMarketChartPath(prices) {
    const values =
        prices
            .map((point) => ({
                timestamp:
                    Number(point?.[0]),
                price:
                    Number(point?.[1])
            }))
            .filter(
                (point) =>
                    Number.isFinite(
                        point.timestamp
                    ) &&
                    Number.isFinite(
                        point.price
                    )
            );

    if (values.length < 2) {
        marketChartPoints = [];
        marketAreaPath.setAttribute("d", "");
        marketCurrentBadge.hidden = true;
        marketAxisLabels.forEach(
            (label) => {
                label.textContent = "—";
            }
        );
        return "";
    }

    const timeIndexes = [
        0,
        Math.round((values.length - 1) / 3),
        Math.round(((values.length - 1) * 2) / 3),
        values.length - 1
    ];

    marketTimeLabels.forEach(
        (label, index) => {
            label.textContent =
                formatMarketTimeLabel(
                    values[
                        timeIndexes[index]
                    ].timestamp
                );
        }
    );

    const priceValues =
        values.map(
            (point) => point.price
        );

    const minimum =
        Math.min(...priceValues);

    const maximum =
        Math.max(...priceValues);

    const range =
        maximum - minimum || 1;

    marketChartPoints =
        values.map(
            (point, index) => ({
                ...point,
                x:
                    15 +
                    (
                        index /
                        (values.length - 1)
                    ) *
                    635,
                y:
                    175 -
                    (
                        (point.price - minimum) /
                        range
                    ) *
                    135
            })
        );

    const linePath =
        marketChartPoints
            .map((point, index) =>
                `${index === 0 ? "M" : "L"}${point.x.toFixed(
                    1
                )} ${point.y.toFixed(1)}`
            )
            .join(" ");

    marketAreaPath.setAttribute(
        "d",
        `${linePath} L650 175 L15 175 Z`
    );

    const axisValues = [
        maximum,
        maximum - range / 3,
        maximum - (range * 2) / 3,
        minimum
    ];

    marketAxisLabels.forEach(
        (label, index) => {
            const value =
                axisValues[index];

            label.textContent =
                formatMarketCurrency(
                    value,
                    value < 1 ? 3 : 2
                );
        }
    );

    const latest =
        marketChartPoints[
            marketChartPoints.length - 1
        ];

    marketCurrentBadge.setAttribute(
        "transform",
        `translate(0 ${Math.max(
            0,
            Math.min(
                190,
                latest.y - 10
            )
        )})`
    );

    marketCurrentBadgeText.textContent =
        formatMarketCurrency(
            latest.price,
            latest.price < 1 ? 3 : 2
        );

    marketCurrentBadge.hidden = false;

    return linePath;
}

function renderMarketVolumeBars(
    volumes,
    directionColor
) {
    marketVolumeBars.replaceChildren();

    const values =
        volumes
            .map((point) =>
                Number(point?.[1])
            )
            .filter(Number.isFinite);

    if (values.length < 2) {
        return;
    }

    const barCount =
        Math.min(72, values.length);

    const sampledValues =
        Array.from(
            { length: barCount },
            (_, index) => {
                const sourceIndex =
                    Math.round(
                        (
                            index /
                            Math.max(
                                1,
                                barCount - 1
                            )
                        ) *
                        (values.length - 1)
                    );

                return values[sourceIndex];
            }
        );

    const sortedValues =
        [...sampledValues].sort(
            (a, b) => a - b
        );

    const scaleMaximum =
        sortedValues[
            Math.min(
                sortedValues.length - 1,
                Math.floor(
                    sortedValues.length * 0.9
                )
            )
        ] || 1;

    const chartWidth = 635;
    const barGap = 1.4;
    const barWidth =
        Math.max(
            1,
            chartWidth / barCount - barGap
        );

    sampledValues.forEach(
        (volume, index) => {
            const height =
                Math.max(
                    2,
                    Math.sqrt(
                        Math.min(
                            volume,
                            scaleMaximum
                        ) /
                        scaleMaximum
                    ) * 28
                );

            const bar =
                document.createElementNS(
                    "http://www.w3.org/2000/svg",
                    "rect"
                );

            bar.setAttribute(
                "x",
                String(
                    15 +
                    index *
                    (chartWidth / barCount)
                )
            );
            bar.setAttribute(
                "y",
                String(175 - height)
            );
            bar.setAttribute(
                "width",
                String(barWidth)
            );
            bar.setAttribute(
                "height",
                String(height)
            );
            bar.style.fill =
                directionColor;

            marketVolumeBars.appendChild(
                bar
            );
        }
    );
}

function hideMarketTooltip() {
    marketHoverLine.setAttribute("hidden", "");
    marketHoverPoint.setAttribute("hidden", "");
    marketTooltip.hidden = true;
}

function showMarketTooltip(event) {
    if (marketChartPoints.length < 2) {
        return;
    }

    const svg =
        marketChartPath.ownerSVGElement;

    const svgBounds =
        svg.getBoundingClientRect();

    const pointerX =
        Math.max(
            15,
            Math.min(
                650,
                (
                    (event.clientX - svgBounds.left) /
                    svgBounds.width
                ) *
                700
            )
        );

    const index =
        Math.max(
            0,
            Math.min(
                marketChartPoints.length - 1,
                Math.round(
                    (
                        (pointerX - 15) /
                        635
                    ) *
                    (
                        marketChartPoints.length - 1
                    )
                )
            )
        );

    const point =
        marketChartPoints[index];

    const volumeIndex =
        marketChartVolumes.length > 1
            ? Math.round(
                (
                    index /
                    (
                        marketChartPoints.length - 1
                    )
                ) *
                (
                    marketChartVolumes.length - 1
                )
            )
            : 0;

    const volume =
        Number(
            marketChartVolumes[
                volumeIndex
            ]?.[1]
        );

    marketHoverLine.setAttribute(
        "x1",
        point.x
    );

    marketHoverLine.setAttribute(
        "x2",
        point.x
    );

    marketHoverPoint.setAttribute(
        "cx",
        point.x
    );

    marketHoverPoint.setAttribute(
        "cy",
        point.y
    );

    marketTooltipTime.textContent =
        new Date(
            point.timestamp
        ).toLocaleString();

    marketTooltipPrice.textContent =
        formatMarketCurrency(
            point.price,
            point.price < 1 ? 6 : 2
        );

    marketTooltipVolume.textContent =
        formatMarketCurrency(
            volume
        );

    marketHoverLine.removeAttribute("hidden");
    marketHoverPoint.removeAttribute("hidden");
    marketTooltip.hidden = false;

    const chartContainer =
        svg.closest(
            ".market-placeholder"
        );

    const containerBounds =
        chartContainer.getBoundingClientRect();

    const tooltipWidth =
        marketTooltip.offsetWidth;

    const left =
        Math.max(
            12,
            Math.min(
                containerBounds.width -
                    tooltipWidth -
                    12,
                event.clientX -
                    containerBounds.left +
                    14
            )
        );

    marketTooltip.style.left =
        `${left}px`;

    marketTooltip.style.top =
        `${Math.max(
            82,
            event.clientY -
                containerBounds.top -
                92
        )}px`;
}

marketChartPath
    .ownerSVGElement
    .addEventListener(
        "pointermove",
        showMarketTooltip
    );

marketChartPath
    .ownerSVGElement
    .addEventListener(
        "pointerleave",
        hideMarketTooltip
    );


marketRangeButtons.forEach((button) => {
    button.setAttribute(
        "aria-pressed",
        String(
            button.dataset.marketRange ===
            activeMarketRange
        )
    );

    button.addEventListener("click", () => {
        const range =
            button.dataset.marketRange;

        if (
            !range ||
            range === activeMarketRange
        ) {
            return;
        }

        activeMarketRange = range;

        marketRangeButtons.forEach(
            (rangeButton) => {
                const selected =
                    rangeButton === button;

                rangeButton.classList.toggle(
                    "active",
                    selected
                );

                rangeButton.setAttribute(
                    "aria-pressed",
                    String(selected)
                );
            }
        );

        marketStatus.textContent =
            "Loading selected chart range…";

        hideMarketTooltip();
        loadMarketData(range);
    });
});

async function loadMarketData(
    range = activeMarketRange
) {
    if (marketRequestInProgress) {
        return;
    }

    marketRequestInProgress = true;

    try {
        const response =
            await fetchKeetaView(
                `http://localhost:3000/api/market?range=${encodeURIComponent(
                    range
                )}&currency=${encodeURIComponent(
                    getMarketCurrency().toLowerCase()
                )}`,
                {
                    cache: "no-store"
                }
            );

        if (!response.ok) {
            throw new Error(
                "Market endpoint unavailable."
            );
        }

        const market =
            await response.json();

        const price =
            Number(market.price);

        const change =
            Number(market.priceChange24h);

        const directionColor =
            change > 0
                ? "#16a34a"
                : change < 0
                    ? "#dc2626"
                    : "#1676cf";

        marketPrice.textContent =
            Number.isFinite(price)
                ? `${formatMarketCurrency(
                    price,
                    price < 1 ? 5 : 2
                )} KTA`
                : "KTA price unavailable";

        marketPrice.style.color =
            directionColor;

        const rangeLabel = {
            "1h": "1H",
            "1d": "1D",
            "1w": "1W",
            "1m": "1M"
        }[range] || "1D";

        marketStatus.textContent =
            Number.isFinite(change)
                ? `● Live · ${rangeLabel} view · ${change >= 0 ? "+" : ""}${change.toFixed(
                    2
                )}% over 24 hours · Updated ${timeAgo(
                    market.updatedAt
                )}`
                : `● Live · ${rangeLabel} view · Updated ${timeAgo(
                    market.updatedAt
                )}`;

        marketStatus.style.color =
            directionColor;

        document.getElementById(
            "marketCap"
        ).textContent =
            formatMarketCurrency(
                market.marketCap
            );

        document.getElementById(
            "marketVolume"
        ).textContent =
            formatMarketCurrency(
                market.volume24h
            );

        document.getElementById(
            "marketSupply"
        ).textContent =
            `${formatMarketCompact(
                market.circulatingSupply
            )} KTA`;

        document.getElementById(
            "marketAth"
        ).textContent =
            formatMarketCurrency(
                market.allTimeHigh,
                2
            );

        marketChartVolumes =
            Array.isArray(
                market.volumes
            )
                ? market.volumes
                : [];

        marketChartPath.setAttribute(
            "d",
            createMarketChartPath(
                market.prices || []
            )
        );

        renderMarketVolumeBars(
            marketChartVolumes,
            directionColor
        );

        hideMarketTooltip();

        marketChartPath.style.stroke =
            directionColor;

        marketHoverPoint.style.fill =
            directionColor;

        marketHoverPoint.style.stroke =
            "#ffffff";

        marketHoverPoint.style.strokeWidth =
            "3";

        marketHoverPoint.setAttribute(
            "r",
            "6"
        );

        marketHoverPoint.style.filter =
            `drop-shadow(0 0 4px ${directionColor}) drop-shadow(0 0 8px ${directionColor})`;

        marketAreaStart.setAttribute(
            "stop-color",
            directionColor
        );

        marketAreaEnd.setAttribute(
            "stop-color",
            directionColor
        );

        marketCurrentBadgeRect.style.fill =
            directionColor;

        hasMarketData = true;
    } catch (error) {
        console.error(
            "Market loading error:",
            error
        );

        if (hasMarketData) {
            marketStatus.textContent =
                "Live update paused · Showing the last successful market data";
            marketStatus.style.color =
                "#b45309";
        } else {
            marketPrice.textContent =
                "KTA market data unavailable";

            marketStatus.textContent =
                "The verified market feed could not be reached. KeetaView will retry automatically.";

            marketChartPath.setAttribute(
                "d",
                ""
            );

            marketAreaPath.setAttribute(
                "d",
                ""
            );

            marketCurrentBadge.hidden = true;
        }
    } finally {
        marketRequestInProgress = false;
    }
}

async function loadHomepage() {
    try {
        const [
            statusResponse,
            blocksResponse,
            transfersResponse
        ] =
            await Promise.all([
                fetchKeetaView(
                    "http://localhost:3000/api/status"
                ),
                fetchKeetaView(
                    "http://localhost:3000/api/blocks?limit=6&offset=0"
                ),
                fetchKeetaView(
                    "http://localhost:3000/api/transfers?limit=6"
                )
            ]);

        if (
            !statusResponse.ok ||
            !blocksResponse.ok ||
            !transfersResponse.ok
        ) {
            throw new Error(
                "KeetaView API did not return homepage data."
            );
        }

        const status =
            await statusResponse.json();

        const blocks =
            await blocksResponse.json();

        const transfers =
            await transfersResponse.json();

        document.getElementById(
            "snapshotBlocks"
        ).textContent =
            Number(
                status.blocks
            ).toLocaleString();

        document.getElementById(
            "snapshotTransfers"
        ).textContent =
            Number(
                status.transfers
            ).toLocaleString();

        document.getElementById(
            "snapshotAccounts"
        ).textContent =
            Number(
                status.accounts
            ).toLocaleString();

        const totalRecentOperations =
            blocks.reduce(
                (total, block) =>
                    total +
                    Number(
                        block.operation_count
                    ),
                0
            );

        const recentAverage =
            blocks.length > 0
                ? totalRecentOperations /
                    blocks.length
                : 0;

        document.getElementById(
            "snapshotAverage"
        ).textContent =
            recentAverage.toFixed(2);

        homeBlocksList.innerHTML = "";

        blocks.forEach((block) => {
            homeBlocksList.appendChild(
                createBlockRow(block)
            );
        });

        homeTransactionsList.innerHTML = "";

        const transferRows =
            await Promise.all(
                transfers.map(
                    createTransferRow
                )
            );

        transferRows.forEach((row) => {
            homeTransactionsList.appendChild(
                row
            );
        });
    } catch (error) {
        console.error(
            "Homepage loading error:",
            error
        );

        homeBlocksList.innerHTML =
            "<p class=\"home-error\">Start the KeetaView API to load indexed blocks.</p>";

        homeTransactionsList.innerHTML =
            "<p class=\"home-error\">Start the KeetaView API to load indexed transactions.</p>";
    }
}

function loadKnownAssets() {
    const saved =
        localStorage.getItem(
            "keetascan_known_assets"
        );

    return saved
        ? JSON.parse(saved)
        : [];
}

async function rememberRecentAssets() {
    try {
        const history =
            await client.getHistory(
                null,
                {
                    depth: 20
                }
            );

        const knownAssets =
            new Set(
                loadKnownAssets()
            );

        history
            .flatMap(
                (entry) =>
                    entry.voteStaple.blocks
            )
            .forEach((block) => {
                block.operations.forEach(
                    (operation) => {
                        const token =
                            operation.token
                                ?.publicKeyString
                                ?.toString?.();

                        if (token) {
                            knownAssets.add(token);
                        }
                    }
                );
            });

        localStorage.setItem(
            "keetascan_known_assets",
            JSON.stringify(
                [...knownAssets]
            )
        );
    } catch (error) {
        console.warn(
            "Recent asset discovery failed:",
            error
        );
    }
}

loadHomepage();
loadMarketData();

window.setInterval(
    loadMarketData,
    60 * 1000
);

rememberRecentAssets();
