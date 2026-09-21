const analyticsClient =
    KeetaNet.Client.fromNetwork("main");

const analyticsTokenCache =
    new Map();

function shortAnalyticsValue(
    value,
    start = 12,
    end = 6
) {
    if (!value) {
        return "Not available";
    }

    return formatKeetaIdentifier(value, start, end);
}

function formatIndexedDate(value) {
    if (!value) {
        return "Not available";
    }

    return formatKeetaDate(value);
}

let activeAnalyticsTokenRequests = 0;
const analyticsTokenRequestQueue = [];
const maximumAnalyticsTokenRequests = 8;

function runAnalyticsTokenQueue() {
    while (
        activeAnalyticsTokenRequests <
            maximumAnalyticsTokenRequests &&
        analyticsTokenRequestQueue.length
    ) {
        const request =
            analyticsTokenRequestQueue.shift();

        activeAnalyticsTokenRequests += 1;

        request.task()
            .then(request.resolve)
            .catch(request.reject)
            .finally(() => {
                activeAnalyticsTokenRequests -= 1;
                runAnalyticsTokenQueue();
            });
    }
}

function queueAnalyticsTokenRequest(task) {
    return new Promise(
        (resolve, reject) => {
            analyticsTokenRequestQueue.push({
                task,
                resolve,
                reject
            });

            runAnalyticsTokenQueue();
        }
    );
}

async function getAnalyticsToken(tokenAddress) {
    if (analyticsTokenCache.has(tokenAddress)) {
        return await analyticsTokenCache.get(
            tokenAddress
        );
    }

    const fallback = {
        name:
            shortAnalyticsValue(
                tokenAddress,
                8,
                4
            ),
        decimals: 0
    };

    const request =
        queueAnalyticsTokenRequest(
            async () => {
                try {
                    const tokenAccount =
                        KeetaNet.lib.Account
                            .fromPublicKeyString(
                                tokenAddress
                            );

                    const tokenInfo =
                        await analyticsClient
                            .getAccountInfo(
                                tokenAccount
                            );

                    let decimals = 0;

                    if (
                        tokenInfo?.info?.metadata
                    ) {
                        const metadata =
                            JSON.parse(
                                atob(
                                    tokenInfo
                                        .info
                                        .metadata
                                )
                            );

                        decimals =
                            Number(
                                metadata
                                    .decimalPlaces ||
                                0
                            );
                    }

                    return {
                        name:
                            tokenInfo?.info?.name ||
                            fallback.name,
                        decimals
                    };
                } catch (error) {
                    console.warn(
                        "Unable to resolve analytics token:",
                        tokenAddress,
                        error
                    );

                    return fallback;
                }
            }
        );

    analyticsTokenCache.set(
        tokenAddress,
        request
    );

    const result = await request;

    analyticsTokenCache.set(
        tokenAddress,
        result
    );

    return result;
}

function renderActivityChart(
    activity,
    {
        elementId = "activityChart",
        valueKey = "transfers",
        unit = "transfer"
    } = {}
) {
    const chart =
        document.getElementById(
            elementId
        );

    chart.innerHTML = "";

    if (!activity.length) {
        chart.innerHTML =
            '<p class="analytics-empty">No indexed activity is available yet.</p>';
        return;
    }

    const maximum =
        Math.max(
            ...activity.map(
                item =>
                    Number(item[valueKey])
            ),
            1
        );

    activity.forEach((item) => {
        const value =
            Number(item[valueKey]);

        const height =
            Math.max(
                (value / maximum) * 100,
                4
            );

        const column =
            document.createElement("div");

        column.className =
            "analytics-chart-column";

        const date =
            new Date(
                `${item.day}T00:00:00`
            );

        const label =
            date.toLocaleDateString(
                undefined,
                {
                    month: "short",
                    day: "numeric"
                }
            );

        column.title =
            `${label}: ${value.toLocaleString()} ${unit}${value === 1 ? "" : "s"}`;

        column.tabIndex = 0;
        column.style.setProperty(
            "--bar-height",
            `${height}%`
        );

        column.innerHTML = `
            <strong>${value.toLocaleString()}</strong>

            <div class="analytics-bar-track">
                <div
                    class="analytics-bar-tooltip"
                    role="tooltip"
                >
                    <strong>${label}</strong>
                    <span>
                        ${value.toLocaleString()}
                        ${unit}${value === 1 ? "" : "s"}
                    </span>
                </div>

                <div
                    class="analytics-bar"
                    style="height: ${height}%"
                ></div>
            </div>

            <span>${label}</span>
        `;

        chart.appendChild(column);
    });
}

