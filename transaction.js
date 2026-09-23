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

            const anchorName =
        document.getElementById(
            "anchorName"
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
    const anchorVerification = document.getElementById(
        "anchorVerification"
    );
    const anchorVerificationSummary = document.getElementById(
        "anchorVerificationSummary"
    );
    const anchorPayloadState = document.getElementById(
        "anchorPayloadState"
    );
    const anchorSigner = document.getElementById(
        "anchorSigner"
    );

            const anchorBacklinks =
        document.getElementById(
            "anchorBacklinks"
        );

    const anchorBacklinkList =
        document.getElementById(
            "anchorBacklinkList"
        );
    const anchorReferences =
        document.getElementById(
            "anchorReferences"
        );
    const anchorReferenceList =
        document.getElementById(
            "anchorReferenceList"
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
        attachKeetaCopyButton(
            transactionHash,
            `${blockHash}:${operationIndex}`,
            "operation ID"
        );

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

        attachKeetaCopyButton(
            from,
            sender,
            "sender address"
        );

        to.innerHTML =
            recipient !== "Not available"
                ? `<a href="address.html?address=${encodeURIComponent(
                    recipient
                )}">${formatKeetaIdentifier(
                    recipient
                )}</a>`
                : "Not available";

        attachKeetaCopyButton(
            to,
            recipient,
            "recipient address"
        );

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
        attachKeetaCopyButton(
            blockElement,
            blockHash,
            "block hash"
        );

const anchor = transaction.anchor;
const verification = transaction.anchor_verification;
const anchorEntry =
    Object.entries(
        anchor?.a || {}
    )[0];

const verificationDetails = {
    verified: {
        label: "Verified",
        summary:
            "The payload signature is valid and matches the displayed signer.",
        payloadState: "Decoded and signature verified"
    },
    unsigned: {
        label: "Unsigned",
        summary:
            "The Anchor payload is valid, but it does not contain a signature.",
        payloadState: "Decoded without a signature"
    },
    invalid: {
        label: "Invalid",
        summary:
            "The payload or its signature could not be validated. Treat its contents as untrusted.",
        payloadState: "Decoded with validation errors"
    },
    encrypted: {
        label: "Encrypted",
        summary:
            "The payload is encrypted. Its contents and signature cannot be inspected without an authorized key.",
        payloadState: "Encrypted and not decoded"
    }
};

const verificationStatus =
    verification?.status || "unknown";
const verificationDetail =
    verificationDetails[verificationStatus] || {
        label: "Detected",
        summary:
            "An Anchor payload was detected, but its verification state is unavailable.",
        payloadState: "Detected"
    };

function renderAnchorSigner() {
    anchorSigner.replaceChildren();

    if (!verification?.signer) {
        anchorSigner.textContent =
            verificationStatus === "unsigned"
                ? "No signer (unsigned payload)"
                : "Not available";
        return;
    }

    const signerLink = document.createElement("a");
    signerLink.href =
        `address.html?address=${encodeURIComponent(
            verification.signer
        )}`;
    signerLink.textContent =
        formatKeetaIdentifier(verification.signer);
    signerLink.title = verification.signer;
    anchorSigner.append(signerLink);
    attachKeetaCopyButton(
        anchorSigner,
        verification.signer,
        "Anchor signer address"
    );
}

if (verification?.status === "encrypted") {
    anchorVerification.textContent =
        verificationDetail.label;
    anchorVerification.className =
        "anchor-verification anchor-verification-encrypted";
    anchorVerificationSummary.textContent =
        verificationDetail.summary;
    anchorPayloadState.textContent =
        verificationDetail.payloadState;
    renderAnchorSigner();

    document
        .querySelectorAll(".anchor-decoded-field")
        .forEach((element) => {
            element.hidden = true;
        });

    anchorDetails.hidden = false;
}

if (
    anchor &&
    anchorEntry
) {
    anchorVerification.textContent =
        verificationDetail.label;
    anchorVerification.className =
        `anchor-verification anchor-verification-${verification?.status || "unknown"}`;
    anchorVerificationSummary.textContent =
        verification?.error && verificationStatus === "invalid"
            ? `${verificationDetail.summary} ${verification.error}`
            : verificationDetail.summary;
    anchorPayloadState.textContent =
        verificationDetail.payloadState;
    renderAnchorSigner();

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
    attachKeetaCopyButton(
        anchorAddress,
        addressValue,
        "Anchor account address"
    );

    try {
        const anchorAccount =
            KeetaNet.lib.Account
                .fromPublicKeyString(
                    addressValue
                );

        const anchorAccountInfo =
            await client.getAccountInfo(
                anchorAccount
            );

        anchorName.textContent =
            anchorAccountInfo?.info?.name ||
            "Not published";
    } catch (error) {
        console.warn(
            "Unable to load anchor name:",
            error
        );

        anchorName.textContent =
            "Unavailable";
    }

    const anchorTransactionIdentifier =
        anchorMetadata?.t ||
        anchorMetadata?.p ||
        anchorMetadata?.d ||
        "Not available";

    anchorIdentifier.textContent =
        anchorTransactionIdentifier;
    attachKeetaCopyButton(
        anchorIdentifier,
        anchorTransactionIdentifier,
        "Anchor transaction ID"
    );

    const anchorHasBinding =
        typeof anchor?.b?.p === "string" &&
        Number.isInteger(anchor?.b?.o);

    if (anchorHasBinding) {
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
    } else {
        anchorReference.removeAttribute(
            "href"
        );
        anchorReference.textContent =
            "Not provided";
    }

    anchorVersion.textContent =
        String(anchor.v);

    anchorDetails.hidden = false;
}

const anchorInputs =
    transaction.anchor_inputs;

if (
    Array.isArray(anchorInputs) &&
    anchorInputs.length > 0
) {
    anchorBacklinkList.replaceChildren();

        anchorInputs.forEach(
        (reference, index) => {
            if (index > 0) {
                anchorBacklinkList.append(
                    document.createElement("br")
                );
            }

            const link =
                document.createElement("a");

            link.href =
                `transaction.html?block=${encodeURIComponent(
                    reference.anchor_block_hash
                )}&operation=${encodeURIComponent(
                    reference.anchor_operation_index
                )}`;

            link.textContent =
                reference.anchor_transaction_id ||
                `${formatKeetaIdentifier(
                    reference.anchor_block_hash
                )}:${reference.anchor_operation_index}`;

            link.title =
                `Anchor transaction ${reference.anchor_block_hash}:${reference.anchor_operation_index}`;

            anchorBacklinkList.append(link);
        }
    );

    anchorBacklinks.hidden = false;
}

const anchorInputReferences =
    transaction.anchor_references;

if (
    Array.isArray(anchorInputReferences) &&
    anchorInputReferences.length > 0
) {
    anchorReferenceList.replaceChildren();

    anchorInputReferences.forEach(
        (reference, index) => {
            if (index > 0) {
                anchorReferenceList.append(
                    document.createElement("br")
                );
            }

            const link = document.createElement("a");
            const operation =
                reference.referenced_operation_index;

            if (Number.isInteger(operation)) {
                link.href =
                    `transaction.html?block=${encodeURIComponent(
                        reference.referenced_block_hash
                    )}&operation=${encodeURIComponent(operation)}`;
                link.textContent =
                    `${formatKeetaIdentifier(
                        reference.referenced_block_hash
                    )}:${operation}`;
            } else {
                link.href =
                    `block.html?hash=${encodeURIComponent(
                        reference.referenced_block_hash
                    )}`;
                link.textContent =
                    `${formatKeetaIdentifier(
                        reference.referenced_block_hash
                    )} (block)`;
            }

            link.title =
                `Anchor input ${reference.input_index + 1}`;
            anchorReferenceList.append(link);
        }
    );

    anchorReferences.hidden = false;
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
