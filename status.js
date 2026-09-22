const apiEndpoint =
    document.getElementById("apiEndpoint");

if (apiEndpoint) {
    const isLocalPreview =
        ["localhost", "127.0.0.1"].includes(location.hostname) &&
        location.port !== "3000";

    apiEndpoint.textContent = isLocalPreview
        ? "http://127.0.0.1:3000"
        : location.origin;
}

const systemStatus = document.getElementById("systemStatus");
const refreshStatusButton = document.getElementById("refreshStatus");
const statusMessage = document.getElementById("statusMessage");

const fields = {
    blocks: document.getElementById("statusBlocks"),
    transfers: document.getElementById("statusTransfers"),
    accounts: document.getElementById("statusAccounts"),
    operations: document.getElementById("statusOperations"),
    assets: document.getElementById("statusAssets"),
    anchors: document.getElementById("statusAnchors"),
    networkHead: document.getElementById("statusNetworkHead"),
    indexFreshness: document.getElementById("statusIndexFreshness"),
    databaseStorage: document.getElementById("statusDatabaseStorage"),
    firstIndexed: document.getElementById("statusFirstIndexed"),
    latestIndexed: document.getElementById("statusLatestIndexed"),
    averageOperations:
        document.getElementById("statusAverageOperations"),
    lastChecked: document.getElementById("statusLastChecked")
};

const apiIndicator = document.getElementById("apiIndicator");
const databaseIndicator =
    document.getElementById("databaseIndicator");
const apiState = document.getElementById("apiState");
const databaseState = document.getElementById("databaseState");
const networkIndicator =
    document.getElementById("networkIndicator");
const networkState =
    document.getElementById("networkState");
const networkEndpoint =
    document.getElementById("networkEndpoint");
const marketIndicator =
    document.getElementById("marketIndicator");
const marketState =
    document.getElementById("marketState");
const coveragePercent =
    document.getElementById("statusCoveragePercent");
const coverageDetail =
    document.getElementById("statusCoverageDetail");
const coverageProgress =
    document.getElementById("statusCoverageProgress");

let indexedBlockTotal = null;
let liveNetworkHead = null;

function formatNumber(value) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number.toLocaleString()
        : "—";
}

function formatDate(value) {
    if (!value) {
        return "Not available";
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime())
        ? "Not available"
        : formatKeetaDate(date);
}

