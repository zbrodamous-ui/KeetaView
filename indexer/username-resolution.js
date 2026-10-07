// Verify both directions before associating a registered handle with an account.
// The provider comes from the official Anchor SDK's mainnet service discovery.
export function normalizeKeetaUsername(input) {
    if (typeof input !== "string") return null;
    const value = input.trim().toLowerCase();
    return /^[a-z0-9_]{2,24}\$keeta\.xyz$/.test(value) ? value : null;
}

function addressOf(result) {
    return result?.account?.publicKeyString?.get?.() || null;
}

export async function resolveRegisteredUsername(provider, input) {
    const forwardQuery = normalizeKeetaUsername(input);
    const reverseQuery = typeof input === "string" && input.startsWith("keeta_");
    if (!forwardQuery && !reverseQuery) throw new Error("Invalid Keeta username lookup");
    const result = await provider.resolve(forwardQuery ? forwardQuery.split("$")[0] : input);
    if (!result) return null;
    const username = normalizeKeetaUsername(result.globallyIdentifiableUsername);
    const address = addressOf(result);
    if (!username || !address || result.providerID !== "keeta.xyz") {
        throw new Error("Unexpected username provider response");
    }
    if (forwardQuery && username !== forwardQuery || reverseQuery && address !== input) {
        throw new Error("Username lookup returned a different account or name");
    }
    const confirmation = await provider.resolve(forwardQuery ? address : username.split("$")[0]);
    if (!confirmation || addressOf(confirmation) !== address ||
        normalizeKeetaUsername(confirmation.globallyIdentifiableUsername) !== username ||
        confirmation.providerID !== "keeta.xyz") {
        return null; // Changed/released mapping: do not display it as current.
    }
    return { address, username };
}
