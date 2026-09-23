const client = KeetaNet.Client.fromNetwork("main");

const transactionsPageList =
    document.getElementById("transactionsPageList");
const previousPageButton =
    document.getElementById("previousPage");
const nextPageButton =
    document.getElementById("nextPage");
const pageNumber =
    document.getElementById("pageNumber");
const transactionFilter =
    document.getElementById("transactionFilter");
const transactionFilterClear =
    document.getElementById("transactionFilterClear");
const transactionScope =
    document.getElementById("transactionScope");
const anchorStatusFilter =
    document.getElementById("anchorStatusFilter");
const anchorStatus =
    document.getElementById("anchorStatus");
const transactionResultCount =
    document.getElementById("transactionResultCount");
const transactionsListTitle =
    document.getElementById("transactionsListTitle");

const rowsPerPage = 20;
const tokenInfoCache = new Map();

let currentPage = 1;
let totalOperations = 0;
let loadedOperations = [];
let filterTimer = null;

const initialParameters = new URLSearchParams(
    window.location.search
);

if (["transfers", "anchors"].includes(
    initialParameters.get("view")
)) {
    transactionScope.value = initialParameters.get("view");
}

transactionFilter.value = initialParameters.get("q") || "";

if (["verified", "unsigned", "invalid"].includes(
    initialParameters.get("anchorStatus")
)) {
    anchorStatus.value = initialParameters.get("anchorStatus");
}

anchorStatusFilter.hidden =
    transactionScope.value !== "anchors";

function updateSearchClearButton() {
    transactionFilterClear.hidden =
        !transactionFilter.value;
}

function updatePageUrl() {
    const pageUrl = new URL(window.location.href);
    const searchQuery = transactionFilter.value.trim();

    if (transactionScope.value === "all") {
        pageUrl.searchParams.delete("view");
    } else {
        pageUrl.searchParams.set(
            "view",
            transactionScope.value
        );
    }

    if (
        transactionScope.value === "anchors" &&
        anchorStatus.value !== "all"
    ) {
        pageUrl.searchParams.set(
            "anchorStatus",
            anchorStatus.value
        );
    } else {
        pageUrl.searchParams.delete("anchorStatus");
    }

    if (searchQuery) {
        pageUrl.searchParams.set("q", searchQuery);
    } else {
        pageUrl.searchParams.delete("q");
    }

    window.history.replaceState({}, "", pageUrl);
}

function submitSearch() {
    window.clearTimeout(filterTimer);
    currentPage = 1;
    updateSearchClearButton();
    updatePageUrl();
    loadOperationsPage();
}

updateSearchClearButton();

function shortValue(value, start = 12, end = 6) {
    if (!value || value === "Not available") {
        return value || "Not available";
    }

    return formatKeetaIdentifier(value, start, end);
}

function operationUrl(operation) {
    return (
        `transaction.html?block=${encodeURIComponent(operation.block_hash)}` +
        `&operation=${operation.operation_index}`
    );
}

function formatOperationType(value) {
    return String(value || "Operation")
        .toLowerCase()
        .replace(
            /\b\w/g,
            (character) => character.toUpperCase()
        );
}

function formatTokenAmount(
    amount,
    decimals,
    maximumFractionDigits = 6
) {
    const rawAmount = BigInt(amount);
    const safeDecimals = Math.max(0, Number(decimals || 0));
    const divisor = 10n ** BigInt(safeDecimals);
    const wholePart = rawAmount / divisor;
    const fractionalPart = rawAmount % divisor;
    const fractionalText = fractionalPart
        .toString()
        .padStart(safeDecimals, "0")
        .slice(
            0,
            Math.min(
                safeDecimals,
                maximumFractionDigits
            )
        )
        .replace(/0+$/, "");

    return fractionalText
        ? `${wholePart.toLocaleString()}.${fractionalText}`
        : wholePart.toLocaleString();
}

