// Глобальные переменные терминала симулятора
let canvas, ctx;
let animationFrameId = null;
let isCalculating = false;
let particles = [];

// Переменные для КРАСИВОГО ИНТЕРАКТИВНОГО ФОНА ВЕТРА по всему сайту
let bgCanvas, bgCtx;
let bgWindLines = [];
let mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000 };

// Контроллер физических параметров ИИ-среды
let simParams = {
    speed: 6,
    density: 160,
    type: "wing",
    viewMode: "particles",
};

// Координаты и свойства исследуемой геометрии крыла/сферы/квадрата
let flowObject = {
    x: 0,
    y: 0,
    radius: 55,
    isDragging: false,
};

// Главная точка входа после полной загрузки DOM-дерева
window.addEventListener("DOMContentLoaded", () => {
    canvas = document.getElementById("aeroCanvas");

    if (canvas) {
        ctx = canvas.getContext("2d");

        // ЖЕСТКАЯ ФИКСАЦИЯ: Задаем внутреннее разрешение матрицы холста.
        // CSS растянет его под размер экрана, сохраняя геометрию неизменной.
        canvas.width = 800;
        canvas.height = 450;

        // Помещаем объект строго по центру трубы на основе фиксированных координат
        flowObject.x = canvas.width / 2.5;
        flowObject.y = canvas.height / 2.2;

        generateParticles(simParams.density);
        drawStaticScene();
        initObjectInteraction();
    }

    // ЗАПУСК КРАСИВОГО ЖИВОГО ФОНА МАТРИЦЫ ДАТЧИКОВ НА ВСЕМ САЙТЕ
    initBackgroundWind();

    // Запуск трекера циклического проявления HUD-карточек при скролле
    initScrollReveal();
});

// Плавная прокрутка экрана к терминалу инференса
function scrollToSim() {
    const target = document.getElementById("simSection");
    if (target) target.scrollIntoView({ behavior: "smooth" });
}

// Анимация проявления HUD-карточек: выезжают каждый раз при прокрутке
function initScrollReveal() {
    const reveals = document.querySelectorAll(".reveal-scroll");

    const checkVisibility = () => {
        const triggerBottom = window.innerHeight * 0.88;
        const triggerTop = -100;

        reveals.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.top < triggerBottom && rect.bottom > triggerTop) {
                el.classList.add("active");
            } else {
                el.classList.remove("active"); // Сбрасываем, чтобы выкатывались снова
            }
        });
    };

    window.addEventListener("scroll", checkVisibility);
    checkVisibility();
}