function formatStorage(bytes) {
    const value = Number(bytes);

    if (!Number.isFinite(value) || value < 0) {
        return "Not available";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    return `${size.toFixed(unitIndex < 2 ? 0 : 2)} ${units[unitIndex]}`;
}

function setServiceState(indicator, label, online, text) {
    indicator.classList.remove("pending");
    indicator.classList.toggle("online", online);
    indicator.classList.toggle("offline", !online);
    label.textContent = text;
}

function setCheckingState() {
    systemStatus.dataset.state = "checking";
    systemStatus.querySelector("strong").textContent = "Checking API…";
    refreshStatusButton.disabled = true;
    refreshStatusButton.textContent = "Checking…";
}

function renderHistoricalCoverage() {
    const indexedBlocks = Number(indexedBlockTotal);
    const networkHead = Number(liveNetworkHead);

    if (
        !Number.isFinite(indexedBlocks) ||
        !Number.isFinite(networkHead) ||
        networkHead <= 0
    ) {
        coveragePercent.textContent = "—";
        coverageDetail.textContent =
            "Waiting for indexed and network totals";
        coverageProgress.setAttribute("aria-valuenow", "0");
        coverageProgress.querySelector("span").style.width = "0%";
        return;
    }

    const percentage = Math.min(
        100,
        Math.max(0, (indexedBlocks / networkHead) * 100)
    );
    const displayedPercentage =
        percentage >= 10
            ? percentage.toFixed(1)
            : percentage.toFixed(2);

    coveragePercent.textContent = `${displayedPercentage}%`;
    coverageDetail.textContent =
        `${formatNumber(indexedBlocks)} of approximately ${formatNumber(networkHead)} blocks stored`;
    coverageProgress.setAttribute(
        "aria-valuenow",
        percentage.toFixed(2)
    );
    coverageProgress.querySelector("span").style.width =
        `${percentage}%`;
}

async function checkMarketFeed() {
    marketIndicator.classList.remove(
        "online",
        "offline"
    );
    marketIndicator.classList.add("pending");
    marketState.textContent = "Checking";

    try {
        const response =
            await fetchKeetaView(
                "http://localhost:3000/api/market?range=1d",
                {
                    cache: "no-store"
                }
            );

        if (!response.ok) {
            throw new Error(
                "Market feed did not respond."
            );
        }

        const market =
            await response.json();

        const connected =
            Number.isFinite(
                Number(market.price)
            );

        setServiceState(
            marketIndicator,
            marketState,
            connected,
            connected
                ? "Connected"
                : "Unavailable"
        );
    } catch (error) {
        setServiceState(
            marketIndicator,
            marketState,
            false,
            "Unavailable"
        );

        console.warn(
            "Market feed check failed:",
            error
        );
    }
}

async function checkKeetaNetwork() {
    networkIndicator.classList.remove(
        "online",
        "offline"
    );
    networkIndicator.classList.add("pending");
    networkState.textContent = "Checking";

    try {
        const client =
            KeetaNet.Client.fromNetwork("main");
        const statuses =
            await withKeetaViewTimeout(
                client.getNetworkStatus()
            );
        const blockCounts = statuses
            .map((node) => node?.ledger?.blockCount)
            .filter(Number.isFinite);

        if (blockCounts.length === 0) {
            throw new Error("No live block heights were returned.");
        }

        const networkHead =
            Math.max(...blockCounts);

        liveNetworkHead = networkHead;

        fields.networkHead.textContent =
            formatNumber(networkHead);
        renderHistoricalCoverage();
        networkEndpoint.textContent =
            `${blockCounts.length.toLocaleString()} responding ${blockCounts.length === 1 ? "node" : "nodes"}`;

        setServiceState(
            networkIndicator,
            networkState,
            true,
            "Connected"
        );
    } catch (error) {
        liveNetworkHead = null;
        fields.networkHead.textContent =
            "Not available";
        renderHistoricalCoverage();
        networkEndpoint.textContent =
            "Live mainnet nodes";

        setServiceState(
            networkIndicator,
            networkState,
            false,
            "Unavailable"
        );

        console.warn(
            "Keeta network check failed:",
            error
        );
    }
}

function setOnlineState() {
    systemStatus.dataset.state = "online";
    systemStatus.querySelector("strong").textContent = "KeetaView API online";
    setServiceState(apiIndicator, apiState, true, "Online");
    setServiceState(databaseIndicator, databaseState, true, "Available");
    statusMessage.classList.remove("error");
}

function setOfflineState(error) {
    systemStatus.dataset.state = "offline";
    systemStatus.querySelector("strong").textContent = "KeetaView API offline";
    setServiceState(apiIndicator, apiState, false, "Offline");
    setServiceState(
        databaseIndicator,
        databaseState,
        false,
        "Unavailable"
    );
    setServiceState(
        marketIndicator,
        marketState,
        false,
        "Unavailable"
    );
    setServiceState(
        networkIndicator,
        networkState,
        false,
        "Unavailable"
    );

    statusMessage.classList.add("error");
    statusMessage.innerHTML = `
        <strong>KeetaView could not reach the local API</strong>
        <p>
            Start it with <code>npm start</code>, then press Refresh. The rest of the site can still open, but indexed
            lists will not update until the API is available.
        </p>
    `;

    console.error("Status check failed:", error);
}

function renderStatus(status, analytics) {
    const summary = analytics.summary || {};
    indexedBlockTotal = status.blocks ?? summary.blocks;
    fields.blocks.textContent =
        formatNumber(indexedBlockTotal);
    renderHistoricalCoverage();
    fields.transfers.textContent =
        formatNumber(status.transfers ?? summary.transfers);
    fields.accounts.textContent =
        formatNumber(status.accounts ?? summary.accounts);
    fields.operations.textContent =
        formatNumber(summary.operations);
    fields.assets.textContent =
        formatNumber(status.assets);
    fields.anchors.textContent =
        formatNumber(status.anchors);
    fields.databaseStorage.textContent =
        formatStorage(status.databaseBytes);
    fields.firstIndexed.textContent =
        formatDate(summary.firstTimestamp);
    fields.latestIndexed.textContent =
        formatDate(summary.latestTimestamp);
    fields.indexFreshness.textContent =
        summary.latestTimestamp
            ? timeAgo(summary.latestTimestamp)
            : "Not available";

    const average = Number(summary.averageOperations);
    fields.averageOperations.textContent =
        Number.isFinite(average) ? average.toFixed(2) : "—";

    fields.lastChecked.textContent = formatKeetaDate(new Date());
}

async function loadStatus() {
    setCheckingState();

    try {
        const statusResponse = await fetchKeetaView(
            "http://localhost:3000/api/status",
            { cache: "no-store" }
        );

        if (!statusResponse.ok) {
            throw new Error("The KeetaView status endpoint did not respond");
        }

        const status = await statusResponse.json();

        // Confirm the API immediately using the lightweight status response.
        renderStatus(status, { summary: status });
        setOnlineState();

        await Promise.all([
            checkKeetaNetwork(),
            checkMarketFeed()
        ]);
    } catch (error) {
        setOfflineState(error);
        fields.lastChecked.textContent = formatKeetaDate(new Date());
    } finally {
        refreshStatusButton.disabled = false;
        refreshStatusButton.textContent = "Refresh";
    }
}

refreshStatusButton.addEventListener("click", loadStatus);

loadStatus();
setInterval(loadStatus, 60000);
