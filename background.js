(() => {
    "use strict";

    const supportedPages = [
        "home-page",
        "blocks-page-body",
        "transactions-page-body",
        "addresses-page-body",
        "assets-page-body",
        "analytics-page-body",
        "traffic-page-body",
        "status-page-body",
        "detail-page-body"
    ];

    const isSupportedPage =
        supportedPages.some(
            (pageClass) =>
                document.body.classList.contains(
                    pageClass
                )
        );

    if (
        !isSupportedPage ||
        document.getElementById("keeta-bg")
    ) {
        return;
    }

    const background = document.createElement("div");
    background.id = "keeta-bg";
    background.setAttribute("aria-hidden", "true");
    background.innerHTML = `
        <canvas id="kv-particles"></canvas>
        <canvas id="kv-network"></canvas>
        <div id="kv-streams"></div>
        <div id="kv-logos"></div>
    `;
    document.body.prepend(background);

    const reducedMotion =
        window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        );

    if (reducedMotion.matches) {
        return;
    }

    const config = {
        particleCount: 50,
        particleConnect: 110,
        particleSpeed: 0.15,
        nodeCount: 14,
        nodeConnect: 200,
        streamCount: 22,
        logoCount: 12
    };

    const particleCanvas =
        document.getElementById("kv-particles");
    const networkCanvas =
        document.getElementById("kv-network");
    const particleContext =
        particleCanvas.getContext("2d");
    const networkContext =
        networkCanvas.getContext("2d");
    const streamBox =
        document.getElementById("kv-streams");
    const logoBox =
        document.getElementById("kv-logos");

    let width = window.innerWidth;
    let height = window.innerHeight;
    let palette = readPalette();
    let animationFrame = 0;
    let lastFrame = 0;
    let running = false;

    const particles = [];
    const nodes = [];
    const logos = [];

    function readPalette() {
        const styles =
            getComputedStyle(
                document.documentElement
            );

        const getValue = (name) =>
            styles
                .getPropertyValue(name)
                .trim();

        return {
            particle:
                getValue("--kv-particle-fill"),
            particleGlow:
                getValue("--kv-particle-glow"),
            node:
                getValue("--kv-node-fill"),
            nodeGlow:
                getValue("--kv-node-glow"),
            line:
                getValue("--kv-line-color"),
            edge:
                getValue("--kv-edge-color")
        };
    }

    function withAlpha(color, alpha) {
        if (!color) {
            return `rgba(120, 140, 175, ${alpha})`;
        }

        return color.replace(
            /[\d.]+\)$/,
            `${alpha.toFixed(3)})`
        );
    }

    function centerFade(x, y) {
        const centerX = width / 2;
        const centerY = height / 2;
        const quietRadius =
            Math.min(
                centerX,
                centerY
            ) * 0.45;

        return Math.min(
            1,
            Math.hypot(
                x - centerX,
                y - centerY
            ) / quietRadius
        );
    }

    function resizeCanvas(
        canvas,
        context
    ) {
        const density =
            Math.min(
                window.devicePixelRatio || 1,
                2
            );

        canvas.width =
            Math.round(width * density);
        canvas.height =
            Math.round(height * density);

        context.setTransform(
            density,
            0,
            0,
            density,
            0,
            0
        );
    }

    function createParticle() {
        return {
            x: Math.random() * width,
            y: Math.random() * height,
            velocityX:
                (
                    Math.random() -
                    0.5
                ) *
                config.particleSpeed *
                2,
            velocityY:
                (
                    Math.random() -
                    0.5
                ) *
                config.particleSpeed *
                2,
            radius:
                0.8 +
                Math.random()
        };
    }

    function createNode() {
        let x;
        let y;
        let attempts = 0;

        do {
            x = Math.random() * width;
            y = Math.random() * height;
            attempts += 1;
        } while (
            centerFade(x, y) < 0.35 &&
            attempts < 20
        );

        return {
            x,
            y,
            velocityX:
                (
                    Math.random() -
                    0.5
                ) * 0.035,
            velocityY:
                (
                    Math.random() -
                    0.5
                ) * 0.035,
            radius:
                1.8 +
                Math.random() * 1.6,
            phase:
                Math.random() *
                Math.PI *
                2
        };
    }

    function rebuildScene() {
        width = window.innerWidth;
        height = window.innerHeight;

        resizeCanvas(
            particleCanvas,
            particleContext
        );
        resizeCanvas(
            networkCanvas,
            networkContext
        );

        particles.length = 0;
        nodes.length = 0;

        for (
            let index = 0;
            index < config.particleCount;
            index += 1
        ) {
            particles.push(
                createParticle()
            );
        }

        for (
            let index = 0;
            index < config.nodeCount;
            index += 1
        ) {
            nodes.push(
                createNode()
            );
        }

        buildStreams();
        positionLogos();
    }

    function buildStreams() {
        streamBox.replaceChildren();

        for (
            let index = 0;
            index < config.streamCount;
            index += 1
        ) {
            const stream =
                document.createElement("span");

            stream.className =
                `kv-stream${Math.random() > 0.5 ? " kv-down" : ""}`;

            const duration =
                8 +
                Math.random() * 14;

            stream.style.cssText = [
                `left:${4 + Math.random() * 92}%`,
                `height:${60 + Math.random() * 200}px`,
                `--kv-dur:${duration}s`,
                `--kv-delay:${-Math.random() * duration}s`
            ].join(";");

            streamBox.appendChild(
                stream
            );
        }
    }

    function createLogos() {
        for (
            let index = 0;
            index < config.logoCount;
            index += 1
        ) {
            const image =
                document.createElement("img");

            image.className = "kv-logo kv-logo-keeta";
            image.src = "keeta-logo.svg";
            image.alt = "";
            image.width =
                38 +
                Math.round(
                    Math.random() * 18
                );

            logoBox.appendChild(
                image
            );

            logos.push({
                element: image,
                side:
                    index % 2 === 0
                        ? "left"
                        : "right",
                x: 0,
                y: 0,
                velocityX:
                    (
                        Math.random() -
                        0.5
                    ) * 0.24,
                velocityY:
                    (
                        Math.random() -
                        0.5
                    ) * 0.29,
                rotation: 0,
                rotationVelocity:
                    (
                        Math.random() -
                        0.5
                    ) * 0.015,
                phase:
                    Math.random() *
                    Math.PI *
                    2,
                driftTimer:
                    Math.random() * 6000,
                driftInterval:
                    4000 +
                    Math.random() * 5000
            });
        }
    }

    function positionLogos() {
        logos.forEach(
            (logo, index) => {
                logo.x =
                    logo.side === "left"
                        ? width *
                            (
                                0.04 +
                                Math.random() *
                                0.14
                            )
                        : width *
                            (
                                0.78 +
                                Math.random() *
                                0.18
                            );

                logo.y =
                    height *
                    (
                        0.08 +
                        0.84 *
                        (
                            index /
                            Math.max(
                                1,
                                logos.length - 1
                            )
                        )
                    );
            }
        );
    }

    function updatePoint(point) {
        point.x +=
            point.velocityX;
        point.y +=
            point.velocityY;

        if (
            point.x < 0 ||
            point.x > width
        ) {
            point.velocityX *= -1;
        }

        if (
            point.y < 0 ||
            point.y > height
        ) {
            point.velocityY *= -1;
        }
    }

    function drawConnections(
        context,
        points,
        distanceLimit,
        color,
        multiplier
    ) {
        for (
            let first = 0;
            first < points.length;
            first += 1
        ) {
            for (
                let second = first + 1;
                second < points.length;
                second += 1
            ) {
                const distance =
                    Math.hypot(
                        points[first].x -
                        points[second].x,
                        points[first].y -
                        points[second].y
                    );

                if (
                    distance >=
                    distanceLimit
                ) {
                    continue;
                }

                const fade =
                    centerFade(
                        (
                            points[first].x +
                            points[second].x
                        ) / 2,
                        (
                            points[first].y +
                            points[second].y
                        ) / 2
                    );

                const alpha =
                    (
                        1 -
                        distance /
                        distanceLimit
                    ) *
                    multiplier *
                    fade;

                if (alpha < 0.004) {
                    continue;
                }

                context.beginPath();
                context.moveTo(
                    points[first].x,
                    points[first].y
                );
                context.lineTo(
                    points[second].x,
                    points[second].y
                );
                context.strokeStyle =
                    withAlpha(
                        color,
                        alpha
                    );
                context.lineWidth = 0.55;
                context.stroke();
            }
        }
    }

    function drawParticles() {
        particleContext.clearRect(
            0,
            0,
            width,
            height
        );

        drawConnections(
            particleContext,
            particles,
            config.particleConnect,
            palette.line,
            0.40
        );

        particles.forEach(
            (particle) => {
                const fade =
                    centerFade(
                        particle.x,
                        particle.y
                    );

                particleContext.beginPath();
                particleContext.arc(
                    particle.x,
                    particle.y,
                    particle.radius,
                    0,
                    Math.PI * 2
                );
                particleContext.fillStyle =
                    palette.particle;
                particleContext.globalAlpha =
                    0.55 +
                    0.40 *
                    fade;
                particleContext.shadowBlur =
                    fade > 0.35
                        ? 5
                        : 0;
                particleContext.shadowColor =
                    palette.particleGlow;
                particleContext.fill();
                particleContext.globalAlpha = 1;
                particleContext.shadowBlur = 0;
            }
        );
    }

    function drawNodes(time) {
        networkContext.clearRect(
            0,
            0,
            width,
            height
        );

        drawConnections(
            networkContext,
            nodes,
            config.nodeConnect,
            palette.edge,
            0.26
        );

        nodes.forEach((node) => {
            const fade =
                centerFade(
                    node.x,
                    node.y
                );

            const pulse =
                0.5 +
                0.5 *
                Math.sin(
                    time * 0.001 +
                    node.phase
                );

            const alpha =
                (
                    0.45 +
                    0.35 *
                    pulse
                ) *
                fade;

            if (alpha < 0.01) {
                return;
            }

            networkContext.beginPath();
            networkContext.arc(
                node.x,
                node.y,
                node.radius +
                    pulse,
                0,
                Math.PI * 2
            );
            networkContext.fillStyle =
                palette.node;
            networkContext.globalAlpha =
                alpha;
            networkContext.shadowBlur =
                8 +
                pulse * 8;
            networkContext.shadowColor =
                palette.nodeGlow;
            networkContext.fill();
            networkContext.globalAlpha = 1;
            networkContext.shadowBlur = 0;
        });
    }

    function updateLogos(time) {
        logos.forEach((logo) => {
            logo.driftTimer += 33;

            if (
                logo.driftTimer >
                logo.driftInterval
            ) {
                logo.driftTimer = 0;
                logo.driftInterval =
                    4000 +
                    Math.random() * 5000;
                logo.velocityX +=
                    (
                        Math.random() -
                        0.5
                    ) * 0.15;
                logo.velocityY +=
                    (
                        Math.random() -
                        0.5
                    ) * 0.13;

                const speed =
                    Math.hypot(
                        logo.velocityX,
                        logo.velocityY
                    );

                if (speed > 0.5) {
                    logo.velocityX *=
                        0.5 / speed;
                    logo.velocityY *=
                        0.5 / speed;
                }

                logo.rotationVelocity +=
                    (
                        Math.random() -
                        0.5
                    ) * 0.005;

                if (
                    Math.abs(
                        logo.rotationVelocity
                    ) > 0.04
                ) {
                    logo.rotationVelocity *=
                        0.5;
                }
            }

            logo.x += logo.velocityX;
            logo.y += logo.velocityY;
            logo.rotation +=
                logo.rotationVelocity;

            const minX =
                logo.side === "left"
                    ? width * 0.02
                    : width * 0.72;

            const maxX =
                logo.side === "left"
                    ? width * 0.28
                    : width * 0.98;

            if (logo.x < minX) {
                logo.x = minX;
                logo.velocityX =
                    Math.abs(
                        logo.velocityX
                    ) * 0.6;
            }

            if (logo.x > maxX) {
                logo.x = maxX;
                logo.velocityX =
                    -Math.abs(
                        logo.velocityX
                    ) * 0.6;
            }

            const marginY =
                height * 0.04;

            if (logo.y < marginY) {
                logo.y = marginY;
                logo.velocityY =
                    Math.abs(
                        logo.velocityY
                    ) * 0.8;
            }

            if (
                logo.y >
                height - marginY
            ) {
                logo.y =
                    height - marginY;
                logo.velocityY =
                    -Math.abs(
                        logo.velocityY
                    ) * 0.8;
            }

            const scale =
                1 +
                0.10 *
                Math.sin(
                    time * 0.0006 +
                    logo.phase
                );

            logo.element.style.transform =
                `translate(${logo.x}px, ${logo.y}px) translate(-50%, -50%) rotate(${logo.rotation}deg) scale(${scale})`;
        });
    }

    function render(time) {
        if (!running) {
            return;
        }

        if (
            time - lastFrame >=
            1000 / 30
        ) {
            particles.forEach(
                updatePoint
            );
            nodes.forEach(
                updatePoint
            );
            updateLogos(time);
            drawParticles();
            drawNodes(time);
            lastFrame = time;
        }

        animationFrame =
            requestAnimationFrame(
                render
            );
    }

    function start() {
        if (
            running ||
            document.hidden
        ) {
            return;
        }

        running = true;
        animationFrame =
            requestAnimationFrame(
                render
            );
    }

    function stop() {
        running = false;
        cancelAnimationFrame(
            animationFrame
        );
    }

    createLogos();
    rebuildScene();
    start();

    const themeObserver =
        new MutationObserver(() => {
            palette = readPalette();
        });

    themeObserver.observe(
        document.documentElement,
        {
            attributes: true,
            attributeFilter: [
                "data-theme"
            ]
        }
    );

    let resizeTimer = 0;

    window.addEventListener(
        "resize",
        () => {
            window.clearTimeout(
                resizeTimer
            );

            resizeTimer =
                window.setTimeout(
                    rebuildScene,
                    150
                );
        }
    );

    document.addEventListener(
        "visibilitychange",
        () => {
            if (document.hidden) {
                stop();
            } else {
                start();
            }
        }
    );
})();