function renderRankedAccounts(
    elementId,
    entries,
    unit
) {
    const list =
        document.getElementById(
            elementId
        );

    list.innerHTML = "";

    if (!entries.length) {
        list.innerHTML =
            '<p class="analytics-empty">No indexed activity is available.</p>';
        return;
    }

    entries.forEach((entry, index) => {
        const row =
            document.createElement("div");

        row.className =
            "analytics-ranked-row";

        row.innerHTML = `
            <span class="analytics-rank">#${index + 1}</span>

            <a href="address.html?address=${encodeURIComponent(
                entry.address
            )}">
                ${shortAnalyticsValue(entry.address)}
            </a>

            <strong>
                ${Number(entry.total).toLocaleString()}
                ${unit}
            </strong>
        `;

        list.appendChild(row);
    });
}

function renderTokenActivity(entries) {
    const list =
        document.getElementById(
            "tokenActivity"
        );

    list.innerHTML = "";

    if (!entries.length) {
        list.innerHTML =
            '<p class="analytics-empty">No indexed asset movement is available.</p>';
        return;
    }

    entries.forEach((entry, index) => {
        const row =
            document.createElement("div");

        row.className =
            "analytics-ranked-row";

        const link =
            document.createElement("a");

        link.href =
            `asset.html?asset=${encodeURIComponent(
                entry.token
            )}`;

        link.textContent =
            shortAnalyticsValue(
                entry.token,
                8,
                4
            );

        row.innerHTML = `
            <span class="analytics-rank">#${index + 1}</span>
        `;

        row.appendChild(link);

        const total =
            document.createElement("strong");

        total.textContent =
            `${Number(
                entry.transfers
            ).toLocaleString()} transfers`;

        row.appendChild(total);
        list.appendChild(row);

        getAnalyticsToken(entry.token)
            .then((token) => {
                link.textContent = token.name;
            });
    });
}

function renderRecentTransfers(transfers) {
    const list =
        document.getElementById(
            "analyticsRecentTransfers"
        );

    list.innerHTML = "";

    if (!transfers.length) {
        list.innerHTML =
            '<p class="analytics-empty">No indexed transfers are available.</p>';
        return;
    }

    transfers.forEach((transfer) => {
        const row =
            document.createElement("a");

        row.className =
            "analytics-transfer-row";

        row.href =
            `transaction.html?block=${encodeURIComponent(
                transfer.block_hash
            )}&operation=${encodeURIComponent(
                transfer.operation_index
            )}`;

        row.innerHTML = `
            <span class="analytics-transfer-icon">⇄</span>

            <span class="analytics-transfer-route">
                <strong>
                    ${shortAnalyticsValue(
                        transfer.sender,
                        9,
                        5
                    )}
                    →
                    ${shortAnalyticsValue(
                        transfer.recipient,
                        9,
                        5
                    )}
                </strong>

                <small>
                    ${timeAgo(
                        transfer.timestamp
                    )}
                </small>
            </span>

            <span class="analytics-transfer-amount">
                ${transfer.amount}
                ${shortAnalyticsValue(
                    transfer.token,
                    8,
                    4
                )}
            </span>
        `;

        list.appendChild(row);

        const amountElement =
            row.querySelector(
                ".analytics-transfer-amount"
            );

        getAnalyticsToken(transfer.token)
            .then((token) => {
                let amount =
                    transfer.amount;

                try {
                    amount =
                        formatTokenAmount(
                            transfer.amount,
                            token.decimals
                        );
                } catch (error) {
                    console.warn(
                        "Unable to format indexed transfer:",
                        error
                    );
                }

                amountElement.textContent =
                    `${amount} ${token.name}`;
            });
    });
}

