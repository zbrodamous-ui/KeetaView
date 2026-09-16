import { inflateSync } from "node:zlib";

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