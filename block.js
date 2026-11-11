const client = KeetaNet.Client.fromNetwork("main");
const params = new URLSearchParams(window.location.search);
const blockHash = params.get("hash");

function publicKeyText(value) {
    if (!value) return "";
    const publicKey = value.publicKeyString?.toString?.();
    return publicKey || value.toString?.() || String(value);
}

function shortIdentifier(value) {
    if (!value || value.length <= 32) return value || "Not available";
    return value.slice(0, 14) + "..." + value.slice(-6);
}

function operationTitle(operation) {
    const source =
        operation?.constructor?.name ||
        operation?.type?.toString?.() ||
        "Operation";
    const name = source
        .replace(/^.*BlockOperation/, "")
        .replace(/_/g, " ")
        .trim();

    return name
        ? name.toLowerCase().replace(/\b\w/g, character => character.toUpperCase())
        : "Operation";
}

function formatOperationValue(key, value) {
    if (value === undefined || value === null || value === "") return "";
    if (key === "metadata") {
        const length = String(value).length;
        return length ? "Present (" + length.toLocaleString() + " encoded characters)" : "Not set";
    }

    let text;
    if (typeof value === "bigint") {
        text = value.toString();
    } else if (Array.isArray(value) || typeof value === "object") {
        try {
            text = JSON.stringify(value, (_key, item) =>
                typeof item === "bigint" ? item.toString() : item
            );
        } catch {
            text = String(value);
        }
    } else {
        text = String(value);
    }

    if (key === "amount") return text + " (raw units)";
    if (text.length > 180) return text.slice(0, 177) + "…";
    return text;
}

const operationLabels = {
    amount: "Amount",
    to: "Recipient",
    from: "Sender",
    token: "Token",
    account: "Account",
    name: "Name",
    description: "Description",
    metadata: "Metadata",
    defaultPermission: "Default permission",
    method: "Method",
    permissions: "Permissions",
    principal: "Principal",
    target: "Target",
    identifier: "Identifier",
    external: "External data",
    exact: "Exact",
    forward: "Forward"
};

function appendOperationField(card, key, value) {
    const label = operationLabels[key] || key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, character => character.toUpperCase());
    const row = document.createElement("p");
    const heading = document.createElement("strong");
    heading.textContent = label + ": ";
    row.appendChild(heading);

    const text = formatOperationValue(key, value);
    const addressValue = publicKeyText(value);
    const canLinkAddress =
        ["to", "from", "account", "principal", "target", "identifier"].includes(key) &&
        addressValue.startsWith("keeta_");

    if (canLinkAddress) {
        const link = document.createElement("a");
        link.className = "address-link";
        link.href = "address.html?address=" + encodeURIComponent(addressValue);
        link.textContent = shortIdentifier(addressValue);
        link.title = addressValue;
        row.appendChild(link);
        attachKeetaCopyButton(link, addressValue, "address");
    } else if (key === "token" && addressValue.startsWith("keeta_")) {
        const token = document.createElement("span");
        token.textContent = shortIdentifier(addressValue);
        token.title = addressValue;
        row.appendChild(token);
        attachKeetaCopyButton(token, addressValue, "token address");
    } else {
        const valueNode = document.createElement("span");
        valueNode.textContent = text || "Not set";
        row.appendChild(valueNode);
    }

    card.appendChild(row);
}

function previousBlockInfo(block) {
    const previous = block.previous ?? block.previousHash;
    const value = publicKeyText(previous);

    if (!value) return { kind: "unavailable" };

    const sdkSentinel = KeetaNet.lib?.Block?.NO_PREVIOUS;
    const sentinelText = sdkSentinel ? String(sdkSentinel) : "";
    if (
        value === sentinelText ||
        value === "NO_PREVIOUS" ||
        value.endsWith(":NO_PREVIOUS")
    ) {
        return { kind: "first" };
    }

    return { kind: "hash", value };
}