// Инициализация фоновой матрицы датчиков с привязкой к скроллу страницы
function initBackgroundWind() {
    bgCanvas = document.getElementById("bgWindCanvas");
    if (!bgCanvas) return;
    bgCtx = bgCanvas.getContext("2d");

    const generateSensorMatrix = () => {
        bgCanvas.width = window.innerWidth;
        bgCanvas.height = window.innerHeight;

        bgWindLines = [];
        const spacingX = 60; // Шаг сетки по горизонтали
        const spacingY = 60; // Шаг сетки по вертикали

        for (let x = spacingX / 2; x < bgCanvas.width; x += spacingX) {
            for (let y = spacingY / 2; y < bgCanvas.height; y += spacingY) {
                bgWindLines.push({
                    baseX: x,
                    baseY: y,
                    x: x,
                    y: y,
                    currentAlpha: 0.09 /* Заметные матовые крестики в покое */,
                    size: 5 /* Размах крестика 10px */,
                });
            }
        }
    };

    generateSensorMatrix();
    window.addEventListener("resize", generateSensorMatrix);

    window.addEventListener("scroll", () => {
        if (!isCalculating && ctx) {
            drawStaticScene();
        }
    });

    window.addEventListener("mousemove", (e) => {
        mouse.targetX = e.clientX;
        mouse.targetY = e.clientY;
    });

    animateBackgroundWind();
}
// Анимационный цикл матрицы датчиков с мягким затуханием перед футером
function animateBackgroundWind() {
    if (!bgCtx || !bgCanvas) return;
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);

    mouse.x += (mouse.targetX - mouse.x) * 0.08;
    mouse.y += (mouse.targetY - mouse.y) * 0.08;

    const totalDocHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
    );

    bgWindLines.forEach((node) => {
        let dx = mouse.x - node.baseX;
        let dy = mouse.y - node.baseY;
        let distance = Math.hypot(dx, dy);

        let maxRadius = 160;
        let targetX = node.baseX;
        let targetY = node.baseY;
        let baseAlpha = 0.09;
        let targetAlpha = baseAlpha;

        if (distance < maxRadius) {
            let force = (maxRadius - distance) / maxRadius;
            let pushAngle = Math.atan2(dy, dx);

            let pushDistance = force * 15;
            targetX = node.baseX - Math.cos(pushAngle) * pushDistance;
            targetY = node.baseY - Math.sin(pushAngle) * pushDistance;

            targetAlpha = baseAlpha + force * 0.22;
        }

        const absoluteY = node.baseY + window.scrollY;

        // Плавное растворение сетки за 400 пикселей до самого низа сайта (перед футером)
        let bottomFadeZone = 400;
        if (totalDocHeight - absoluteY < bottomFadeZone) {
            let fadeFactor = (totalDocHeight - absoluteY) / bottomFadeZone;
            fadeFactor = Math.max(0, Math.min(1, fadeFactor));
            targetAlpha *= fadeFactor;
        }

        node.x += (targetX - node.x) * 0.1;
        node.y += (targetY - node.y) * 0.1;
        node.currentAlpha += (targetAlpha - node.currentAlpha) * 0.1;

        if (node.currentAlpha <= 0) return;

        bgCtx.save();
        bgCtx.strokeStyle = `rgba(0, 194, 255, ${node.currentAlpha})`;
        bgCtx.lineWidth = 1.0;
        bgCtx.beginPath();

        bgCtx.moveTo(node.x - node.size, node.y);
        bgCtx.lineTo(node.x + node.size, node.y);

        bgCtx.moveTo(node.x, node.y - node.size);
        bgCtx.lineTo(node.x, node.y + node.size);

        bgCtx.stroke();
        bgCtx.restore();
    });

    requestAnimationFrame(animateBackgroundWind);
}

