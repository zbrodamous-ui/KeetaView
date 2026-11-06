const client = KeetaNet.Client.fromNetwork("main");

const params = new URLSearchParams(window.location.search);

const address = params.get("address");

console.log("Selected address:", address);


const addressTokenInfoCache =
    new Map();

async function getAddressTokenDisplay(
    tokenAddress,
    rawAmount
) {
    let tokenInfo =
        addressTokenInfoCache.get(
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

        addressTokenInfoCache.set(
            tokenAddress,
            tokenInfo
        );
    }

    let decimalPlaces = 0;

    if (tokenInfo?.info?.metadata) {
        const metadata =
            JSON.parse(
                atob(
                    tokenInfo.info.metadata
                )
            );

        decimalPlaces =
            Number(
                metadata.decimalPlaces ||
                0
            );
    }

    return {
        amount:
            formatTokenAmount(
                rawAmount,
                decimalPlaces
            ),
        name:
            tokenInfo?.info?.name ||
            `${tokenAddress.slice(0, 8)}...`
    };
}

async function loadAddress() {
    try {
        const accountInfo =
            await client.getAccountInfo(address);

        const addressTitle =
            document.getElementById("addressTitle");

        const addressDetails =
            document.getElementById("addressDetails");

        const balancesTitle =
            document.getElementById("balancesTitle");

        const balancesList =
            document.getElementById("balancesList");

        const addressAnchors =
            document.getElementById("addressAnchors");

        const addressAnchorList =
            document.getElementById("addressAnchorList");

        addressTitle.textContent = "Address";

        addressDetails.innerHTML = `
            <div class="detail-label">Address</div>
            <div class="detail-value">${escapeKeetaHtml(address)}</div>

            <div class="detail-label">Registered username</div>
            <div class="detail-value" id="addressCachedUsername">Checking cached username…</div>

            <div class="detail-label">Name</div>
            <div class="detail-value">
                ${escapeKeetaHtml(accountInfo.info.name || "Not set")}
            </div>

            <div class="detail-label">Description</div>
            <div class="detail-value">
                ${escapeKeetaHtml(accountInfo.info.description || "Not set")}
            </div>

            <div class="detail-label">Head Block Height</div>
            <div class="detail-value">
                ${escapeKeetaHtml(accountInfo.currentHeadBlockHeight ?? "Not available")}
            </div>
        `;

        attachKeetaCopyButton(
            addressDetails.querySelector(".detail-value"),
            address,
            "address"
        );

        loadCachedAddressUsername(address);

        balancesTitle.textContent = "Balances";
        balancesList.innerHTML = "";

        for (const balanceEntry of accountInfo.balances) {

            let tokenName =
    balanceEntry.token.publicKeyString.toString();

let formattedBalance =
    balanceEntry.balance.toString();

    try {
    const tokenInfo =
        await client.getAccountInfo(balanceEntry.token);

    if (tokenInfo?.info?.name) {
        tokenName =
            tokenInfo.info.name;
    }

    if (tokenInfo?.info?.metadata) {
        const metadata =
            JSON.parse(
                atob(tokenInfo.info.metadata)
            );

        if (metadata.decimalPlaces !== undefined) {
            formattedBalance =
                formatTokenAmount(
                    balanceEntry.balance,
                    metadata.decimalPlaces
                );
        }
    }

} catch (error) {
    console.log("Unable to load token info.");
}

            const card = document.createElement("div");

            card.className = "operation-card";

            card.innerHTML = `
                <h3>Token Balance</h3>

                <p>
                    <strong>Token:</strong>
                   ${escapeKeetaHtml(tokenName)}
                </p>

                <p>
                    <strong>Balance:</strong>
                    ${escapeKeetaHtml(formattedBalance)}
                </p>
            `;

            balancesList.appendChild(card);
        }

        const anchorResponse = await fetchKeetaView(
            `http://localhost:3000/api/anchors?limit=20&address=${encodeURIComponent(
                address
            )}`
        );

        if (anchorResponse.ok) {
            const anchors = await anchorResponse.json();

            if (anchors.length > 0) {
                addressAnchorList.replaceChildren();

                for (const anchor of anchors) {
                    const row = document.createElement("a");
                    const status = anchor.signature_status || "unknown";
                    const statusLabel = {
                        verified: "Verified",
                        unsigned: "Unsigned",
                        invalid: "Invalid"
                    }[status] || "Unknown";

                    row.className = "address-anchor-row";
                    row.href =
                        `transaction.html?block=${encodeURIComponent(
                            anchor.block_hash
                        )}&operation=${anchor.operation_index}`;
                    row.innerHTML = `
                        <span class="address-anchor-identity">
                            <strong>${escapeKeetaHtml(
                                anchor.anchor_transaction_id ||
                                `${anchor.block_hash.slice(0, 12)}...:${anchor.operation_index}`
                            )}</strong>
                            <small>${timeAgo(new Date(anchor.timestamp))}</small>
                        </span>
                        <span class="anchor-verification anchor-verification-${escapeKeetaHtml(status)}">
                            ${escapeKeetaHtml(statusLabel)}
                        </span>
                        <span class="address-anchor-relationships">
                            ${Number(anchor.relationships).toLocaleString()}
                            relationship${Number(anchor.relationships) === 1 ? "" : "s"}
                        </span>
                    `;

                    addressAnchorList.appendChild(row);
                }

                addressAnchors.hidden = false;
            }
        }

const addressActivityList =
    document.getElementById("addressActivityList");

addressActivityList.innerHTML = "";

const response =
    await fetchKeetaView(
        "/api/operations?limit=100&offset=0&address=" +
        encodeURIComponent(address)
    );

if (!response.ok) {
    throw new Error(
        "Address activity request failed: " + response.status
    );
}

const activityResult = await response.json();
const operations = Array.isArray(activityResult.operations)
    ? activityResult.operations
    : [];

if (operations.length === 0) {
    addressActivityList.textContent =
        "No indexed activity found for this address.";
} else {
    for (const operation of operations) {
        const sender = operation.sender || "Not available";
        const recipient = operation.recipient || "Not available";
        const shortSender = sender === "Not available"
            ? sender
            : sender.slice(0, 12) + "..." + sender.slice(-6);
        const shortRecipient = recipient === "Not available"
            ? recipient
            : recipient.slice(0, 12) + "..." + recipient.slice(-6);

        let amountLabel = "—";
        if (operation.token && operation.amount !== undefined && operation.amount !== null) {
            try {
                const tokenDisplay = await getAddressTokenDisplay(
                    operation.token,
                    operation.amount
                );
                amountLabel = tokenDisplay.amount + " " + tokenDisplay.name;
            } catch (error) {
                console.warn(
                    "Unable to format address activity token:",
                    operation.token,
                    error
                );

                let fallbackAmount = String(operation.amount);
                try {
                    fallbackAmount = BigInt(fallbackAmount).toLocaleString();
                } catch {
                    // Keep the raw amount when it is not an integer string.
                }

                const tokenAddress = String(operation.token);
                const tokenName = tokenAddress.length > 16
                    ? tokenAddress.slice(0, 8) + "..."
                    : tokenAddress;
                amountLabel = fallbackAmount + " " + tokenName;
            }
        }

        const blockHash = String(operation.block_hash || "");
        const operationIndex = Number(operation.operation_index || 0);
        const activityRow = document.createElement("div");
        activityRow.className = "activity-row transaction-row";
        activityRow.innerHTML =
            '<span><a href="block.html?hash=' +
                encodeURIComponent(blockHash) + '">' +
                escapeKeetaHtml(blockHash.slice(0, 8)) + '...</a></span>' +
            '<span>' +
                escapeKeetaHtml(timeAgo(new Date(operation.timestamp))) +
            '</span>' +
            '<span>' +
                escapeKeetaHtml(operation.operation_type || "Operation") +
            '</span>' +
            '<span title="' + escapeKeetaHtml(sender) + '">' +
                escapeKeetaHtml(addressActivityLabel(
                    operation.sender_username,
                    operation.sender_name,
                    shortSender
                )) +
            '</span>' +
            '<span title="' + escapeKeetaHtml(recipient) + '">' +
                escapeKeetaHtml(addressActivityLabel(
                    operation.recipient_username,
                    operation.recipient_name,
                    shortRecipient
                )) +
            '</span>' +
            '<span>' + escapeKeetaHtml(amountLabel) + '</span>';

        activityRow.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        });

        activityRow.addEventListener("click", () => {
            window.location.href =
                "transaction.html?block=" +
                encodeURIComponent(blockHash) +
                "&operation=" + operationIndex;
        });

        addressActivityList.appendChild(activityRow);
    }
}

    } catch (error) {
        console.error("Address loading error:", error);
    }
}

if (address) {
    loadAddress();
} else {
    const addressDetails =
        document.getElementById("addressDetails");

    const balancesTitle =
        document.getElementById("balancesTitle");

    const balancesList =
        document.getElementById("balancesList");

    addressDetails.textContent =
        "No address was provided. Search for an address from the homepage.";

    balancesTitle.textContent = "";
    balancesList.textContent = "";
}

async function loadCachedAddressUsername(walletAddress) {
    const element = document.getElementById("addressCachedUsername");
    if (!element) return;
    try {
        const response = await fetch(`/api/account-label?address=${encodeURIComponent(walletAddress)}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error("Cached label unavailable");
        const label = await response.json();
        element.textContent = label.username || "Not cached";
        element.title = label.username ? "Registered username from the local cache" : "No registered username is available in the local cache";
    } catch {
        element.textContent = "Cache unavailable";
    }
}

function addressActivityLabel(username, name, shortAddress) {
    const label = username || name;
    return label ? `${label} (${shortAddress})` : shortAddress;
}
