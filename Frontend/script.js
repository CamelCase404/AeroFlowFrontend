"use strict";

const API_URL = "http://localhost:8000";

let canvas = null;
let ctx = null;
let animationFrameId = null;
let isCalculating = false;
let particles = [];

let bgCanvas = null;
let bgCtx = null;
let bgWindLines = [];
const mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000 };

const simParams = {
    speed: 6,
    density: 160,
    viewMode: "particles",
};

const flowObject = {
    x: 0,
    y: 0,
    radius: 55,
    isDragging: false,
};

const loadedModel = {
    image: null,
    width: 0,
    height: 0,
    src: null,
    file: null,
};

let serverFields = null;
let isRequesting = false;

const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
).matches;

document.addEventListener("DOMContentLoaded", () => {
    canvas = document.getElementById("aeroCanvas");

    if (canvas) {
        ctx = canvas.getContext("2d", { alpha: false });
        canvas.width = 800;
        canvas.height = 450;

        flowObject.x = canvas.width / 2.5;
        flowObject.y = canvas.height / 2.2;

        generateParticles(simParams.density);
        drawStaticScene();
        initObjectInteraction();
        initModelUpload();
    }

    initBackgroundWind();
    initScrollReveal();
    initEventDelegation();
    initSubscribeForm();
    checkBackend();
});

async function checkBackend() {
    try {
        const res = await fetch(`${API_URL}/health`);
        if (!res.ok) return;
        const data = await res.json();
        console.info(`AeroFlow backend: ${data.status}, device=${data.device}`);
    } catch {
        console.warn(`AeroFlow backend недоступен: ${API_URL}`);
    }
}

function initEventDelegation() {
    document.addEventListener("click", (e) => {
        const actionEl = e.target.closest("[data-action]");
        if (actionEl) {
            const action = actionEl.dataset.action;
            if (action === "scroll-to-sim") scrollToSim();
            if (action === "start") runSimulation();
            if (action === "reset") resetSimulation();
            if (action === "clear-model") clearModel();
            return;
        }

        const viewBtn = e.target.closest("[data-view-mode]");
        if (viewBtn) {
            setViewMode(viewBtn.dataset.viewMode);
        }
    });

    const speedInput = document.getElementById("inputSpeed");
    const densityInput = document.getElementById("inputDensity");

    speedInput?.addEventListener("input", updateParams);
    densityInput?.addEventListener("input", updateParams);

    speedInput?.addEventListener("change", () => {
        if (loadedModel.file) requestSimulation(loadedModel.file);
    });
    densityInput?.addEventListener("change", () => {
        if (loadedModel.file) requestSimulation(loadedModel.file);
    });
}

function initSubscribeForm() {
    const form = document.querySelector('[data-action="subscribe"]');
    if (!form) return;

    form.addEventListener("submit", (e) => {
        e.preventDefault();
        const input = form.querySelector('input[type="email"]');
        if (!input || !input.checkValidity()) {
            input?.reportValidity();
            return;
        }
        alert("Вы успешно подписаны на обновления нод.");
        form.reset();
    });
}

