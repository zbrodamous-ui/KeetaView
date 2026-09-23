const client =
    KeetaNet.Client.fromNetwork("main");

function formatAssetSupply(rawSupply, decimalPlaces) {
    const raw =
        BigInt(rawSupply);

    const decimals =
        Number(decimalPlaces || 0);

    if (decimals === 0) {
        return raw.toLocaleString();
    }

    const divisor =
        10n ** BigInt(decimals);

    const whole =
        raw / divisor;

    const remainder =
        raw % divisor;

    let fraction =
        remainder
            .toString()
            .padStart(decimals, "0")
            .replace(/0+$/, "");

    const wholeFormatted =
        whole.toLocaleString();

    return fraction
        ? `${wholeFormatted}.${fraction}`
        : wholeFormatted;
}

async function loadAsset() {
    const params =
        new URLSearchParams(
            window.location.search
        );

    const assetAddress =
        params.get("asset");

    if (!assetAddress) {
        document.getElementById(
            "assetTitle"
        ).textContent =
            "No asset provided";

        return;
    }

    document.getElementById(
        "assetAddress"
    ).textContent =
        assetAddress;

    attachKeetaCopyButton(
        document.getElementById("assetAddress"),
        assetAddress,
        "asset address"
    );

    try {
        const assetInfo =
            await withKeetaViewTimeout(
                client.getAccountInfo(
                    assetAddress
                )
            );

        if (!assetInfo?.info) {
            document.getElementById(
                "assetTitle"
            ).textContent =
                "Asset information unavailable";

            return;
        }

        document.getElementById(
            "assetTitle"
        ).textContent =
            assetInfo.info.name ||
            "Unknown Asset";

        document.getElementById(
            "assetDescription"
        ).textContent =
            assetInfo.info.description ||
            "";

        let decimalPlaces = 0;

        try {
            const metadata =
                JSON.parse(
                    atob(
                        assetInfo.info.metadata
                    )
                );

            decimalPlaces =
                Number(
                    metadata.decimalPlaces ||
                    0
                );
        } catch (error) {
            console.warn(
                "Unable to decode asset metadata:",
                error
            );
        }

        document.getElementById(
            "assetDecimals"
        ).textContent =
            decimalPlaces.toString();

        const formattedSupply =
            formatAssetSupply(
                assetInfo.info.supply,
                decimalPlaces
            );
const rawTotalSupply =
    await withKeetaViewTimeout(
        client.getTokenSupply(
            assetAddress
        )
    );

const totalSupply =
    formatAssetSupply(
        rawTotalSupply,
        decimalPlaces
    );
    document.getElementById(
    "assetSupply"
).textContent =
    `${totalSupply} ${assetInfo.info.name || ""}`;


            
await loadRecentTransfers(
    assetAddress,
    decimalPlaces,
    assetInfo.info.name || ""
);
    } catch (error) {
        console.error(
            "Error loading asset:",
            error
        );

        document.getElementById(
            "assetTitle"
        ).textContent =
            "Unable to load asset";
    }
}
function shortAddress(address) {
    if (!address || address === "Not available") {
        return "Not available";
    }

    return formatKeetaIdentifier(address);
}
async function loadRecentTransfers(
    assetAddress,
    decimalPlaces,
    assetName
) {
    const transfersList =
        document.getElementById(
            "assetTransfersList"
        );

    try {
        const response =
            await fetch(
                `/api/transfers?token=${encodeURIComponent(assetAddress)}&limit=10`,
                {
                    headers: {
                        Accept: "application/json"
                    }
                }
            );

        if (!response.ok) {
            throw new Error(
                `Transfers API returned ${response.status}.`
            );
        }

        const transfers =
            await response.json();

        transfersList.innerHTML = "";

        if (
            !Array.isArray(transfers) ||
            transfers.length === 0
        ) {
            transfersList.textContent =
                "No indexed transfers found.";

            return;
        }

        transfers.forEach((transfer) => {
            const sender =
                transfer.sender ||
                "Not available";

            const recipient =
                transfer.recipient ||
                "Not available";

            const amount =
                transfer.amount !== null &&
                transfer.amount !== undefined
                    ? formatAssetSupply(
                        transfer.amount,
                        decimalPlaces
                    )
                    : "—";

            const row =
                document.createElement("div");

            row.className =
                "asset-transfer-row";

            row.innerHTML = `
                <a
                    data-label="From"
                    href="/address?address=${encodeURIComponent(sender)}"
                >
                    ${shortAddress(sender)}
                </a>

                <a
                    data-label="To"
                    href="/address?address=${encodeURIComponent(recipient)}"
                >
                    ${shortAddress(recipient)}
                </a>

                <a
                    data-label="Amount"
                    href="/transaction?block=${encodeURIComponent(transfer.block_hash)}&operation=${transfer.operation_index}"
                    class="asset-transfer-link"
                >
                    ${amount} ${assetName}
                </a>

                <span data-label="Age">
                    ${timeAgo(transfer.timestamp)}
                </span>
            `;

            transfersList.appendChild(
                row
            );
        });
    } catch (error) {
        console.error(
            "Error loading asset transfers:",
            error
        );

        transfersList.textContent =
            "Unable to load indexed transfers.";
    }
}

loadAsset();