async function getTokenDisplay(tokenAddress, rawAmount) {
    if (!tokenAddress || rawAmount === null) {
        return null;
    }

    let tokenInfo = tokenInfoCache.get(tokenAddress);

    if (!tokenInfo) {
        const tokenAccount =
            KeetaNet.lib.Account.fromPublicKeyString(tokenAddress);

        tokenInfo = client.getAccountInfo(tokenAccount);
        tokenInfoCache.set(tokenAddress, tokenInfo);
    }

    tokenInfo = await tokenInfo;
    tokenInfoCache.set(tokenAddress, tokenInfo);

    let decimalPlaces = 0;

    try {
        if (tokenInfo?.info?.metadata) {
            const metadata =
                JSON.parse(atob(tokenInfo.info.metadata));

            decimalPlaces =
                Number(metadata.decimalPlaces || 0);
        }
    } catch {
        console.warn(
            "Unreadable token metadata:",
            tokenAddress
        );
    }

    return {
        amount:
            formatTokenAmount(
                rawAmount,
                decimalPlaces
            ),
        exactAmount:
            formatTokenAmount(
                rawAmount,
                decimalPlaces,
                decimalPlaces
            ),
        name:
            tokenInfo?.info?.name ||
            shortValue(tokenAddress, 8, 6)
    };
}

function createAddressLink(address) {
    if (!address) {
        const unavailable =
            document.createElement("span");

        unavailable.textContent = "—";
        return unavailable;
    }

    const link = document.createElement("a");
    link.href =
        `address.html?address=${encodeURIComponent(address)}`;
    link.textContent = shortValue(address);
    link.title = address;
    link.addEventListener(
        "click",
        (event) => event.stopPropagation()
    );

    return link;
}

function createOperationRow(operation) {
    const row = document.createElement("div");
    row.className = "transaction-directory-row";
    row.tabIndex = 0;
    row.setAttribute("role", "link");
    row.setAttribute(
        "aria-label",
        `Open ${formatOperationType(operation.operation_type)} operation from block ${operation.block_hash}`
    );

    const blockLink = document.createElement("a");
    blockLink.className =
        "transaction-directory-block";
    blockLink.href =
        `block.html?hash=${encodeURIComponent(operation.block_hash)}`;
    blockLink.textContent =
        shortValue(operation.block_hash);
    blockLink.title = operation.block_hash;
    blockLink.addEventListener(
        "click",
        (event) => event.stopPropagation()
    );

    const age = document.createElement("span");
    age.className = "transaction-directory-age";
    age.textContent =
        timeAgo(new Date(operation.timestamp));

    const type = document.createElement("span");
    type.className = "transaction-directory-type";

    const typeLabel = document.createElement("span");
    typeLabel.textContent =
        formatOperationType(operation.operation_type);

    type.appendChild(typeLabel);

    if (operation.is_anchor) {
        const anchorBadge =
            document.createElement("span");

        const signatureStatus = String(
            operation.anchor_signature_status || "detected"
        ).toLowerCase();

        const statusLabel = {
            verified: "Verified Anchor",
            unsigned: "Unsigned Anchor",
            invalid: "Invalid Anchor",
            encrypted: "Encrypted Anchor"
        }[signatureStatus] || "Anchor";

        anchorBadge.className =
            `transaction-anchor-badge transaction-anchor-badge--${signatureStatus}`;
        anchorBadge.textContent = statusLabel;
        anchorBadge.title =
            signatureStatus === "verified"
                ? "This Anchor payload has a verified signature"
                : signatureStatus === "unsigned"
                    ? "This Anchor payload is valid but unsigned"
                    : `Anchor verification status: ${signatureStatus}`;

        type.appendChild(anchorBadge);
    }

    const sender = document.createElement("span");
    sender.className =
        "transaction-directory-address";
    sender.appendChild(
        createAddressLink(operation.sender)
    );

    const details = document.createElement("span");
    details.className =
        "transaction-directory-amount";

    if (operation.recipient) {
        details.appendChild(
            createAddressLink(operation.recipient)
        );
    }

    if (operation.displayAmount) {
        if (operation.recipient) {
            details.append(" · ");
        }

        details.append(
            `${operation.displayAmount} ${operation.tokenName}`
        );

        if (operation.exactAmount) {
            details.title =
                `Exact amount: ${operation.exactAmount} ${operation.tokenName}`;
        }
    }

    if (!operation.recipient && !operation.displayAmount) {
        details.textContent = "View details";
    }

    row.append(
        blockLink,
        age,
        type,
        sender,
        details
    );

    const openOperation = () => {
        window.location.assign(
            operationUrl(operation)
        );
    };

    row.addEventListener("click", openOperation);
    row.addEventListener("keydown", (event) => {
        if (
            event.key === "Enter" ||
            event.key === " "
        ) {
            event.preventDefault();
            openOperation();
        }
    });

    return row;
}

