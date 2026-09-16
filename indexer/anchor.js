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

                const isAnchorPayload =
                    payload?.v === 1 &&
                    payload?.a &&
                    typeof payload.a ===
                        "object" &&
                    typeof payload?.b?.p ===
                        "string" &&
                    Number.isInteger(
                        payload?.b?.o
                    );

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