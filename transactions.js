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
const transactionResultCount =
    document.getElementById("transactionResultCount");

const rowsPerPage = 20;
const tokenInfoCache = new Map();

let currentPage = 1;
let totalOperations = 0;
let loadedOperations = [];

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

function formatTokenAmount(amount, decimals) {
    const rawAmount = BigInt(amount);
    const safeDecimals = Math.max(0, Number(decimals || 0));
    const divisor = 10n ** BigInt(safeDecimals);
    const wholePart = rawAmount / divisor;
    const fractionalPart = rawAmount % divisor;
    const fractionalText = fractionalPart
        .toString()
        .padStart(safeDecimals, "0")
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
            formatTokenAmount(rawAmount, decimalPlaces),
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

        anchorBadge.className =
            "transaction-anchor-badge";
        anchorBadge.textContent = "Anchor";
        anchorBadge.title =
            "This operation contains a valid Anchor payload";

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

function visibleOperations() {
    const query =
        transactionFilter.value
            .trim()
            .toLowerCase();

    if (!query) {
        return loadedOperations;
    }

    return loadedOperations.filter((operation) =>
        [
            operation.operation_type,
            operation.block_hash,
            operation.sender,
            operation.recipient,
            operation.token,
            operation.tokenName,
            operation.is_anchor
                ? "anchor"
                : ""
        ].some((value) =>
            String(value || "")
                .toLowerCase()
                .includes(query)
        )
    );
}

function renderCurrentPage() {
    const operations = visibleOperations();
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
                ? "No operations on this page match that filter."
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
        transactionFilter.value.trim()
            ? `${operations.length} matching on this page`
            : `${firstResult.toLocaleString()}–${lastResult.toLocaleString()} of ${totalOperations.toLocaleString()}`;

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
    transactionsPageList.innerHTML =
        '<p class="transactions-empty">Loading operations…</p>';

    transactionResultCount.textContent =
        "Loading operations…";

    previousPageButton.disabled = true;
    nextPageButton.disabled = true;

    try {
        const offset =
            (currentPage - 1) * rowsPerPage;

        const [
            operationsResponse,
            statusResponse
        ] = await Promise.all([
            fetchKeetaView(
                `/api/operations?limit=${rowsPerPage}&offset=${offset}`
            ),
            fetchKeetaView(
                "/api/status"
            )
        ]);

        if (
            !operationsResponse.ok ||
            !statusResponse.ok
        ) {
            throw new Error(
                "Unable to load indexed operations"
            );
        }

        const operations =
            await operationsResponse.json();

        const status =
            await statusResponse.json();

        totalOperations =
            Number(status.operations || 0);

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
    }
}

transactionFilter.addEventListener(
    "input",
    renderCurrentPage
);

previousPageButton.addEventListener(
    "click",
    () => {
        if (currentPage > 1) {
            currentPage -= 1;
            transactionFilter.value = "";
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
            transactionFilter.value = "";
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
