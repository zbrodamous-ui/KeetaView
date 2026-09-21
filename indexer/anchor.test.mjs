import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { lib as AnchorLib } from "@keetanetwork/anchor";
import { lib as KeetaNetLib } from "@keetanetwork/keetanet-client";
import {
    decodeAnchorPayload,
    inspectAnchorPayload,
    toEncodedAnchorPayload
} from "./anchor.js";

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

test("normalizes an official expanded Anchor envelope", () => {
    assert.deepEqual(
        toEncodedAnchorPayload({
            version: 1,
            anchors: {
                keeta_anchor: { transactionId: "anchor-123" }
            },
            binding: {
                previousBlockHash: "previous-block",
                operationIndex: 4
            },
            inputs: [{ blockHash: "input-block", operationIndex: 2 }]
        }),
        {
            v: 1,
            a: { keeta_anchor: { t: "anchor-123" } },
            b: { p: "previous-block", o: 4 },
            i: [{ h: "input-block", o: 2 }]
        }
    );
});

test("marks recognizable payloads rejected by the SDK as invalid", async () => {
    const inspection = await inspectAnchorPayload(
        encodeEnvelope({
            v: 1,
            a: { keeta_anchor: { t: "anchor-123" } }
        })
    );

    assert.equal(inspection.status, "invalid");
    assert.equal(inspection.payload.v, 1);
    assert.equal(inspection.signer, null);
});

test("recognizes an official unsigned Anchor envelope", async () => {
    const anchor = KeetaNetLib.Account.fromSeed("11".repeat(32), 0);
    const external = await new AnchorLib.AnchorExternal.Builder()
        .setAnchor(anchor, { transactionId: "official-123" })
        .addInput("input-block", 3)
        .build();

    const inspection = await inspectAnchorPayload(external);

    assert.equal(inspection.status, "unsigned");
    assert.equal(inspection.signer, null);
    assert.deepEqual(inspection.payload.i, [
        { h: "input-block", o: 3 }
    ]);
});

test("verifies an official signed Anchor envelope", async () => {
    const signer = KeetaNetLib.Account.fromSeed("22".repeat(32), 0);
    const external = await new AnchorLib.AnchorExternal.Builder()
        .setAnchor(signer, { transactionId: "signed-123" })
        .withSigner(signer)
        .withBinding("33".repeat(32), 1)
        .build();

    const inspection = await inspectAnchorPayload(external);

    assert.equal(inspection.status, "verified");
    assert.equal(
        inspection.signer,
        signer.publicKeyString.get()
    );
    assert.deepEqual(inspection.payload.b, {
        p: "33".repeat(32).toUpperCase(),
        o: 1
    });
});

test("recognizes an encrypted Anchor without decoding it", async () => {
    const anchor = KeetaNetLib.Account.fromSeed("44".repeat(32), 0);
    const recipient = KeetaNetLib.Account.fromSeed("55".repeat(32), 0);
    const external = await new AnchorLib.AnchorExternal.Builder()
        .setAnchor(anchor, { transactionId: "private-123" })
        .withPrincipals([recipient])
        .build();

    const inspection = await inspectAnchorPayload(external);

    assert.equal(inspection.status, "encrypted");
    assert.equal(inspection.encrypted, true);
    assert.equal(inspection.payload, null);
    assert.equal(inspection.signer, null);
    assert.equal(inspection.error, null);
});

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