// --- ИНТЕРАКТИВ: Плавный Drag-and-Drop объекта с учетом масштаба экрана смартфона ---
function initObjectInteraction() {
    canvas.addEventListener("mousedown", (e) => {
        const mousePos = getMousePos(e);
        const dist = Math.hypot(
            mousePos.x - flowObject.x,
            mousePos.y - flowObject.y,
        );
        if (dist < flowObject.radius + 15) flowObject.isDragging = true;
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!flowObject.isDragging) return;
        const mousePos = getMousePos(e);
        handleObjectMove(mousePos.x, mousePos.y);
    });

    window.addEventListener("mouseup", () => {
        flowObject.isDragging = false;
    });

    // ТОЧНЫЙ ТАЧ-ИНТЕРФЕЙС ДЛЯ СМАРТФОНОВ И ПЛАНШЕТОВ
    canvas.addEventListener(
        "touchstart",
        (e) => {
            if (e.touches.length === 0) return;
            const touchPos = getTouchPos(e.touches[0]);
            const dist = Math.hypot(
                touchPos.x - flowObject.x,
                touchPos.y - flowObject.y,
            );
            if (dist < flowObject.radius + 35) {
                // Увеличенная зона захвата под палец
                flowObject.isDragging = true;
                e.preventDefault();
            }
        },
        { passive: false },
    );

    canvas.addEventListener(
        "touchmove",
        (e) => {
            if (!flowObject.isDragging || e.touches.length === 0) return;
            const touchPos = getTouchPos(e.touches[0]);
            handleObjectMove(touchPos.x, touchPos.y);
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

function setObjectType(type) {
    simParams.type = type;
    document
        .getElementById("typeWing")
        .classList.toggle("active", type === "wing");
    document
        .getElementById("typeCircle")
        .classList.toggle("active", type === "circle");
    document
        .getElementById("typeSquare")
        .classList.toggle("active", type === "square");
    document
        .getElementById("typeDrop")
        .classList.toggle("active", type === "drop");
    document
        .getElementById("typeTriangle")
        .classList.toggle("active", type === "triangle");

    updateTelemetry();
    if (!isCalculating) drawStaticScene();
}

function setViewMode(mode) {
    simParams.viewMode = mode;
    document
        .getElementById("modeParticles")
        .classList.toggle("active", mode === "particles");
    document
        .getElementById("modeLines")
        .classList.toggle("active", mode === "lines");

    if (!isCalculating) drawStaticScene();
}

function updateParams() {
    const speedInput = document.getElementById("inputSpeed").value;
    const densityInput = document.getElementById("inputDensity").value;

    simParams.speed = parseFloat(speedInput);
    simParams.density = parseInt(densityInput);

    document.getElementById("valSpeed").innerText = speedInput;
    document.getElementById("valDensity").innerText = densityInput;

    updateTelemetry();

    if (!isCalculating) drawStaticScene();

    if (particles.length !== simParams.density) {
        generateParticles(simParams.density);
    }
}

function updateTelemetry() {
    let cx = 0.042;
    let cy = 0.84;
    let turb = "Минимальный";

    switch (simParams.type) {
        case "circle":
            cx = 0.47;
            cy = 0.0;
            turb = "Высокий (Срыв потока)";
            break;
        case "square":
            cx = 1.05;
            cy = 0.0;
            turb = "Критический (Мгновенный срыв)";
            break;
        case "drop":
            cx = 0.015;
            cy = 0.12;
            turb = "Отсутствует (Ламинарный поток)";
            break;
        case "triangle":
            cx = 0.28;
            cy = 0.31;
            turb = "Умеренный (Донное разрежение)";
            break;
        default:
            cx = 0.042;
            cy = 0.84;
            turb = "Минимальный";
    }

    cx += simParams.speed * 0.002;
    if (simParams.type === "wing") cy += simParams.speed * 0.015;

    if (
        flowObject.y < canvas.height * 0.25 ||
        flowObject.y > canvas.height * 0.75
    ) {
        cx *= 1.2;
        if (simParams.type === "wing") {
            cy *= 1.35;
            turb = "Умеренный (Экранный эффект)";
        }
    }

    document.getElementById("telCx").innerText = cx.toFixed(3);
    document.getElementById("telCy").innerText = cy.toFixed(3);
    document.getElementById("telTurb").innerText = turb;
}
// Генерация начального массива воздушных частиц
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

// Отрисовка исследуемого объекта плотным синим цветом в CAD-стиле
function drawObject() {
    ctx.save();
    ctx.beginPath();

    const r = flowObject.radius;

    switch (simParams.type) {
        case "circle":
            ctx.arc(flowObject.x, flowObject.y, r, 0, Math.PI * 2);
            break;
        case "square":
            ctx.rect(flowObject.x - r, flowObject.y - r, r * 2, r * 2);
            break;
        case "drop":
            ctx.moveTo(flowObject.x - r, flowObject.y);
            ctx.bezierCurveTo(
                flowObject.x - r * 0.4,
                flowObject.y - r * 0.9,
                flowObject.x + r * 0.2,
                flowObject.y - r * 0.7,
                flowObject.x + r * 1.3,
                flowObject.y,
            );
            ctx.bezierCurveTo(
                flowObject.x + r * 0.2,
                flowObject.y + r * 0.7,
                flowObject.x - r * 0.4,
                flowObject.y + r * 0.9,
                flowObject.x - r,
                flowObject.y,
            );
            break;
        case "triangle":
            ctx.moveTo(flowObject.x - r, flowObject.y);
            ctx.lineTo(flowObject.x + r, flowObject.y - r * 0.7);
            ctx.lineTo(flowObject.x + r, flowObject.y + r * 0.7);
            break;
        default: // 'wing'
            ctx.moveTo(flowObject.x - r, flowObject.y);
            ctx.bezierCurveTo(
                flowObject.x - r / 2,
                flowObject.y - r * 0.9,
                flowObject.x + r,
                flowObject.y - r / 3,
                flowObject.x + r * 1.2,
                flowObject.y,
            );
            ctx.bezierCurveTo(
                flowObject.x + r,
                flowObject.y + r / 3,
                flowObject.x - r / 2,
                flowObject.y + r * 0.9,
                flowObject.x - r,
                flowObject.y,
            );
    }

    ctx.closePath();

    // Плотная ярко-синяя заливка без градиентов и серости
    ctx.fillStyle = "#0052FF";
    ctx.fill();

    // Четкий неоново-голубой контур для идеальной видимости границ
    ctx.strokeStyle = "#00C2FF";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.restore();
}

// Отрисовка встроенного неонового графика (эпюры) давлений внизу холста
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

    const amp = simParams.speed * 2.5;
    const objectYRatio = flowObject.y / canvas.height - 0.5;

    ctx.lineWidth = 2.5;

    // Линия 1: Верхняя кромка (Неоново-голубая)
    ctx.strokeStyle = "#00C2FF";
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const x = startX + t * graphWidth;
        let y = graphY;

        if (simParams.type === "wing" || simParams.type === "drop") {
            y -=
                Math.sin(t * Math.PI) * amp * 1.5 * (1 - t * 0.6) -
                objectYRatio * 15;
        } else {
            if (t < 0.3) {
                y += Math.sin((t * Math.PI) / 0.6) * amp * 0.8;
            } else {
                y -=
                    amp * 0.5 +
                    Math.sin(t * 30 + Date.now() * 0.05) * (t - 0.3) * 4;
            }
        }
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Линия 2: Нижняя кромка / Срыв (Оранжевая)
    ctx.strokeStyle = "#FF5C00";
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        const x = startX + t * graphWidth;
        let y = graphY;

        if (simParams.type === "wing" || simParams.type === "drop") {
            y +=
                Math.sin(t * Math.PI) * amp * 0.4 * (1 - t * 0.8) +
                objectYRatio * 15;
        } else {
            if (t < 0.3) {
                y += Math.sin((t * Math.PI) / 0.6) * amp * 0.8;
            } else {
                y +=
                    amp * 0.5 -
                    Math.sin(t * 30 + Date.now() * 0.05) * (t - 0.3) * 4;
            }
        }
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.restore();
}
// Математика обтекания нитей ламинарного воздуха (Линии тока)
function getStreamlineY(startX, startY, currentX) {
    let currentY = startY;
    let step = 4;

    for (let x = startX; x < currentX; x += step) {
        let dx = flowObject.x - x;
        let dy = flowObject.y - currentY;
        let distance = Math.hypot(dx, dy);
        let influenceRadius = flowObject.radius + 40;

        if (distance < influenceRadius) {
            let force = (influenceRadius - distance) / influenceRadius;

            if (simParams.type === "wing" || simParams.type === "drop") {
                currentY += (dy > 0 ? 1.6 : -0.6) * force * (step * 0.4);
            } else if (simParams.type === "square") {
                currentY += (dy > 0 ? 1.9 : -1.9) * force * (step * 0.5);
            } else {
                currentY += (dy > 0 ? 1.2 : -1.2) * force * (step * 0.5);
                if (x > flowObject.x) {
                    currentY +=
                        Math.sin(x * 0.08 + Date.now() * 0.01) *
                        3 *
                        force *
                        0.5;
                }
            }
        }
    }
    return currentY;
}

// Сетка и сцена в режиме паузы
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

    if (simParams.viewMode === "lines") {
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(0, 194, 255, 0.25)";
        for (let y = 20; y < canvas.height - 140; y += 18) {
            ctx.beginPath();
            for (let x = 0; x < canvas.width; x += 10) {
                let drawY = getStreamlineY(0, y, x);
                if (x === 0) ctx.moveTo(x, drawY);
                else ctx.lineTo(x, drawY);
            }
            ctx.stroke();
        }
    }

    drawObject();
    drawEmbeddedGraph();
}

