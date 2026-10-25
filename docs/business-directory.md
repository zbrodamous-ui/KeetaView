# Public business directory

`businesses.html` uses a curated static list in `business-directory-data.js`. No chain scan, profile access, or extra indexer work runs when the page opens. The initial list is deliberately empty.

Before adding a listing:

1. Find a primary public source from the business, or an authoritative announcement explicitly connecting that business to a full Keeta account address. A business-looking username, transaction activity, or third-party speculation is insufficient.
2. Confirm the full address with the Keeta SDK and review the source. If including a registered tag, confirm both forward and reverse resolution. Do not fabricate a tag.
3. Add the entry through a reviewed code change. Use the actual date added to this directory, never an inferred account-registration date.
4. Recheck evidence when correcting or updating an entry. Remove unsupported connections. Do not publish private company documents or personal details.

Entry fields: `id` (unique slug), `name`, `address`, optional `tag`, `listedOn` (YYYY-MM-DD), and `sources` (nonempty array of `{ label, url }` with HTTPS links).

Validation checks data shape and safe source URLs; it does not verify business ownership or the cryptographic validity of an address. Those are review requirements.

No entry has a KYB badge. This directory does not establish verification, endorsement, or complete network coverage. A future official integration must independently establish what each status means and how to refresh it.

Search matches name, tag, or full address, and retains the query in the page URL. Future providers can feed the same model after provenance and verification semantics are reviewed. No submission form is offered until an actual review/intake process is available.
