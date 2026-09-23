const client = KeetaNet.Client.fromNetwork("main");
const params = new URLSearchParams(window.location.search);

const blockHash = params.get("hash");

async function loadBlock() {
    const blockTitle =
        document.getElementById("blockTitle");

    const blockDetails =
        document.getElementById("blockDetails");

    const operationsList =
        document.getElementById("operationsList");

    if (!blockHash) {
        blockTitle.textContent =
            "No block selected";

        blockDetails.textContent =
            "Search for a block or return to the Blocks page.";

        operationsList.textContent =
            "No operations to display.";

        return;
    }

    try {
const block = await withKeetaViewTimeout(
    client.getBlock(blockHash)
);

// Fill in the block overview and operations.
operationsList.innerHTML = "";

block.operations.forEach((operation, operationIndex) => {

    const rawOperationType =
        operation.constructor.name
            .replace(/^.*BlockOperation/, "")
            .replace(/_/g, " ")
            .trim();

    const operationType =
        rawOperationType
            ? rawOperationType
                .toLowerCase()
                .replace(
                    /\b\w/g,
                    (character) =>
                        character.toUpperCase()
                )
            : "Operation";
const recipient =
    operation.to?.publicKeyString?.toString?.() ||
    "Not available";

const token =
    operation.token?.publicKeyString?.toString?.() ||
    "Not available";

const amount =
    operation.amount?.toString?.() ||
    "Not available";
    
const shortRecipient =
    recipient === "Not available"
        ? recipient
        : `${recipient.slice(0, 14)}...${recipient.slice(-6)}`;

const displayToken =
    token === "Not available"
        ? token
        : "KTA";

const displayAmount =
    operation.amount
        ? `${formatTokenAmount(operation.amount, 18)} KTA`
        : "Not available";

    const card = document.createElement("div");

    card.className = "operation-card";
    card.style.cursor = "pointer";

    card.addEventListener("click", () => {
        window.location.href =
            `transaction.html?block=${encodeURIComponent(blockHash)}&operation=${operationIndex}`;
    });

   card.innerHTML = `
    <h3>${operationType}</h3>

    <p>
        <strong>Amount:</strong>
       ${displayAmount}
    </p>

    <p>
        <strong>Recipient:</strong>

        ${
            recipient !== "Not available"
                ? `
                    <a
                        href="address.html?address=${encodeURIComponent(recipient)}"
                        class="address-link"
                    >
                        ${shortRecipient}
                    </a>
                `
                : "Not available"
        }
    </p>

    <p>
        <strong>Token:</strong>
       ${displayToken}
    </p>
`;

    operationsList.appendChild(card);

});

blockTitle.textContent = "Block";
blockDetails.innerHTML = `
    <div class="detail-label">Hash</div>
    <div class="detail-value">${block.hash.toString()}</div>

    <div class="detail-label">Time</div>
    <div class="detail-value">${block.date.toLocaleString()}</div>

    <div class="detail-label">Network</div>
    <div class="detail-value">${block.network.toString()}</div>

    <div class="detail-label">Operations</div>
    <div class="detail-value">${block.operations.length}</div>

    <div class="detail-label">Version</div>
    <div class="detail-value">${block.version}</div>

    <div class="detail-label">Previous Block</div>
  ${
    block.previousHash
        ? `
            <a href="block.html?hash=${encodeURIComponent(block.previousHash.toString())}">
                ${block.previousHash.toString()}
            </a>
        `
        : "Not available"
}
</div>
`;

const blockDetailValues =
    blockDetails.querySelectorAll(".detail-value");

attachKeetaCopyButton(
    blockDetailValues[0],
    block.hash.toString(),
    "block hash"
);

if (block.previousHash) {
    attachKeetaCopyButton(
        blockDetails.querySelector('a[href^="block.html?hash="]'),
        block.previousHash.toString(),
        "previous block hash"
    );
}
    }
    catch (error) {
        console.error("Error loading block:", error);
    }
}

loadBlock();