// Главный цикл непрерывной анимации с вихревым следом и стабилизацией краев
function runSimulation() {
    if (isCalculating) return;
    isCalculating = true;

    const statusBadge = document.getElementById("simStatus");
    statusBadge.innerHTML =
        '<div class="pulse-dot active"></div> СТАТУС: ИНФЕРЕНС ПОТОКА (LIVE)';
    statusBadge.style.color = "#10b981";
    document.getElementById("startBtn").disabled = true;

    function animate() {
        if (simParams.viewMode === "particles") {
            ctx.fillStyle = "rgba(3, 7, 13, 0.16)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            particles.forEach((p) => {
                let dx = flowObject.x - p.x;
                let dy = flowObject.y - p.y;
                let distance = Math.hypot(dx, dy);
                let currentSpeed = simParams.speed + p.speedOffset;
                let influenceRadius = flowObject.radius + 40;

                // Физика обтекания контуров
                if (distance < influenceRadius && distance > 0) {
                    let force = (influenceRadius - distance) / influenceRadius;
                    let edgeFade = 1.0;
                    if (flowObject.y < 80)
                        edgeFade = Math.max(0.1, flowObject.y / 80);
                    else if (flowObject.y > canvas.height - 150)
                        edgeFade = Math.max(
                            0.1,
                            (canvas.height - 150 - flowObject.y) / 80,
                        );

                    if (
                        simParams.type === "wing" ||
                        simParams.type === "drop"
                    ) {
                        let wingForceY =
                            (dy > 0 ? 1.6 : -0.6) * force * 3 * edgeFade;
                        p.y += Math.tanh(wingForceY) * 2;
                        currentSpeed += 1.5 * force;
                    } else if (simParams.type === "square") {
                        let sqForceY =
                            (dy > 0 ? 1.9 : -1.9) * force * 4 * edgeFade;
                        p.y += Math.tanh(sqForceY) * 2;
                    } else {
                        let circleForceY =
                            (dy > 0 ? 1.2 : -1.2) * force * 4 * edgeFade;
                        p.y += Math.tanh(circleForceY) * 2.5;
                    }
                }

                // Вихревая дорожка за телами
                if (p.x > flowObject.x && p.x < flowObject.x + 350) {
                    let trailLength = p.x - flowObject.x;
                    let verticalDist = Math.abs(p.y - flowObject.y);

                    if (verticalDist < flowObject.radius + 30) {
                        let vortexForce = (350 - trailLength) / 350;
                        if (vortexForce > 0) {
                            let frequency = 0.05;
                            let timeScale = Date.now() * 0.012;
                            let amplitude =
                                simParams.type === "circle" ||
                                simParams.type === "square"
                                    ? 14
                                    : 6;

                            let edgeFadeVortex = 1.0;
                            if (flowObject.y < 60)
                                edgeFadeVortex = flowObject.y / 60;
                            if (flowObject.y > canvas.height - 130)
                                edgeFadeVortex =
                                    (canvas.height - 130 - flowObject.y) / 60;
                            edgeFadeVortex = Math.max(0.2, edgeFadeVortex);

                            p.y +=
                                Math.sin(p.x * frequency - timeScale) *
                                amplitude *
                                vortexForce *
                                0.3 *
                                edgeFadeVortex;
                            currentSpeed -= 1.2 * vortexForce;
                        }
                    }
                }

                p.x += currentSpeed;

                // Плавные границы респавна
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
            });
        } else {
            // Линии тока
            ctx.fillStyle = "#03070D";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.lineWidth = 1.8;
            for (let y = 20; y < canvas.height - 140; y += 18) {
                let gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
                gradient.addColorStop(0, "rgba(0, 194, 255, 0.4)");
                gradient.addColorStop(0.5, "rgba(0, 194, 255, 0.6)");
                gradient.addColorStop(1, "rgba(0, 82, 255, 0.1)");
                ctx.strokeStyle = gradient;
                ctx.beginPath();
                for (let x = 0; x < canvas.width; x += 8) {
                    let drawY = getStreamlineY(0, y, x);
                    if (x === 0) ctx.moveTo(x, drawY);
                    else ctx.lineTo(x, drawY);
                }
                ctx.stroke();
            }
        }

        drawObject();
        drawEmbeddedGraph();
        animationFrameId = requestAnimationFrame(animate);
    }
    animate();
}

// Остановка симуляции
function resetSimulation() {
    isCalculating = false;
    cancelAnimationFrame(animationFrameId);
    const statusBadge = document.getElementById("simStatus");
    statusBadge.innerHTML =
        '<div class="pulse-dot"></div> СТАТУС: ТЕРМИНАЛ ГОТОВ';
    statusBadge.style.color = "";
    document.getElementById("startBtn").disabled = false;
    generateParticles(simParams.density);
    drawStaticScene();
}
