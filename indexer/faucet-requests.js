import { DatabaseSync } from "node:sqlite";

const ADDRESS_PATTERN = /^keeta_[a-z2-7]{20,100}$/;

export function openFaucetRequests(
    file,
    {
        dailyRequestCap = 50,
        retentionDays = 90
    } = {}
) {
    const db = new DatabaseSync(file);
    db.exec(`
        PRAGMA busy_timeout = 3000;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS faucet_interest (
            address TEXT PRIMARY KEY,
            requested_at INTEGER NOT NULL,
            request_day TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS faucet_interest_by_day
            ON faucet_interest(request_day);
    `);

    const cleanupExpired = (now) => {
        db.prepare("DELETE FROM faucet_interest WHERE requested_at < ?")
            .run(now - retentionDays * 24 * 60 * 60 * 1000);
    };

    return {
        submit(address, now = Date.now()) {
            if (typeof address !== "string") {
                return { status: 400, error: "Enter a Keeta mainnet address." };
            }

            const normalizedAddress = address.trim().toLowerCase();
            if (!ADDRESS_PATTERN.test(normalizedAddress)) {
                return { status: 400, error: "Enter a valid Keeta address." };
            }

            const requestDay = new Date(now).toISOString().slice(0, 10);
            db.exec("BEGIN IMMEDIATE");

            try {
                cleanupExpired(now);

                const existing = db.prepare(
                    "SELECT 1 FROM faucet_interest WHERE address = ?"
                ).get(normalizedAddress);

                if (existing) {
                    db.exec("COMMIT");
                    return {
                        status: 202,
                        data: {
                            message: "Thanks—if this address is eligible, it is recorded for pilot evaluation. No KTA was sent, and this does not guarantee a future payout."
                        }
                    };
                }

                const dailyCount = db.prepare(
                    "SELECT COUNT(*) AS total FROM faucet_interest WHERE request_day = ?"
                ).get(requestDay).total;

                if (dailyCount >= dailyRequestCap) {
                    db.exec("COMMIT");
                    return {
                        status: 429,
                        error: "Today's interest list is full. Please try again tomorrow."
                    };
                }

                db.prepare(
                    "INSERT INTO faucet_interest(address, requested_at, request_day) VALUES (?, ?, ?)"
                ).run(normalizedAddress, now, requestDay);

                db.exec("COMMIT");
                return {
                    status: 202,
                    data: {
                        message: "Thanks—if this address is eligible, it is recorded for pilot evaluation. No KTA was sent, and this does not guarantee a future payout."
                    }
                };
            } catch (error) {
                db.exec("ROLLBACK");
                throw error;
            }
        },
        close() {
            db.close();
        }
    };
}
