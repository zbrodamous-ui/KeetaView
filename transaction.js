const client =
    KeetaNet.Client.fromNetwork("main");

const params =
    new URLSearchParams(window.location.search);

const blockHash =
    params.get("block");

const operationIndex =
    Number(params.get("operation"));

function formatTokenAmount(
    rawAmount,
    decimalPlaces
) {
    const raw = BigInt(rawAmount);
    const decimals =
        Number(decimalPlaces || 0);

    if (decimals === 0) {
        return raw.toLocaleString();
    }

    const divisor =
        10n ** BigInt(decimals);
    const whole = raw / divisor;
    const remainder = raw % divisor;
    const fraction =
        remainder
            .toString()
            .padStart(decimals, "0")
            .replace(/0+$/, "");

    return fraction
        ? `${whole.toLocaleString()}.${fraction}`
        : whole.toLocaleString();
}

async function getTransactionData() {
    const response =
        await fetchKeetaView(
            `http://localhost:3000/api/transaction?block=${encodeURIComponent(
                blockHash
            )}&operation=${encodeURIComponent(
                operationIndex
            )}`,
            {
                cache: "no-store"
            }
        );

    if (response.ok) {
        return response.json();
    }

    const block =
        await client.getBlock(blockHash);

    const operation =
        block.operations[operationIndex];

    if (!operation) {
        throw new Error(
            "Transaction operation was not found."
        );
    }

    return {
        block_hash: blockHash,
        operation_index: operationIndex,
        sender:
            block.account
                ?.publicKeyString
                ?.toString?.() ||
            null,
        recipient:
            operation.to
                ?.publicKeyString
                ?.toString?.() ||
            null,
        token:
            operation.token
                ?.publicKeyString
                ?.toString?.() ||
            null,
        amount:
            operation.amount
                ?.toString?.() ||
            null
    };
}

async function loadTransaction() {
    const transactionHash =
        document.getElementById(
            "transactionHash"
        );
    const operationType =
        document.getElementById(
            "operationType"
        );
    const status =
        document.getElementById("status");
    const from =
        document.getElementById("from");
    const to =
        document.getElementById("to");
    const amount =
        document.getElementById("amount");
    const fee =
        document.getElementById("fee");
    const blockElement =
        document.getElementById("block");

    const anchorDetails =
        document.getElementById(
            "anchorDetails"
        );
    const anchorAddress =
        document.getElementById(
            "anchorAddress"
        );
    const anchorIdentifier =
        document.getElementById(
            "anchorIdentifier"
        );
    const anchorReference =
        document.getElementById(
            "anchorReference"
        );
    const anchorVersion =
        document.getElementById(
            "anchorVersion"
        );

    try {
        const transaction =
            await getTransactionData();

        const sender =
            transaction.sender ||
            "Not available";
        const recipient =
            transaction.recipient ||
            "Not available";

        let readableAmount =
            transaction.amount ||
            "Not available";
        let tokenName = "";

        if (
            transaction.amount &&
            transaction.token
        ) {
            try {
                const tokenAccount =
                    KeetaNet.lib.Account
                        .fromPublicKeyString(
                            transaction.token
                        );

                const tokenInfo =
                    await client.getAccountInfo(
                        tokenAccount
                    );

                tokenName =
                    tokenInfo?.info?.name ||
                    formatKeetaIdentifier(
                        transaction.token,
                        8,
                        6
                    );

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

                const formatted =
                    formatTokenAmount(
                        transaction.amount,
                        decimalPlaces
                    );

                readableAmount =
                    Number(
                        formatted.replace(/,/g, "")
                    ).toLocaleString(
                        undefined,
                        {
                            maximumFractionDigits: 6
                        }
                    );
            } catch (error) {
                console.warn(
                    "Unable to format transaction token:",
                    error
                );
            }
        }

        transactionHash.textContent =
            `${formatKeetaIdentifier(
                blockHash
            )}:${operationIndex}`;

        operationType.textContent =
            String(
                transaction.operation_type ||
                "Operation"
            )
                .toLowerCase()
                .replace(
                    /\b\w/g,
                    (character) =>
                        character.toUpperCase()
                );

        status.textContent = "Success";

        from.innerHTML =
            sender !== "Not available"
                ? `<a href="address.html?address=${encodeURIComponent(
                    sender
                )}">${formatKeetaIdentifier(
                    sender
                )}</a>`
                : "Not available";

        to.innerHTML =
            recipient !== "Not available"
                ? `<a href="address.html?address=${encodeURIComponent(
                    recipient
                )}">${formatKeetaIdentifier(
                    recipient
                )}</a>`
                : "Not available";

        amount.textContent =
            `${readableAmount} ${tokenName}`
                .trim();

        fee.textContent = "—";

        blockElement.innerHTML =
            `<a href="block.html?hash=${encodeURIComponent(
                blockHash
            )}">${formatKeetaIdentifier(
                blockHash
            )}</a>`;

const anchor = transaction.anchor;
const anchorEntry =
    Object.entries(
        anchor?.a || {}
    )[0];

if (
    anchor &&
    anchorEntry &&
    typeof anchor?.b?.p === "string" &&
    Number.isInteger(anchor?.b?.o)
) {
    const [
        addressValue,
        anchorMetadata
    ] = anchorEntry;

    const addressLink =
        document.createElement("a");

    addressLink.href =
        `address.html?address=${encodeURIComponent(
            addressValue
        )}`;
    addressLink.textContent =
        formatKeetaIdentifier(
            addressValue
        );

    anchorAddress.replaceChildren(
        addressLink
    );

    anchorIdentifier.textContent =
        anchorMetadata?.t ||
        "Not available";

    anchorReference.href =
        `transaction.html?block=${encodeURIComponent(
            anchor.b.p
        )}&operation=${encodeURIComponent(
            anchor.b.o
        )}`;

    anchorReference.textContent =
        `${formatKeetaIdentifier(
            anchor.b.p
        )}:${anchor.b.o}`;

    anchorVersion.textContent =
        String(anchor.v);

    anchorDetails.hidden = false;
}

    } catch (error) {
        console.error(
            "Transaction loading error:",
            error
        );

        status.textContent = "Unavailable";
        transactionHash.textContent =
            "Unable to load transaction";
    }
}

loadTransaction();
