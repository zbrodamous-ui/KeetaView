(() => {
    "use strict";

    const sessionKey = "keetaview-analytics-key-session";
    const access = document.getElementById("trafficAccess");
    const content = document.getElementById("trafficContent");
    const form = document.getElementById("trafficAccessForm");
    const keyInput = document.getElementById("trafficKey");
    const accessError = document.getElementById("trafficAccessError");
    const loadError = document.getElementById("trafficLoadError");
    const updated = document.getElementById("trafficUpdated");
    const refreshButton = document.getElementById("trafficRefresh");
    const lockButton = document.getElementById("trafficLock");
    const numberFormatter = new Intl.NumberFormat();
    let refreshTimer;

    const setText = (id, value) => {
        document.getElementById(id).textContent = numberFormatter.format(value || 0);
    };

    const showError = (element, message) => {
        element.textContent = message;
        element.hidden = !message;
    };

    const renderRankedList = (element, rows, labelKey) => {
        element.replaceChildren();
        if (!rows.length) {
            const empty = document.createElement("li");
            empty.className = "traffic-empty";
            empty.textContent = "No traffic recorded yet.";
            element.append(empty);
            return;
        }
        rows.forEach((row, index) => {
            const item = document.createElement("li");
            const rank = document.createElement("span");
            const label = document.createElement("strong");
            const count = document.createElement("span");
            rank.textContent = `#${index + 1}`;
            label.textContent = row[labelKey];
            count.textContent = `${numberFormatter.format(row.pageviews)} views`;
            item.append(rank, label, count);
            element.append(item);
        });
    };

    const renderChart = (rows) => {
        const chart = document.getElementById("trafficChart");
        chart.replaceChildren();
        if (!rows.length) {
            chart.textContent = "No daily activity recorded yet.";
            return;
        }
        const maximum = Math.max(1, ...rows.map((row) => Math.max(row.visitors, row.pageviews)));
        rows.forEach((row) => {
            const column = document.createElement("div");
            const bars = document.createElement("div");
            const visitors = document.createElement("i");
            const pageviews = document.createElement("i");
            const label = document.createElement("span");
            column.className = "traffic-chart-column";
            bars.className = "traffic-chart-bars";
            visitors.className = "visitors";
            pageviews.className = "pageviews";
            visitors.style.height = `${Math.max(2, (row.visitors / maximum) * 100)}%`;
            pageviews.style.height = `${Math.max(2, (row.pageviews / maximum) * 100)}%`;
            column.title = `${row.day}: ${numberFormatter.format(row.visitors)} visitors, ${numberFormatter.format(row.pageviews)} pageviews`;
            label.textContent = new Date(`${row.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
            bars.append(visitors, pageviews);
            column.append(bars, label);
            chart.append(column);
        });
    };

    const render = (data) => {
        setText("activeNow", data.activeNow);
        setText("visitorsToday", data.visitorsToday);
        setText("pageviewsToday", data.pageviewsToday);
        setText("totalVisitors", data.totals?.visitors);
        setText("totalPageviews", data.totals?.pageviews);
        setText("returningVisitors", data.totals?.returningVisitors);
        renderChart(data.daily || []);
        renderRankedList(document.getElementById("topPages"), data.topPages || [], "path");
        renderRankedList(document.getElementById("trafficReferrers"), data.referrers || [], "referrer");
        updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    };

    const lock = () => {
        sessionStorage.removeItem(sessionKey);
        clearInterval(refreshTimer);
        content.hidden = true;
        access.hidden = false;
        keyInput.value = "";
        keyInput.focus();
    };

    const load = async () => {
        const key = sessionStorage.getItem(sessionKey);
        if (!key) {
            lock();
            return;
        }
        refreshButton.disabled = true;
        showError(loadError, "");
        try {
            const response = await fetch("/api/traffic/summary", {
                headers: { Authorization: `Bearer ${key}` },
                cache: "no-store"
            });
            if (response.status === 401) {
                lock();
                showError(accessError, "That analytics key was not accepted.");
                return;
            }
            if (!response.ok) {
                throw new Error(`Traffic API returned ${response.status}`);
            }
            render(await response.json());
        } catch (error) {
            console.error("Unable to load private traffic summary:", error);
            showError(loadError, "Traffic data could not be loaded. Your key is still saved for this session; try again shortly.");
            updated.textContent = "Refresh failed";
        } finally {
            refreshButton.disabled = false;
        }
    };

    const unlock = async (key) => {
        sessionStorage.setItem(sessionKey, key);
        showError(accessError, "");
        access.hidden = true;
        content.hidden = false;
        await load();
        clearInterval(refreshTimer);
        refreshTimer = setInterval(() => {
            if (!document.hidden) load();
        }, 60000);
    };

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const key = keyInput.value.trim();
        if (key) unlock(key);
    });
    refreshButton.addEventListener("click", load);
    lockButton.addEventListener("click", lock);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && !content.hidden) load();
    });

    const savedKey = sessionStorage.getItem(sessionKey);
    if (savedKey) unlock(savedKey);
})();