function initModelUpload() {
    const input = document.getElementById("modelInput");
    const zone = document.getElementById("dropZone");
    const uploadZone = document.getElementById("uploadZone");
    if (!input || !zone) return;

    input.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) loadModelFromFile(file);
    });

    ["dragenter", "dragover"].forEach((evt) => {
        zone.addEventListener(evt, (e) => {
            e.preventDefault();
            zone.classList.add("dragover");
            uploadZone?.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach((evt) => {
        zone.addEventListener(evt, (e) => {
            e.preventDefault();
            if (evt === "dragleave" && zone.contains(e.relatedTarget)) return;
            zone.classList.remove("dragover");
            uploadZone?.classList.remove("dragover");
        });
    });

    zone.addEventListener("drop", (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith("image/")) loadModelFromFile(file);
    });
}

function loadModelFromFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = async () => {
            const maxSide = flowObject.radius * 2.4;
            const scale = Math.min(
                maxSide / img.width,
                maxSide / img.height,
                1,
            );

            loadedModel.image = img;
            loadedModel.width = img.width * scale;
            loadedModel.height = img.height * scale;
            loadedModel.src = e.target.result;
            loadedModel.file = file;

            flowObject.radius =
                Math.max(loadedModel.width, loadedModel.height) / 2;

            document.getElementById("uploadZone")?.setAttribute("hidden", "");
            updateTelemetry();
            if (!isCalculating) drawStaticScene();

            await requestSimulation(file);
        };
        img.onerror = () => {
            alert("Не удалось загрузить изображение. Попробуйте другой файл.");
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function requestSimulation(file) {
    if (!file || isRequesting) return;
    isRequesting = true;

    const statusBadge = document.getElementById("simStatus");
    statusBadge.innerHTML =
        '<span class="pulse-dot active" aria-hidden="true"></span> СТАТУС: ЗАПРОС К НЕЙРОСЕТИ';
    statusBadge.style.color = "#00c2ff";

    const formData = new FormData();
    formData.append("file", file);
    formData.append("speed", simParams.speed);
    formData.append("density", simParams.density);
    formData.append("resolution", "128");

    try {
        const res = await fetch(`${API_URL}/api/simulate`, {
            method: "POST",
            body: formData,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `HTTP ${res.status}`);
        }

        const data = await res.json();

        serverFields = {
            pressure: data.pressure,
            velocity_u: data.velocity_u,
            velocity_v: data.velocity_v,
            stats: data.stats,
            resolution: data.resolution,
            inference_ms: data.inference_ms,
        };

        if (data.stats) {
            document.getElementById("telCx").textContent =
                data.stats.cx.toFixed(3);
            document.getElementById("telCy").textContent =
                data.stats.cy.toFixed(3);
            document.getElementById("telTurb").textContent = `Re ${Math.round(
                data.stats.reynolds,
            ).toLocaleString("ru-RU")}`;
        }

        statusBadge.innerHTML = `<span class="pulse-dot active" aria-hidden="true"></span> СТАТУС: ПОЛУЧЕНО ЗА ${data.inference_ms} МС`;
        statusBadge.style.color = "#10b981";

        if (!isCalculating) drawStaticScene();
    } catch (err) {
        console.error(err);
        statusBadge.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span> СТАТУС: ОШИБКА — ${err.message}`;
        statusBadge.style.color = "#ef4444";
    } finally {
        isRequesting = false;
    }
}

function clearModel() {
    loadedModel.image = null;
    loadedModel.src = null;
    loadedModel.width = 0;
    loadedModel.height = 0;
    loadedModel.file = null;
    serverFields = null;
    flowObject.radius = 55;

    const input = document.getElementById("modelInput");
    if (input) input.value = "";
    document.getElementById("uploadZone")?.removeAttribute("hidden");

    updateTelemetry();
    if (!isCalculating) drawStaticScene();
}

function scrollToSim() {
    document
        .getElementById("simSection")
        ?.scrollIntoView({ behavior: "smooth" });
}

function initScrollReveal() {
    const reveals = document.querySelectorAll(".reveal-scroll");
    if (!reveals.length || prefersReducedMotion) {
        reveals.forEach((el) => el.classList.add("active"));
        return;
    }

    const checkVisibility = () => {
        const triggerBottom = window.innerHeight * 0.88;
        const triggerTop = -100;

        reveals.forEach((el) => {
            const rect = el.getBoundingClientRect();
            const visible =
                rect.top < triggerBottom && rect.bottom > triggerTop;
            el.classList.toggle("active", visible);
        });
    };

    window.addEventListener("scroll", checkVisibility, { passive: true });
    checkVisibility();
}

function initBackgroundWind() {
    bgCanvas = document.getElementById("bgWindCanvas");
    if (!bgCanvas || prefersReducedMotion) return;
    bgCtx = bgCanvas.getContext("2d");

    const generateSensorMatrix = () => {
        bgCanvas.width = window.innerWidth;
        bgCanvas.height = window.innerHeight;

        bgWindLines = [];
        const spacingX = 60;
        const spacingY = 60;

        for (let x = spacingX / 2; x < bgCanvas.width; x += spacingX) {
            for (let y = spacingY / 2; y < bgCanvas.height; y += spacingY) {
                bgWindLines.push({
                    baseX: x,
                    baseY: y,
                    x,
                    y,
                    currentAlpha: 0.09,
                    size: 5,
                });
            }
        }
    };

    generateSensorMatrix();

    let resizeTimer;
    window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(generateSensorMatrix, 150);
    });

    window.addEventListener(
        "scroll",
        () => {
            if (!isCalculating && ctx) drawStaticScene();
        },
        { passive: true },
    );

    window.addEventListener(
        "mousemove",
        (e) => {
            mouse.targetX = e.clientX;
            mouse.targetY = e.clientY;
        },
        { passive: true },
    );

    animateBackgroundWind();
}

function animateBackgroundWind() {
    if (!bgCtx || !bgCanvas) return;
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

    mouse.x += (mouse.targetX - mouse.x) * 0.08;
    mouse.y += (mouse.targetY - mouse.y) * 0.08;

    const totalDocHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
    );

    for (const node of bgWindLines) {
        const dx = mouse.x - node.baseX;
        const dy = mouse.y - node.baseY;
        const distance = Math.hypot(dx, dy);

        const maxRadius = 160;
        let targetX = node.baseX;
        let targetY = node.baseY;
        const baseAlpha = 0.09;
        let targetAlpha = baseAlpha;

        if (distance < maxRadius) {
            const force = (maxRadius - distance) / maxRadius;
            const pushAngle = Math.atan2(dy, dx);
            const pushDistance = force * 15;
            targetX = node.baseX - Math.cos(pushAngle) * pushDistance;
            targetY = node.baseY - Math.sin(pushAngle) * pushDistance;
            targetAlpha = baseAlpha + force * 0.22;
        }

        const absoluteY = node.baseY + window.scrollY;
        const bottomFadeZone = 400;
        if (totalDocHeight - absoluteY < bottomFadeZone) {
            const fadeFactor = Math.max(
                0,
                Math.min(1, (totalDocHeight - absoluteY) / bottomFadeZone),
            );
            targetAlpha *= fadeFactor;
        }

        node.x += (targetX - node.x) * 0.1;
        node.y += (targetY - node.y) * 0.1;
        node.currentAlpha += (targetAlpha - node.currentAlpha) * 0.1;

        if (node.currentAlpha <= 0) continue;

        bgCtx.save();
        bgCtx.strokeStyle = `rgba(0, 194, 255, ${node.currentAlpha})`;
        bgCtx.lineWidth = 1;
        bgCtx.beginPath();
        bgCtx.moveTo(node.x - node.size, node.y);
        bgCtx.lineTo(node.x + node.size, node.y);
        bgCtx.moveTo(node.x, node.y - node.size);
        bgCtx.lineTo(node.x, node.y + node.size);
        bgCtx.stroke();
        bgCtx.restore();
    }

    requestAnimationFrame(animateBackgroundWind);
}

function initObjectInteraction() {
    canvas.addEventListener("mousedown", (e) => {
        const p = getMousePos(e);
        const dist = Math.hypot(p.x - flowObject.x, p.y - flowObject.y);
        if (dist < flowObject.radius + 15) flowObject.isDragging = true;
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!flowObject.isDragging) return;
        const p = getMousePos(e);
        handleObjectMove(p.x, p.y);
    });

    window.addEventListener("mouseup", () => {
        flowObject.isDragging = false;
    });

    canvas.addEventListener(
        "touchstart",
        (e) => {
            if (!e.touches.length) return;
            const p = getTouchPos(e.touches[0]);
            const dist = Math.hypot(p.x - flowObject.x, p.y - flowObject.y);
            if (dist < flowObject.radius + 35) {
                flowObject.isDragging = true;
                e.preventDefault();
            }
        },
        { passive: false },
    );

    canvas.addEventListener(
        "touchmove",
        (e) => {
            if (!flowObject.isDragging || !e.touches.length) return;
            const p = getTouchPos(e.touches[0]);
            handleObjectMove(p.x, p.y);
            e.preventDefault();
        },
        { passive: false },
    );

    window.addEventListener("touchend", () => {
        flowObject.isDragging = false;
    });
}

function handleObjectMove(targetX, targetY) {
    flowObject.x = Math.max(
        flowObject.radius + 20,
        Math.min(canvas.width - flowObject.radius - 20, targetX),
    );
    flowObject.y = Math.max(
        flowObject.radius + 20,
        Math.min(canvas.height - flowObject.radius - 20, targetY),
    );

    updateTelemetry();
    if (!isCalculating) drawStaticScene();
}

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
}

function getTouchPos(touch) {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((touch.clientX - rect.left) / rect.width) * canvas.width,
        y: ((touch.clientY - rect.top) / rect.height) * canvas.height,
    };
}

function setViewMode(mode) {
    simParams.viewMode = mode;
    document
        .getElementById("modeParticles")
        ?.classList.toggle("active", mode === "particles");
    document
        .getElementById("modeLines")
        ?.classList.toggle("active", mode === "lines");

    if (!isCalculating) drawStaticScene();
}

function updateParams() {
    const speedInput = document.getElementById("inputSpeed");
    const densityInput = document.getElementById("inputDensity");

    simParams.speed = Number.parseFloat(speedInput.value);
    simParams.density = Number.parseInt(densityInput.value, 10);

    document.getElementById("valSpeed").textContent = speedInput.value;
    document.getElementById("valDensity").textContent = densityInput.value;

    speedInput.setAttribute("aria-valuenow", speedInput.value);
    densityInput.setAttribute("aria-valuenow", densityInput.value);

    updateTelemetry();
    if (!isCalculating) drawStaticScene();

    if (particles.length !== simParams.density) {
        generateParticles(simParams.density);
    }
}

function updateTelemetry() {
    if (serverFields?.stats) {
        document.getElementById("telCx").textContent =
            serverFields.stats.cx.toFixed(3);
        document.getElementById("telCy").textContent =
            serverFields.stats.cy.toFixed(3);
        document.getElementById("telTurb").textContent = `Re ${Math.round(
            serverFields.stats.reynolds,
        ).toLocaleString("ru-RU")}`;
        return;
    }

    let cx = 0.042;
    let cy = 0.84;
    let turb = "Минимальный";

    if (loadedModel.image) {
        const ratio = loadedModel.width / Math.max(loadedModel.height, 1);
        cx = 0.05 + (1 / (ratio + 0.5)) * 0.08;
        cy = ratio > 2 ? 0.65 : ratio > 1 ? 0.35 : 0.05;
        turb =
            ratio > 1.5
                ? "Минимальный (Ламинарный профиль)"
                : "Умеренный (Смешанный поток)";
    }

    cx += simParams.speed * 0.002;
    if (loadedModel.image && loadedModel.width > loadedModel.height) {
        cy += simParams.speed * 0.015;
    }

    document.getElementById("telCx").textContent = cx.toFixed(3);
    document.getElementById("telCy").textContent = cy.toFixed(3);
    document.getElementById("telTurb").textContent = turb;
}

function generateParticles(count) {
    particles = [];
    for (let i = 0; i < count; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            speedOffset: Math.random() * 2 - 1,
            alpha: Math.random() * 0.4 + 0.3,
            size: Math.random() * 1.5 + 1,
        });
    }
}

function drawServerFields() {
    if (!serverFields?.pressure) return;

    const field = serverFields.pressure;
    const res = field.length;
    const cellW = canvas.width / res;
    const cellH = (canvas.height - 140) / res;

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
            const v = field[y][x];
            const r = Math.floor(v * 255);
            const g = Math.floor((1 - Math.abs(v - 0.5) * 2) * 120);
            const b = Math.floor((1 - v) * 255);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
            ctx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1);
        }
    }

    ctx.restore();
}

function drawObject() {
    ctx.save();

    if (loadedModel.image) {
        const w = loadedModel.width;
        const h = loadedModel.height;
        ctx.drawImage(
            loadedModel.image,
            flowObject.x - w / 2,
            flowObject.y - h / 2,
            w,
            h,
        );
        ctx.strokeStyle = "#00C2FF";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(flowObject.x - w / 2, flowObject.y - h / 2, w, h);
        ctx.restore();
        return;
    }

    ctx.beginPath();
    const r = flowObject.radius;
    ctx.arc(flowObject.x, flowObject.y, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 82, 255, 0.08)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 194, 255, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function drawEmbeddedGraph() {
    ctx.save();

    const graphY = canvas.height - 70;
    const graphHeight = 45;
    const startX = 40;
    const endX = canvas.width - 40;
    const graphWidth = endX - startX;

    ctx.strokeStyle = "rgba(0, 194, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX, graphY);
    ctx.lineTo(endX, graphY);
    ctx.moveTo(startX, graphY - graphHeight);
    ctx.lineTo(endX, graphY - graphHeight);
    ctx.moveTo(startX, graphY + graphHeight);
    ctx.lineTo(endX, graphY + graphHeight);
    ctx.stroke();

    ctx.fillStyle = "#64748B";
    ctx.font = "10px sans-serif";
    ctx.fillText(
        "ЭПЮРА ДАВЛЕНИЯ (ИИ-ИНФЕРЕНС)",
        startX,
        graphY - graphHeight - 10,
    );
    ctx.fillText("-P (Разрежение)", endX - 100, graphY - graphHeight + 12);
    ctx.fillText("+P (Сжатие)", endX - 100, graphY + graphHeight - 4);

    if (serverFields?.pressure) {
        drawRealPressureCurve(startX, graphY, graphWidth);
    } else {
        drawSyntheticCurve(startX, graphY, graphWidth);
    }

    ctx.restore();
}

function drawRealPressureCurve(startX, graphY, graphWidth) {
    const field = serverFields.pressure;
    const res = field.length;
    const midRow = Math.floor(res / 2);

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#00C2FF";
    ctx.beginPath();
    for (let i = 0; i < res; i++) {
        const x = startX + (i / (res - 1)) * graphWidth;
        const y = graphY - (field[midRow][i] - 0.5) * 60;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    const midCol = Math.floor(res / 2);
    ctx.strokeStyle = "#FF5C00";
    ctx.beginPath();
    for (let i = 0; i < res; i++) {
        const x = startX + (i / (res - 1)) * graphWidth;
        const y = graphY + (field[i][midCol] - 0.5) * 60;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function drawSyntheticCurve(startX, graphY, graphWidth) {
    const amp = simParams.speed * 2.5;
    const time = performance.now() * 0.05;

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#00C2FF";
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const x = startX + t * graphWidth;
        let y = graphY;
        if (t < 0.3) {
            y += Math.sin((t * Math.PI) / 0.6) * amp * 0.8;
        } else {
            y -= amp * 0.5 + Math.sin(t * 30 + time) * (t - 0.3) * 4;
        }
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "#FF5C00";
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const x = startX + t * graphWidth;
        let y = graphY;
        if (t < 0.3) {
            y += Math.sin((t * Math.PI) / 0.6) * amp * 0.8;
        } else {
            y += amp * 0.5 - Math.sin(t * 30 + time) * (t - 0.3) * 4;
        }
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function getStreamlineY(startX, startY, currentX) {
    let currentY = startY;
    const step = 4;

    for (let x = startX; x < currentX; x += step) {
        const dx = flowObject.x - x;
        const dy = flowObject.y - currentY;
        const distance = Math.hypot(dx, dy);
        const influenceRadius = flowObject.radius + 40;

        if (distance < influenceRadius) {
            const force = (influenceRadius - distance) / influenceRadius;
            currentY += (dy > 0 ? 1.4 : -1.4) * force * (step * 0.5);

            if (x > flowObject.x) {
                currentY +=
                    Math.sin(x * 0.08 + performance.now() * 0.01) *
                    3 *
                    force *
                    0.5;
            }
        }
    }
    return currentY;
}

function drawStaticScene() {
    ctx.fillStyle = "#03070D";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(0, 194, 255, 0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    if (serverFields) drawServerFields();

    if (simParams.viewMode === "lines") {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(0, 194, 255, 0.25)";
        for (let y = 20; y < canvas.height - 140; y += 18) {
            ctx.beginPath();
            for (let x = 0; x < canvas.width; x += 10) {
                const drawY = getStreamlineY(0, y, x);
                x === 0 ? ctx.moveTo(x, drawY) : ctx.lineTo(x, drawY);
            }
            ctx.stroke();
        }
    }

    drawObject();
    drawEmbeddedGraph();
}

function runSimulation() {
    if (isCalculating) return;
    isCalculating = true;

    const statusBadge = document.getElementById("simStatus");
    statusBadge.innerHTML =
        '<span class="pulse-dot active" aria-hidden="true"></span> СТАТУС: ИНФЕРЕНС ПОТОКА (LIVE)';
    statusBadge.style.color = "#10b981";
    document.getElementById("startBtn").disabled = true;

    const animate = () => {
        if (simParams.viewMode === "particles") {
            ctx.fillStyle = "rgba(3, 7, 13, 0.16)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            if (serverFields) drawServerFields();

            for (const p of particles) {
                const dx = flowObject.x - p.x;
                const dy = flowObject.y - p.y;
                const distance = Math.hypot(dx, dy);
                let currentSpeed = simParams.speed + p.speedOffset;
                const influenceRadius = flowObject.radius + 40;

                if (distance < influenceRadius && distance > 0) {
                    const force =
                        (influenceRadius - distance) / influenceRadius;
                    let edgeFade = 1;
                    if (flowObject.y < 80)
                        edgeFade = Math.max(0.1, flowObject.y / 80);
                    else if (flowObject.y > canvas.height - 150)
                        edgeFade = Math.max(
                            0.1,
                            (canvas.height - 150 - flowObject.y) / 80,
                        );

                    p.y +=
                        Math.tanh(
                            (dy > 0 ? 1.4 : -1.4) * force * 4 * edgeFade,
                        ) * 2.5;
                }

                if (p.x > flowObject.x && p.x < flowObject.x + 350) {
                    const trailLength = p.x - flowObject.x;
                    const verticalDist = Math.abs(p.y - flowObject.y);
                    if (verticalDist < flowObject.radius + 30) {
                        const vortexForce = (350 - trailLength) / 350;
                        if (vortexForce > 0) {
                            const timeScale = performance.now() * 0.012;
                            let edgeFadeVortex = 1;
                            if (flowObject.y < 60)
                                edgeFadeVortex = flowObject.y / 60;
                            if (flowObject.y > canvas.height - 130)
                                edgeFadeVortex =
                                    (canvas.height - 130 - flowObject.y) / 60;
                            edgeFadeVortex = Math.max(0.2, edgeFadeVortex);

                            p.y +=
                                Math.sin(p.x * 0.05 - timeScale) *
                                8 *
                                vortexForce *
                                0.3 *
                                edgeFadeVortex;
                            currentSpeed -= 1.2 * vortexForce;
                        }
                    }
                }

                p.x += currentSpeed;

                let particleAlpha = p.alpha;
                if (p.x > canvas.width - 60)
                    particleAlpha *= (canvas.width - p.x) / 60;
                if (p.x < 40) particleAlpha *= p.x / 40;

                if (p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
                    p.x = -Math.random() * 50;
                    p.y = Math.random() * (canvas.height - 140) + 10;
                }

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);

                if (
                    distance < influenceRadius + 15 &&
                    p.x < flowObject.x + 10
                ) {
                    ctx.fillStyle = `rgba(0, 194, 255, ${Math.max(0, particleAlpha + 0.55)})`;
                } else {
                    ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, particleAlpha)})`;
                }
                ctx.fill();
            }
        } else {
            ctx.fillStyle = "#03070D";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (serverFields) drawServerFields();
            ctx.lineWidth = 1.8;
            for (let y = 20; y < canvas.height - 140; y += 18) {
                const gradient = ctx.createLinearGradient(
                    0,
                    0,
                    canvas.width,
                    0,
                );
                gradient.addColorStop(0, "rgba(0, 194, 255, 0.4)");
                gradient.addColorStop(0.5, "rgba(0, 194, 255, 0.6)");
                gradient.addColorStop(1, "rgba(0, 82, 255, 0.1)");
                ctx.strokeStyle = gradient;
                ctx.beginPath();
                for (let x = 0; x < canvas.width; x += 8) {
                    const drawY = getStreamlineY(0, y, x);
                    x === 0 ? ctx.moveTo(x, drawY) : ctx.lineTo(x, drawY);
                }
                ctx.stroke();
            }
        }

        drawObject();
        drawEmbeddedGraph();
        animationFrameId = requestAnimationFrame(animate);
    };

    animate();
}

function resetSimulation() {
    isCalculating = false;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);

    const statusBadge = document.getElementById("simStatus");
    statusBadge.innerHTML =
        '<span class="pulse-dot" aria-hidden="true"></span> СТАТУС: ТЕРМИНАЛ ГОТОВ';
    statusBadge.style.color = "";
    document.getElementById("startBtn").disabled = false;

    generateParticles(simParams.density);
    drawStaticScene();
}

window.scrollToSim = scrollToSim;
window.runSimulation = runSimulation;
window.resetSimulation = resetSimulation;
window.setViewMode = setViewMode;
window.updateParams = updateParams;
