import { inflateSync } from "node:zlib";
import { lib as AnchorLib } from "@keetanetwork/anchor";

function readValue(value) {
    return value?.get?.() ?? value?.toString?.() ?? value;
}

export function toEncodedAnchorPayload(envelope) {
    if (!envelope || typeof envelope !== "object") {
        return null;
    }

    const anchors = {};

    for (const [address, metadata] of Object.entries(envelope.anchors || {})) {
        if (metadata?.transactionId !== undefined) {
            anchors[address] = { t: readValue(metadata.transactionId) };
        } else if (metadata?.persistentForwardingId !== undefined) {
            anchors[address] = { p: readValue(metadata.persistentForwardingId) };
        } else if (metadata?.destination !== undefined) {
            anchors[address] = { d: readValue(metadata.destination) };
        }
    }

    const payload = {
        v: Number(envelope.version),
        a: anchors
    };

    if (envelope.binding) {
        payload.b = {
            p: readValue(envelope.binding.previousBlockHash),
            o: Number(envelope.binding.operationIndex)
        };
    }

    if (Array.isArray(envelope.inputs)) {
        payload.i = envelope.inputs.map((input) => ({
            h: readValue(input.blockHash),
            ...(input.operationIndex === undefined
                ? {}
                : { o: Number(input.operationIndex) })
        }));
    }

    return payload;
}

export async function inspectAnchorPayload(external) {
    if (typeof external !== "string" || external.length === 0) {
        return { payload: null, status: null, signer: null, error: null };
    }

    try {
        const decoded = await AnchorLib.AnchorExternal.fromPlainExternal(external);

        return {
            payload: toEncodedAnchorPayload(decoded.envelope),
            status: decoded.signed ? "verified" : "unsigned",
            signer: decoded.signed
                ? readValue(decoded.signed.signer?.publicKeyString)
                : null,
            error: null
        };
    } catch (error) {
        const payload = decodeAnchorPayload(external);

        return {
            payload,
            status: payload ? "invalid" : null,
            signer: null,
            error: payload
                ? String(error?.code || error?.message || "INVALID_ANCHOR")
                : null
        };
    }
}

export function decodeAnchorPayload(external) {
    if (
        typeof external !== "string" ||
        external.length === 0 ||
        external.length > 65_536
    ) {
        return null;
    }

    try {
        const envelope = Buffer.from(
            external,
            "base64"
        );

        for (
            let index = 0;
            index < envelope.length - 1;
            index += 1
        ) {
            const first = envelope[index];
            const second = envelope[index + 1];

            const isZlibHeader =
                first === 0x78 &&
                ((first << 8) + second) % 31 === 0;

            if (!isZlibHeader) {
                continue;
            }

            try {
                const decoded = inflateSync(
                    envelope.subarray(index),
                    {
                        maxOutputLength: 65_536
                    }
                ).toString("utf8");

                const payload =
                    JSON.parse(decoded);

                                const anchorsAreValid =
                    payload?.a &&
                    typeof payload.a === "object" &&
                    !Array.isArray(payload.a) &&
                    Object.keys(payload.a).length > 0 &&
                    Object.values(payload.a).every(
                        (entry) =>
                            entry &&
                            typeof entry === "object" &&
                            (
                                typeof entry.t === "string" ||
                                typeof entry.p === "string" ||
                                typeof entry.d === "string"
                            )
                    );

                const bindingIsValid =
                    payload?.b === undefined ||
                    (
                        payload.b &&
                        typeof payload.b === "object" &&
                        typeof payload.b.p === "string" &&
                        Number.isInteger(payload.b.o)
                    );

                const inputsAreValid =
                    payload?.i === undefined ||
                    (
                        Array.isArray(payload.i) &&
                        payload.i.every(
                            (input) =>
                                input &&
                                typeof input === "object" &&
                                typeof input.h === "string" &&
                                (
                                    input.o === undefined ||
                                    Number.isInteger(input.o)
                                )
                        )
                    );

                const isAnchorPayload =
                    payload?.v === 1 &&
                    anchorsAreValid &&
                    bindingIsValid &&
                    inputsAreValid;

                if (isAnchorPayload) {
                    return payload;
                }
            } catch {
                // Continue searching for another zlib stream.
            }
        }
    } catch {
        return null;
    }

    return null;
}