function initializeAnalyticsScrollIndicators() {
    const listIds = [
        "topSenders",
        "topRecipients",
        "tokenActivity",
        "analyticsRecentTransfers"
    ];

    listIds.forEach((listId) => {
        const list =
            document.getElementById(listId);

        if (!list || list.closest(".analytics-scroll-shell")) {
            return;
        }

        const shell =
            document.createElement("div");
        const track =
            document.createElement("div");
        const thumb =
            document.createElement("div");

        shell.className = "analytics-scroll-shell";
        track.className = "analytics-scroll-track";
        thumb.className = "analytics-scroll-thumb";
        track.setAttribute("aria-hidden", "true");

        list.parentNode.insertBefore(shell, list);
        shell.appendChild(list);
        shell.appendChild(track);
        track.appendChild(thumb);

        const updateIndicator = () => {
            const maxScroll =
                list.scrollHeight - list.clientHeight;
            const availableTravel =
                Math.max(0, track.clientHeight - thumb.offsetHeight);
            const progress = maxScroll > 0
                ? list.scrollTop / maxScroll
                : 0;

            track.hidden = maxScroll <= 0;
            thumb.style.transform =
                `translateY(${progress * availableTravel}px)`;
        };

        list.addEventListener(
            "scroll",
            updateIndicator,
            { passive: true }
        );

        new ResizeObserver(
            updateIndicator
        ).observe(list);

        new MutationObserver(
            updateIndicator
        ).observe(
            list,
            {
                childList: true,
                subtree: true
            }
        );

        window.requestAnimationFrame(
            updateIndicator
        );
    });
}

function renderRecentAnchors(anchors) {
    const list =
        document.getElementById(
            "recentAnchors"
        );

    list.innerHTML = "";

    if (!anchors.length) {
        list.innerHTML =
            '<p class="analytics-empty">No indexed Anchors are available yet.</p>';
        return;
    }

    anchors.forEach((anchor) => {
        const row =
            document.createElement("a");

        row.className =
            "analytics-transfer-row";

        row.href =
            `transaction.html?block=${encodeURIComponent(
                anchor.block_hash
            )}&operation=${encodeURIComponent(
                anchor.operation_index
            )}`;

        row.innerHTML = `
            <span class="analytics-transfer-icon">A</span>

            <span class="analytics-transfer-route">
                <strong>
                    ${shortAnalyticsValue(
                        anchor.source_address,
                        9,
                        5
                    )}
                </strong>

                <small>
                    ${timeAgo(anchor.timestamp)}
                </small>
            </span>

            <span class="analytics-transfer-amount">
                ${Number(
                    anchor.relationships
                ).toLocaleString()}
                relationship${Number(anchor.relationships) === 1 ? "" : "s"}
            </span>
        `;

        list.appendChild(row);
    });
}

function formatAnalyticsCurrency(
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
            currency: "USD",
            maximumFractionDigits
        }
    ).format(number);
}

let activeAnalyticsMarketRange = "1d";

function createAnalyticsSvgElement(
    name,
    attributes = {}
) {
    const element =
        document.createElementNS(
            "http://www.w3.org/2000/svg",
            name
        );

    Object.entries(attributes).forEach(
        ([key, value]) => {
            element.setAttribute(
                key,
                String(value)
            );
        }
    );

    return element;
}