function renderCurrentPage() {
    const operations = loadedOperations;
    const totalPages =
        Math.max(
            1,
            Math.ceil(totalOperations / rowsPerPage)
        );

    transactionsPageList.innerHTML = "";

    if (operations.length === 0) {
        const empty = document.createElement("p");
        empty.className = "transactions-empty";
        empty.textContent =
            transactionFilter.value.trim()
                ? "No indexed operations match that exact search."
                : transactionScope.value === "anchors"
                    ? "No indexed Anchor operations are available yet."
                    : transactionScope.value === "transfers"
                        ? "No indexed transfers are available yet."
                    : "No indexed operations are available.";

        transactionsPageList.appendChild(empty);
    } else {
        operations.forEach((operation) => {
            transactionsPageList.appendChild(
                createOperationRow(operation)
            );
        });
    }

    const firstResult =
        totalOperations === 0
            ? 0
            : (
                (currentPage - 1) *
                rowsPerPage
            ) + 1;

    const lastResult =
        Math.min(
            currentPage * rowsPerPage,
            totalOperations
        );

    transactionResultCount.textContent =
        `${firstResult.toLocaleString()}–${lastResult.toLocaleString()} of ${totalOperations.toLocaleString()}`;

    transactionsListTitle.textContent =
        transactionScope.value === "anchors"
            ? "Recorded Anchors"
            : transactionScope.value === "transfers"
                ? "Recorded Transfers"
                : "Recorded Operations";

    pageNumber.textContent =
        `Page ${currentPage} of ${totalPages}`;

    previousPageButton.disabled =
        currentPage === 1;

    nextPageButton.disabled =
        currentPage >= totalPages;
}

async function prepareOperation(operation) {
    if (
        operation.amount === null ||
        !operation.token
    ) {
        return operation;
    }

    try {
        const tokenDisplay =
            await getTokenDisplay(
                operation.token,
                operation.amount
            );

        return {
            ...operation,
            displayAmount: tokenDisplay?.amount,
            exactAmount: tokenDisplay?.exactAmount,
            tokenName: tokenDisplay?.name
        };
    } catch (error) {
        console.warn(
            "Unable to format operation token:",
            operation.token,
            error
        );

        return {
            ...operation,
            displayAmount:
                BigInt(operation.amount)
                    .toLocaleString(),
            tokenName:
                shortValue(
                    operation.token,
                    8,
                    6
                )
        };
    }
}

