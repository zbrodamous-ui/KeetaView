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
const marketIndicator =
    document.getElementById("marketIndicator");
const marketState =
    document.getElementById("marketState");

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
    fields.blocks.textContent =
        formatNumber(status.blocks ?? summary.blocks);
    fields.transfers.textContent =
        formatNumber(status.transfers ?? summary.transfers);
    fields.accounts.textContent =
        formatNumber(status.accounts ?? summary.accounts);
    fields.operations.textContent =
        formatNumber(summary.operations);
    fields.firstIndexed.textContent =
        formatDate(summary.firstTimestamp);
    fields.latestIndexed.textContent =
        formatDate(summary.latestTimestamp);

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

        await checkMarketFeed();
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