function formatAnalyticsChartTime(
    timestamp,
    range
) {
    const date = new Date(timestamp);

    if (
        range === "1h" ||
        range === "1d"
    ) {
        return date.toLocaleTimeString(
            [],
            {
                hour: "numeric",
                minute:
                    range === "1h"
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

function renderAnalyticsMarketChart(
    market,
    directionColor,
    range
) {
    const svg =
        document.getElementById(
            "analyticsMarketChartSvg"
        );

    const line =
        document.getElementById(
            "analyticsMarketLine"
        );

    const area =
        document.getElementById(
            "analyticsMarketArea"
        );

    const grid =
        document.getElementById(
            "analyticsMarketGrid"
        );

    const axis =
        document.getElementById(
            "analyticsMarketAxis"
        );

    const volumeBars =
        document.getElementById(
            "analyticsMarketVolumeBars"
        );

    const hoverLine =
        document.getElementById(
            "analyticsMarketHoverLine"
        );

    const hoverPoint =
        document.getElementById(
            "analyticsMarketHoverPoint"
        );

    const tooltip =
        document.getElementById(
            "analyticsMarketTooltip"
        );

    const prices =
        (market.prices || [])
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

    const volumes =
        Array.isArray(market.volumes)
            ? market.volumes
            : [];

    grid.replaceChildren();
    axis.replaceChildren();
    volumeBars.replaceChildren();

    if (prices.length < 2) {
        line.setAttribute("d", "");
        area.setAttribute("d", "");
        return;
    }

    const bounds = {
        left: 42,
        right: 930,
        top: 28,
        bottom: 278
    };

    const width =
        bounds.right - bounds.left;

    const height =
        bounds.bottom - bounds.top;

    const priceValues =
        prices.map(
            (point) => point.price
        );

    const minimum =
        Math.min(...priceValues);

    const maximum =
        Math.max(...priceValues);

    const priceRange =
        maximum - minimum || 1;

    const points =
        prices.map(
            (point, index) => ({
                ...point,
                x:
                    bounds.left +
                    (
                        index /
                        (prices.length - 1)
                    ) *
                    width,
                y:
                    bounds.bottom -
                    (
                        (
                            point.price -
                            minimum
                        ) /
                        priceRange
                    ) *
                    height
            })
        );

    const linePath =
        points
            .map(
                (point, index) =>
                    `${index === 0 ? "M" : "L"}${point.x.toFixed(
                        1
                    )} ${point.y.toFixed(1)}`
            )
            .join(" ");

    line.setAttribute(
        "d",
        linePath
    );

    line.style.stroke =
        directionColor;

    area.setAttribute(
        "d",
        `${linePath} L${bounds.right} ${bounds.bottom} L${bounds.left} ${bounds.bottom} Z`
    );

    document.getElementById(
        "analyticsMarketGradientStart"
    ).setAttribute(
        "stop-color",
        directionColor
    );

    document.getElementById(
        "analyticsMarketGradientEnd"
    ).setAttribute(
        "stop-color",
        directionColor
    );

    for (let index = 0; index < 4; index += 1) {
        const ratio =
            index / 3;

        const y =
            bounds.top +
            ratio * height;

        const value =
            maximum -
            ratio * priceRange;

        grid.appendChild(
            createAnalyticsSvgElement(
                "line",
                {
                    x1: bounds.left,
                    y1: y,
                    x2: bounds.right,
                    y2: y
                }
            )
        );

        const label =
            createAnalyticsSvgElement(
                "text",
                {
                    x: 990,
                    y: y + 4,
                    "text-anchor": "end"
                }
            );

        label.textContent =
            formatAnalyticsCurrency(
                value,
                value < 1 ? 3 : 2
            );

        axis.appendChild(label);
    }

    const timeIndexes = [
        0,
        Math.round(
            (points.length - 1) / 3
        ),
        Math.round(
            ((points.length - 1) * 2) / 3
        ),
        points.length - 1
    ];

    timeIndexes.forEach(
        (pointIndex, index) => {
            const point =
                points[pointIndex];

            const label =
                createAnalyticsSvgElement(
                    "text",
                    {
                        x: point.x,
                        y: 324,
                        "text-anchor":
                            index === 0
                                ? "start"
                                : index === 3
                                    ? "end"
                                    : "middle"
                    }
                );

            label.textContent =
                formatAnalyticsChartTime(
                    point.timestamp,
                    range
                );

            axis.appendChild(label);
        }
    );

    const volumeValues =
        volumes
            .map((point) =>
                Number(point?.[1])
            )
            .filter(Number.isFinite);

    if (volumeValues.length > 1) {
        const barCount =
            Math.min(
                90,
                volumeValues.length
            );

        const sampled =
            Array.from(
                { length: barCount },
                (_, index) =>
                    volumeValues[
                        Math.round(
                            (
                                index /
                                (barCount - 1)
                            ) *
                            (
                                volumeValues.length -
                                1
                            )
                        )
                    ]
            );

        const sorted =
            [...sampled].sort(
                (a, b) => a - b
            );

        const scaleMaximum =
            sorted[
                Math.min(
                    sorted.length - 1,
                    Math.floor(
                        sorted.length * 0.9
                    )
                )
            ] || 1;

        sampled.forEach(
            (volume, index) => {
                const barHeight =
                    Math.max(
                        2,
                        Math.sqrt(
                            Math.min(
                                volume,
                                scaleMaximum
                            ) /
                            scaleMaximum
                        ) * 38
                    );

                const bar =
                    createAnalyticsSvgElement(
                        "rect",
                        {
                            x:
                                bounds.left +
                                index *
                                (
                                    width /
                                    barCount
                                ),
                            y:
                                bounds.bottom -
                                barHeight,
                            width:
                                Math.max(
                                    1,
                                    width /
                                    barCount -
                                    1.5
                                ),
                            height:
                                barHeight
                        }
                    );

                bar.style.fill =
                    directionColor;

                volumeBars.appendChild(
                    bar
                );
            }
        );
    }

    hoverPoint.style.fill =
        directionColor;

    hoverPoint.style.filter =
        `drop-shadow(0 0 5px ${directionColor}) drop-shadow(0 0 10px ${directionColor})`;

    function hideTooltip() {
        hoverLine.setAttribute(
            "hidden",
            ""
        );
        hoverPoint.setAttribute(
            "hidden",
            ""
        );
        tooltip.hidden = true;
    }

    svg.onpointermove = (event) => {
        const rectangle =
            svg.getBoundingClientRect();

        const pointerX =
            Math.max(
                bounds.left,
                Math.min(
                    bounds.right,
                    (
                        (
                            event.clientX -
                            rectangle.left
                        ) /
                        rectangle.width
                    ) *
                    1000
                )
            );

        const pointIndex =
            Math.max(
                0,
                Math.min(
                    points.length - 1,
                    Math.round(
                        (
                            (
                                pointerX -
                                bounds.left
                            ) /
                            width
                        ) *
                        (
                            points.length -
                            1
                        )
                    )
                )
            );

        const point =
            points[pointIndex];

        const volumeIndex =
            volumes.length > 1
                ? Math.round(
                    (
                        pointIndex /
                        (
                            points.length -
                            1
                        )
                    ) *
                    (
                        volumes.length -
                        1
                    )
                )
                : 0;

        const volume =
            Number(
                volumes[
                    volumeIndex
                ]?.[1]
            );

        hoverLine.setAttribute(
            "x1",
            point.x
        );
        hoverLine.setAttribute(
            "x2",
            point.x
        );
        hoverLine.setAttribute(
            "y1",
            bounds.top
        );
        hoverLine.setAttribute(
            "y2",
            bounds.bottom
        );

        hoverPoint.setAttribute(
            "cx",
            point.x
        );
        hoverPoint.setAttribute(
            "cy",
            point.y
        );

        document.getElementById(
            "analyticsMarketTooltipTime"
        ).textContent =
            new Date(
                point.timestamp
            ).toLocaleString();

        document.getElementById(
            "analyticsMarketTooltipPrice"
        ).textContent =
            formatAnalyticsCurrency(
                point.price,
                point.price < 1 ? 6 : 2
            );

        document.getElementById(
            "analyticsMarketTooltipVolume"
        ).textContent =
            formatAnalyticsCurrency(
                volume
            );

        hoverLine.removeAttribute(
            "hidden"
        );
        hoverPoint.removeAttribute(
            "hidden"
        );
        tooltip.hidden = false;

        const stage =
            svg.parentElement;

        const stageBounds =
            stage.getBoundingClientRect();

        const tooltipWidth =
            tooltip.offsetWidth;

        tooltip.style.left =
            `${Math.max(
                12,
                Math.min(
                    stageBounds.width -
                    tooltipWidth -
                    12,
                    event.clientX -
                    stageBounds.left +
                    16
                )
            )}px`;

        tooltip.style.top =
            `${Math.max(
                12,
                event.clientY -
                stageBounds.top -
                98
            )}px`;
    };

    svg.onpointerleave =
        hideTooltip;

    hideTooltip();
}

async function loadMarketAnalytics(
    range = activeAnalyticsMarketRange
) {
    const status =
        document.getElementById(
            "analyticsMarketStatus"
        );

    try {
        const response =
            await fetchKeetaView(
                `http://localhost:3000/api/market?range=${encodeURIComponent(
                    range
                )}`,
                {
                    cache: "no-store"
                }
            );

        if (!response.ok) {
            throw new Error(
                `Market API returned ${response.status}`
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

        document.getElementById(
            "analyticsMarketPrice"
        ).textContent =
            `${formatAnalyticsCurrency(
                price,
                price < 1 ? 5 : 2
            )} KTA`;

        const changeElement =
            document.getElementById(
                "analyticsMarketChange"
            );

        changeElement.textContent =
            Number.isFinite(change)
                ? `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
                : "—";

        changeElement.style.color =
            directionColor;

        document.getElementById(
            "analyticsMarketCap"
        ).textContent =
            formatAnalyticsCurrency(
                market.marketCap
            );

        document.getElementById(
            "analyticsMarketVolume"
        ).textContent =
            formatAnalyticsCurrency(
                market.volume24h
            );

        document.getElementById(
            "analyticsMarketSupply"
        ).textContent =
            `${Number(
                market.circulatingSupply
            ).toLocaleString(
                undefined,
                {
                    notation: "compact",
                    maximumFractionDigits: 2
                }
            )} KTA`;

        document.getElementById(
            "analyticsMarketAth"
        ).textContent =
            formatAnalyticsCurrency(
                market.allTimeHigh,
                2
            );

        const rangeLabel = {
            "1h": "1H",
            "1d": "1D",
            "1w": "1W",
            "1m": "1M"
        }[range] || "1D";

        status.textContent =
            `Live · ${rangeLabel} view · Updated ${timeAgo(
                market.updatedAt
            )}`;

        status.style.color =
            directionColor;

        renderAnalyticsMarketChart(
            market,
            directionColor,
            range
        );
    } catch (error) {
        console.error(
            "Market analytics loading error:",
            error
        );

        status.textContent =
            "Market feed temporarily unavailable";
        status.style.color =
            "#b45309";
    }
}

function initializeAnalyticsMarketChart() {
    const buttons =
        document.querySelectorAll(
            "[data-analytics-market-range]"
        );

    buttons.forEach((button) => {
        const selected =
            button.dataset
                .analyticsMarketRange ===
            activeAnalyticsMarketRange;

        button.setAttribute(
            "aria-pressed",
            String(selected)
        );

        button.addEventListener(
            "click",
            () => {
                const range =
                    button.dataset
                        .analyticsMarketRange;

                if (
                    !range ||
                    range ===
                        activeAnalyticsMarketRange
                ) {
                    return;
                }

                activeAnalyticsMarketRange =
                    range;

                buttons.forEach(
                    (rangeButton) => {
                        const isSelected =
                            rangeButton ===
                            button;

                        rangeButton
                            .classList
                            .toggle(
                                "active",
                                isSelected
                            );

                        rangeButton
                            .setAttribute(
                                "aria-pressed",
                                String(
                                    isSelected
                                )
                            );
                    }
                );

                loadMarketAnalytics(
                    range
                );
            }
        );
    });
}

function initializeAnalyticsTabs() {
    const networkTab =
        document.getElementById(
            "networkTab"
        );

    const marketTab =
        document.getElementById(
            "marketTab"
        );

    const networkView =
        document.getElementById(
            "networkAnalytics"
        );

    const marketView =
        document.getElementById(
            "marketAnalytics"
        );

    function selectView(view) {
        const showNetwork =
            view === "network";

        networkView.hidden =
            !showNetwork;

        marketView.hidden =
            showNetwork;

        networkTab.classList.toggle(
            "active",
            showNetwork
        );

        marketTab.classList.toggle(
            "active",
            !showNetwork
        );

        networkTab.setAttribute(
            "aria-selected",
            String(showNetwork)
        );

        marketTab.setAttribute(
            "aria-selected",
            String(!showNetwork)
        );
    }

    networkTab.addEventListener(
        "click",
        () => selectView("network")
    );

    marketTab.addEventListener(
        "click",
        () => selectView("market")
    );
}

function showAnalyticsError(error) {
    console.error(
        "Analytics loading error:",
        error
    );

    document.getElementById(
        "networkAnalytics"
    ).innerHTML = `
        <article class="analytics-dashboard-card analytics-error-card">
            <h2>Analytics API unavailable</h2>
            <p>
                Start the KeetaView API with
                <code>node indexer/server.js</code>,
                then refresh this page.
            </p>
        </article>
    `;
}

async function loadAnalytics() {
    try {
        const response =
    await fetchKeetaView(
        "http://localhost:3000/api/analytics",
        {
            cache: "no-store",
            timeout: 45000
        }
    );

        if (!response.ok) {
            throw new Error(
                `Analytics API returned ${response.status}`
            );
        }

        const analytics =
            await response.json();

        const summary =
            analytics.summary;

        document.getElementById(
            "analyticsBlocks"
        ).textContent =
            Number(
                summary.blocks
            ).toLocaleString();

        document.getElementById(
            "analyticsTransfers"
        ).textContent =
            Number(
                summary.transfers
            ).toLocaleString();

        document.getElementById(
            "analyticsAccounts"
        ).textContent =
            Number(
                summary.accounts
            ).toLocaleString();

        document.getElementById(
            "averageOperations"
        ).textContent =
            Number(
                summary.averageOperations
            ).toFixed(2);

        document.getElementById(
            "analyticsOperations"
        ).textContent =
            Number(
                summary.operations
            ).toLocaleString();

        document.getElementById(
            "firstIndexed"
        ).textContent =
            formatIndexedDate(
                summary.firstTimestamp
            );

        document.getElementById(
            "latestIndexed"
        ).textContent =
            formatIndexedDate(
                summary.latestTimestamp
            );

        renderActivityChart(
            analytics.activity
        );

        const anchors =
            analytics.anchors || {
                summary: {},
                activity: [],
                recent: []
            };

        document.getElementById(
            "analyticsAnchors"
        ).textContent =
            Number(
                anchors.summary.total || 0
            ).toLocaleString();

        document.getElementById(
            "anchorRelationships"
        ).textContent =
            Number(
                anchors.summary.relationships || 0
            ).toLocaleString();

        for (const [elementId, field] of [
            ["verifiedAnchors", "verified"],
            ["unsignedAnchors", "unsigned"],
            ["invalidAnchors", "invalid"]
        ]) {
            document.getElementById(elementId).textContent =
                Number(anchors.summary[field] || 0).toLocaleString();
        }

        document.getElementById(
            "anchorAccounts"
        ).textContent =
            Number(
                anchors.summary.accounts || 0
            ).toLocaleString();

        document.getElementById(
            "latestAnchor"
        ).textContent =
            anchors.summary.latestTimestamp
                ? timeAgo(
                    anchors.summary.latestTimestamp
                )
                : "Not available";

        renderActivityChart(
            anchors.activity,
            {
                elementId:
                    "anchorActivityChart",
                valueKey: "anchors",
                unit: "Anchor"
            }
        );

        renderRecentAnchors(
            anchors.recent
        );

        renderRankedAccounts(
            "topSenders",
            analytics.topSenders,
            "transfers"
        );

        renderRankedAccounts(
            "topRecipients",
            analytics.topRecipients,
            "transfers"
        );

        await Promise.all([
            renderTokenActivity(
                analytics.tokenActivity
            ),
            renderRecentTransfers(
                analytics.recentTransfers
            )
        ]);
    } catch (error) {
        showAnalyticsError(error);
    }
}

initializeAnalyticsTabs();
initializeAnalyticsMarketChart();
initializeAnalyticsScrollIndicators();
loadAnalytics();
loadMarketAnalytics();

window.setInterval(
    loadMarketAnalytics,
    60 * 1000
);