function appendOverviewValue(labelText, text, options = {}) {
    const label = document.createElement("div");
    label.className = "detail-label";
    label.textContent = labelText;

    const value = document.createElement("div");
    value.className = "detail-value";

    if (options.href) {
        const link = document.createElement("a");
        link.href = options.href;
        link.textContent = options.display || text;
        if (options.title) link.title = options.title;
        value.appendChild(link);
        if (options.copyLabel) {
            attachKeetaCopyButton(link, text, options.copyLabel);
        }
    } else {
        value.textContent = text;
        if (options.copyLabel) {
            attachKeetaCopyButton(value, text, options.copyLabel);
        }
    }

    blockDetails.append(label, value);
}

async function loadBlock() {
    const blockTitle = document.getElementById("blockTitle");
    const blockDetails = document.getElementById("blockDetails");
    const operationsList = document.getElementById("operationsList");

    if (!blockHash) {
        blockTitle.textContent = "No block selected";
        blockDetails.textContent = "Search for a block or open one from the Blocks page.";
        operationsList.textContent = "No operations to display.";
        return;
    }

    try {
        const block = await withKeetaViewTimeout(client.getBlock(blockHash));

        if (!block) {
            throw new Error("That block was not found on the main network.");
        }

        blockTitle.textContent = "Block";
        blockDetails.replaceChildren();
        operationsList.replaceChildren();

        const hash = publicKeyText(block.hash);
        const account = publicKeyText(block.account);
        const previous = previousBlockInfo(block);

        appendOverviewValue("Hash", hash, { copyLabel: "block hash" });
        appendOverviewValue("Time", block.date?.toLocaleString?.() || "Not available");
        appendOverviewValue("Account", account || "Not available", account
            ? {
                href: "address.html?address=" + encodeURIComponent(account),
                display: shortIdentifier(account),
                title: account,
                copyLabel: "account address"
            }
            : {});
        appendOverviewValue("Network", block.network?.toString?.() || "Not available");
        appendOverviewValue("Operations", String(block.operations?.length ?? 0));
        appendOverviewValue("Version", String(block.version ?? "Not available"));

        if (previous.kind === "hash") {
            appendOverviewValue("Previous Block", previous.value, {
                href: "block.html?hash=" + encodeURIComponent(previous.value),
                display: shortIdentifier(previous.value),
                title: previous.value,
                copyLabel: "previous block hash"
            });
        } else if (previous.kind === "first") {
            appendOverviewValue("Previous Block", "First block in this account’s chain");
        } else {
            appendOverviewValue("Previous Block", "Not available");
        }

        if (!block.operations?.length) {
            operationsList.textContent = "No operations are listed for this block.";
            return;
        }

        block.operations.forEach((operation, operationIndex) => {
            const card = document.createElement("article");
            card.className = "operation-card";

            const title = document.createElement("h3");
            title.textContent = operationTitle(operation);
            card.appendChild(title);

            const operationFields = operation.toJSON?.() || {};
            const visibleFields = Object.entries(operationFields)
                .filter(([key, value]) =>
                    key !== "type" &&
                    value !== undefined &&
                    value !== null &&
                    value !== ""
                );

            if (visibleFields.length) {
                visibleFields.forEach(([key, value]) =>
                    appendOperationField(card, key, value)
                );
            } else {
                const note = document.createElement("p");
                note.textContent =
                    "This operation has no additional display fields.";
                card.appendChild(note);
            }

            const operationLink = document.createElement("a");
            operationLink.className = "detail-back-link";
            operationLink.href =
                "transaction.html?block=" +
                encodeURIComponent(hash) +
                "&operation=" + operationIndex;
            operationLink.textContent = "View operation " + (operationIndex + 1) + " →";
            card.appendChild(operationLink);

            operationsList.appendChild(card);
        });
    } catch (error) {
        console.error("Error loading block:", error);
        blockTitle.textContent = "Block unavailable";
        blockDetails.textContent =
            "KeetaView could not load this block. Try refreshing or search for the hash again.";
        operationsList.textContent = "";
    }
}

loadBlock();
