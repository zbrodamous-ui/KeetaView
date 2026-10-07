import { spawn } from "node:child_process";

let shuttingDown = false;
const children = [];

function startService(name, args, { critical = true } = {}) {
    console.log(
        `Starting KeetaView ${name}...`
    );

    const child =
        spawn(
            process.execPath,
            args,
            {
                stdio: "inherit"
            }
        );

    children.push(child);

    child.on("error", (error) => {
        console.error(
            `${name} failed to start:`,
            error
        );

        if (critical) shutdown(1);
    });

    child.on("exit", (code) => {
        if (
            !shuttingDown &&
            code !== 0
        ) {
            console.error(
                `${name} stopped unexpectedly with code ${code}.`
            );

            if (critical) shutdown(code || 1);
        }
    });

    return child;
}

function shutdown(exitCode = 0) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;

    console.log(
        "\nStopping KeetaView services..."
    );

    children.forEach((child) => {
        if (!child.killed) {
            child.kill("SIGTERM");
        }
    });

    setTimeout(
        () => process.exit(exitCode),
        5000
    ).unref();
}

startService(
    "Indexer",
    [
    "indexer/indexer.js",
    "--watch",
    "0"
    ]
);

await new Promise(
    (resolve) =>
        setTimeout(resolve, 1500)
);

startService(
    "API",
    ["indexer/server.js"]
);

startService("Account names", ["indexer/account-name-worker.js"], { critical: false });

process.on(
    "SIGINT",
    () => shutdown(0)
);

process.on(
    "SIGTERM",
    () => shutdown(0)
);
