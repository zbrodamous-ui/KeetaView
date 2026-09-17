import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { decodeAnchorPayload } from "./anchor.js";

function encodeEnvelope(payload) {
    const prefix = Buffer.from([
        0x01,
        0x02,
        0x03
    ]);

    return Buffer.concat([
        prefix,
        deflateSync(
            JSON.stringify(payload)
        )
    ]).toString("base64");
}

test(
    "decodes a valid anchor payload from an envelope",
    () => {
        const payload = {
            v: 1,
            a: {
                keeta_anchor: {
                    t: "anchor-123"
                }
            },
            b: {
                p: "block-hash",
                o: 2
            },
            i: [
                {
                    h: "input-block",
                    o: 1
                }
            ]
        };

        assert.deepEqual(
            decodeAnchorPayload(
                encodeEnvelope(payload)
            ),
            payload
        );
    }
);

test(
    "accepts an anchor payload without an optional binding",
    () => {
        const payload = {
            v: 1,
            a: {
                keeta_anchor: {
                    d: "document"
                }
            }
        };

        assert.deepEqual(
            decodeAnchorPayload(
                encodeEnvelope(payload)
            ),
            payload
        );
    }
);

test(
    "rejects invalid anchor payloads",
    () => {
        assert.equal(
            decodeAnchorPayload(
                encodeEnvelope({
                    v: 2,
                    a: {
                        keeta_anchor: {
                            t: "wrong-version"
                        }
                    }
                })
            ),
            null
        );

        assert.equal(
            decodeAnchorPayload(
                "not-an-envelope"
            ),
            null
        );
    }
);
