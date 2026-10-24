const blocksPageList = document.getElementById("blocksPageList");
const previousButton = document.getElementById("previousPage");
const nextButton = document.getElementById("nextPage");
const pageNumber = document.getElementById("pageNumber");
const blockFilter = document.getElementById("blockFilter");
const blockResultCount = document.getElementById("blockResultCount");

const blocksPerPage = 15;
let currentPage = 1;
let totalBlocks = null;
let blocksLoadGeneration = 0;
let loadedBlocks = [];

function blockUrl(hash) {
    return `block.html?hash=${encodeURIComponent(hash)}`;
}

function createBlockRow(block) {
    const row = document.createElement("a");
    row.className = "block-directory-row";
    row.href = blockUrl(block.hash);
    row.setAttribute("aria-label", `Open block ${block.hash}`);

    const operationCount = Number(block.operation_count || 0);
    const operationLabel =
        `${operationCount.toLocaleString()} ${operationCount === 1 ? "operation" : "operations"}`;

    row.innerHTML = `
        <span class="block-directory-hash" title="${block.hash}">
            ${block.hash.slice(0, 12)}...${block.hash.slice(-6)}
        </span>

        <span class="block-directory-age">
            ${timeAgo(block.timestamp)}
        </span>

        <span class="block-directory-operations">
            ${operationLabel}
        </span>

        <span class="block-directory-network">
            Mainnet
        </span>
    `;

    return row;
}

function renderBlocksPage() {
    const query = blockFilter.value.trim().toLowerCase();
    const visibleBlocks = query
        ? loadedBlocks.filter((block) =>
            String(block.hash).toLowerCase().includes(query)
        )
        : loadedBlocks;

    blocksPageList.innerHTML = "";

    if (visibleBlocks.length === 0) {
        const empty = document.createElement("p");
        empty.className = "blocks-empty";
        empty.textContent = query
            ? "No blocks on this page match that hash."
            : "No indexed blocks are available.";
        blocksPageList.appendChild(empty);
    } else {
        visibleBlocks.forEach((block) => {
            blocksPageList.appendChild(createBlockRow(block));
        });
    }

    const totalPages = Math.max(1, Math.ceil(totalBlocks / blocksPerPage));
    const firstBlock = totalBlocks === 0
        ? 0
        : ((currentPage - 1) * blocksPerPage) + 1;
    const lastBlock = Math.min(currentPage * blocksPerPage, totalBlocks);

    blockResultCount.textContent = query
        ? `${visibleBlocks.length} matching on this page`
        : totalBlocks === null
            ? `${visibleBlocks.length} blocks on this page · Total unavailable`
            : `${firstBlock.toLocaleString()}–${lastBlock.toLocaleString()} of ${totalBlocks.toLocaleString()}`;

    pageNumber.textContent = totalBlocks === null ? `Page ${currentPage}` : `Page ${currentPage} of ${totalPages}`;
    previousButton.disabled = currentPage === 1;
    nextButton.disabled = totalBlocks === null ? loadedBlocks.length < blocksPerPage : currentPage >= totalPages;
}

async function loadBlocksPage() {
    const generation = ++blocksLoadGeneration;
    loadedBlocks = [];
    blocksPageList.innerHTML =
        '<p class="blocks-empty">Loading blocks…</p>';
    blockResultCount.textContent = "Loading blocks…";
    previousButton.disabled = true;
    nextButton.disabled = true;

    try {
        const offset = (currentPage - 1) * blocksPerPage;
        // Totals enrich the page independently; a delayed status request cannot hide rows.
        void fetchKeetaView("/api/status").then(async response => {
            if (!response.ok) return;
            const status = await response.json();
            if (generation !== blocksLoadGeneration) return;
            const count = Number(status.blocks);
            if (Number.isFinite(count) && count >= 0) totalBlocks = count;
            if (loadedBlocks.length) renderBlocksPage();
        }).catch(() => {});
        const blocksResponse = await fetchKeetaView(`/api/blocks?limit=${blocksPerPage}&offset=${offset}`);
        if (!blocksResponse.ok) throw new Error("Unable to load indexed blocks");
        const blocks = await blocksResponse.json();
        if (generation !== blocksLoadGeneration) return;
        loadedBlocks = blocks;

        renderBlocksPage();
    } catch (error) {
        if (generation !== blocksLoadGeneration) return;
        console.error("Error loading blocks page:", error);
        loadedBlocks = [];
        blocksPageList.innerHTML =
            '<p class="blocks-empty">Unable to load blocks. Please try again shortly.</p>';
        blockResultCount.textContent = "Unavailable";
        pageNumber.textContent = "Page —";
        previousButton.disabled = true;
        nextButton.disabled = true;
    }
}

blockFilter.addEventListener("input", renderBlocksPage);

previousButton.addEventListener("click", () => {
    if (currentPage > 1) {
        currentPage -= 1;
        blockFilter.value = "";
        loadBlocksPage();
        document.querySelector(".blocks-list-card")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
});

nextButton.addEventListener("click", () => {
    const totalPages = Math.ceil(totalBlocks / blocksPerPage);

    if (totalBlocks === null ? loadedBlocks.length >= blocksPerPage : currentPage < totalPages) {
        currentPage += 1;
        blockFilter.value = "";
        loadBlocksPage();
        document.querySelector(".blocks-list-card")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
});

loadBlocksPage();
