function holderActivityUrl(address, token) {
    return `/transactions?${new URLSearchParams({view: "transfers", address, token})}`;
}

function walletTransferDirection(operation, address) {
    if (operation.operation_type === "RECEIVE" && operation.sender === address) return "Received";
    if (operation.sender === address && operation.recipient === address) return "Self transfer";
    if (operation.sender === address) return "Sent";
    if (operation.recipient === address) return "Received";
    return "Transfer";
}

async function loadKtaHolders(assetAddress) {
    const section = document.getElementById("assetHolders");
    const status = document.getElementById("holderCoverage");
    const list = document.getElementById("assetHoldersList");
    let loading = false;
    async function refresh() {
        if (loading) return;
        loading = true;
        try {
            const response = await fetchKeetaView(`/api/holders?token=${encodeURIComponent(assetAddress)}&limit=25`);
            if (!response.ok) { section.hidden = true; return; }
            const payload = await response.json();
            section.hidden = false;
            status.textContent = `Ranked among ${Number(payload.checked_wallets).toLocaleString()} checked wallets; ${Number(payload.discovered_wallets).toLocaleString()} discovered. Coverage is still growing. Balances are cached network snapshots, not live balances.`;
            list.replaceChildren();
            if (!payload.holders.length) {
                const row = document.createElement("tr");
                const message = document.createElement("td");
                message.colSpan = 4;
                message.textContent = "Collecting KTA balances in the background. Check back shortly.";
                row.append(message); list.append(row);
            }
            payload.holders.forEach((holder, index) => {
                const row = document.createElement("tr");
                const rank = document.createElement("td"); rank.textContent = index + 1;
                const wallet = document.createElement("td");
                const activity = document.createElement("a");
                const label = holder.username || holder.name;
                activity.textContent = label ? `${label} (${formatKeetaIdentifier(holder.address)})` : formatKeetaIdentifier(holder.address);
                activity.href = holderActivityUrl(holder.address, payload.token);
                activity.title = `View this wallet's KTA transfers\n${holder.address}`;
                wallet.append(activity);
                const balance = document.createElement("td");
                balance.textContent = `${formatAssetSupply(holder.balance, payload.decimals)} KTA`;
                const checked = document.createElement("td");
                checked.textContent = timeAgo(new Date(holder.checked_at));
                checked.title = new Date(holder.checked_at).toISOString();
                row.append(rank, wallet, balance, checked); list.append(row);
            });
        } catch (error) {
            section.hidden = false;
            status.textContent = "Holder balances are temporarily unavailable. Try Refresh holders.";
        } finally { loading = false; }
    }
    document.getElementById("refreshHolders").addEventListener("click", refresh);
    await refresh();
    if (!section.hidden) window.setInterval(() => { if (!document.hidden) refresh(); }, 60000);
}