async function loadOperationsPage() {
    transactionFilter.setAttribute("aria-busy", "true");
    transactionFilterClear.disabled = true;
    transactionsPageList.innerHTML =
        '<p class="transactions-empty">Loading operations…</p>';

    transactionResultCount.textContent =
        "Loading operations…";

    previousPageButton.disabled = true;
    nextPageButton.disabled = true;

    try {
        const offset =
            (currentPage - 1) * rowsPerPage;

        const anchorsOnly =
            transactionScope.value === "anchors";

        const operationParameters =
            new URLSearchParams({
                limit: rowsPerPage,
                offset
            });

        if (anchorsOnly) {
            operationParameters.set("anchors", "true");

            if (anchorStatus.value !== "all") {
                operationParameters.set(
                    "anchorStatus",
                    anchorStatus.value
                );
            }
        }

        if (transactionScope.value === "transfers") {
            operationParameters.set("transfers", "true");
        }

        const searchQuery =
            transactionFilter.value.trim();

        if (searchQuery) {
            operationParameters.set("q", searchQuery);
        }

        const operationsResponse =
            await fetchKeetaView(
                `/api/operations?${operationParameters}`
            );

        if (!operationsResponse.ok) {
            throw new Error(
                "Unable to load indexed operations"
            );
        }

        const operationPayload =
            await operationsResponse.json();

        const operations =
            Array.isArray(operationPayload)
                ? operationPayload
                : operationPayload.operations;

        totalOperations =
            Array.isArray(operationPayload)
                ? operationPayload.length
                : Number(operationPayload.total || 0);

        if (
            anchorsOnly &&
            !Array.isArray(operationPayload) &&
            operationPayload.anchorCounts
        ) {
            const counts = operationPayload.anchorCounts;
            anchorStatus.options[0].textContent =
                `All Anchors (${Number(counts.total || 0).toLocaleString()})`;
            anchorStatus.options[1].textContent =
                `Verified (${Number(counts.verified || 0).toLocaleString()})`;
            anchorStatus.options[2].textContent =
                `Unsigned (${Number(counts.unsigned || 0).toLocaleString()})`;
            anchorStatus.options[3].textContent =
                `Invalid (${Number(counts.invalid || 0).toLocaleString()})`;
        }

        loadedOperations =
            await Promise.all(
                operations.map(prepareOperation)
            );

        renderCurrentPage();
    } catch (error) {
        console.error(
            "Error loading operations page:",
            error
        );

        loadedOperations = [];
        transactionsPageList.innerHTML =
            '<p class="transactions-empty">Unable to load operations. Make sure the KeetaView API server is running.</p>';
        transactionResultCount.textContent =
            "Unavailable";
        pageNumber.textContent = "Page —";
    } finally {
        transactionFilter.removeAttribute("aria-busy");
        transactionFilterClear.disabled = false;
    }
}

transactionFilter.addEventListener(
    "input",
    () => {
        updateSearchClearButton();
        window.clearTimeout(filterTimer);
        filterTimer = window.setTimeout(
            submitSearch,
            350
        );
    }
);

transactionFilter.addEventListener(
    "keydown",
    (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            submitSearch();
        }
    }
);

transactionFilterClear.addEventListener(
    "click",
    () => {
        transactionFilter.value = "";
        submitSearch();
        transactionFilter.focus();
    }
);

transactionScope.addEventListener(
    "change",
    () => {
        currentPage = 1;

        anchorStatusFilter.hidden =
            transactionScope.value !== "anchors";

        if (transactionScope.value !== "anchors") {
            anchorStatus.value = "all";
        }

        updatePageUrl();
        loadOperationsPage();
    }
);

anchorStatus.addEventListener(
    "change",
    () => {
        currentPage = 1;
        updatePageUrl();
        loadOperationsPage();
    }
);

previousPageButton.addEventListener(
    "click",
    () => {
        if (currentPage > 1) {
            currentPage -= 1;
            loadOperationsPage();

            document
                .querySelector(
                    ".transactions-list-card"
                )
                ?.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
        }
    }
);

nextPageButton.addEventListener(
    "click",
    () => {
        const totalPages =
            Math.ceil(
                totalOperations / rowsPerPage
            );

        if (currentPage < totalPages) {
            currentPage += 1;
            loadOperationsPage();

            document
                .querySelector(
                    ".transactions-list-card"
                )
                ?.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
        }
    }
);

loadOperationsPage();
