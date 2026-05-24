const form = document.querySelector("#scanForm");
const urlInput = document.querySelector("#urlInput");
const modeInputs = document.querySelectorAll('input[name="mode"]');
const activeChecks = document.querySelector("#activeChecks");
const activeReportHead = document.querySelector("#activeReportHead");
const reportTitle = document.querySelector("#reportTitle");
const reportIntro = document.querySelector("#reportIntro");
const reportModeButtons = document.querySelectorAll("[data-report-mode]");
const resultStory = document.querySelector("#resultStory");
const fineValue = document.querySelector("#fineValue");
const totalCount = document.querySelector("#totalCount");
const accessState = document.querySelector("#accessState");
const serviceGrid = document.querySelector("#serviceGrid");
const notice = document.querySelector("#notice");
const copySummary = document.querySelector("#copySummary");
const leadDialog = document.querySelector("#leadDialog");
const leadPackage = document.querySelector("#leadPackage");
const leadComment = document.querySelector("#leadComment");
const leadTitle = document.querySelector("#leadTitle");
const payDialog = document.querySelector("#payDialog");
const openPayDialog = document.querySelector("#openPayDialog");
const unlockPaid = document.querySelector("#unlockPaid");
const diagnosticLog = document.querySelector("#diagnosticLog");
const previewScore = document.querySelector("#previewScore");

const LOCKED_COUNT = 10;

let lastAudit = null;
let selectedPackage = null;
let selectedMode = "legal";
let paidUnlocked = false;
let progressTimer = null;

const statusLabels = {
  passed: "ОК",
  failed: "Риск",
  review: "Проверить"
};

const severityLabels = {
  low: "низкий",
  medium: "средний",
  high: "важный"
};

const diagnosticMessages = [
  "Подключаемся к сайту...",
  "Считываем HTML и служебные файлы...",
  "Проверяем документы и формы...",
  "Смотрим рекламные и cookie-сценарии...",
  "Проверяем SEO-базу...",
  "Собираем понятный отчёт..."
];

const defaultServices = [
  {
    id: "consult",
    title: "Поможем разобраться",
    price: "бесплатно",
    tag: "консультация",
    description: "Спишемся в мессенджере, обсудим нарушения и подскажем, что можно сделать самостоятельно.",
    items: ["Разбор результата", "Приоритеты исправлений", "Ответы на вопросы", "План следующих действий"],
    active: true
  },
  {
    id: "audit",
    title: "Технический аудит сайта",
    price: "от 10 000 ₽",
    tag: "документы",
    description: "Исправляем нарушения: документы, формы, cookie, реквизиты и технические ошибки.",
    items: ["Политика ПДн", "Согласия у форм", "Cookie-сценарии", "Реквизиты", "Повторная проверка"],
    active: false
  },
  {
    id: "seo",
    title: "SEO-оптимизация сайта",
    price: "от 10 000 ₽",
    tag: "SEO",
    description: "Исправляем всё, что мешает сайту получать больше клиентов из поиска.",
    items: ["Title и description", "Структура H1/H2", "Alt изображений", "robots и sitemap", "Скорость"],
    active: false
  }
];

const formatRub = (value) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(value || 0);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSelectedMode() {
  return document.querySelector('input[name="mode"]:checked')?.value || selectedMode;
}

function setSelectedMode(mode) {
  selectedMode = mode === "seo" ? "seo" : "legal";

  document.querySelectorAll(`[name="mode"][value="${selectedMode}"]`).forEach((input) => {
    input.checked = true;
  });

  document.querySelectorAll("[data-select-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.selectMode === selectedMode);
  });

  reportModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.reportMode === selectedMode);
  });

  renderActiveReport();
}

function modeTitle(mode) {
  return mode === "seo" ? "SEO-проверка" : "Юридическая проверка";
}

function sortedChecks() {
  if (!lastAudit) return [];
  return [...lastAudit.checks].sort((a, b) => {
    if (a.group === selectedMode && b.group !== selectedMode) return -1;
    if (a.group !== selectedMode && b.group === selectedMode) return 1;
    if (a.status === "failed" && b.status !== "failed") return -1;
    if (a.status !== "failed" && b.status === "failed") return 1;
    if (a.status === "review" && b.status === "passed") return -1;
    if (a.status === "passed" && b.status === "review") return 1;
    return 0;
  });
}

function setLoading(isLoading) {
  const button = form.querySelector("button[type='submit']");
  button.disabled = isLoading;
  button.querySelector("span").textContent = isLoading ? "Проверяем..." : "Проверить нарушения";
}

function startDiagnosticAnimation() {
  clearInterval(progressTimer);
  let step = 0;
  previewScore.textContent = "0%";
  diagnosticLog.textContent = diagnosticMessages[0];

  progressTimer = setInterval(() => {
    step = Math.min(step + 1, diagnosticMessages.length - 1);
    const value = Math.round((step / (diagnosticMessages.length - 1)) * 96);
    previewScore.textContent = `${value}%`;
    diagnosticLog.textContent = diagnosticMessages[step];
    if (step >= diagnosticMessages.length - 1) clearInterval(progressTimer);
  }, 420);
}

function finishDiagnosticAnimation() {
  clearInterval(progressTimer);
  previewScore.textContent = "100%";
  diagnosticLog.textContent = "Готово: отчёт собран.";
}

function renderCheck(check, index) {
  const passed = check.status === "passed";
  const review = check.status === "review";
  const group = check.group === "seo" ? "SEO" : "Право";
  const meta = [`${group}`, `приоритет: ${severityLabels[check.severity] || check.severity}`];
  if (check.law) meta.push(check.law);

  return `
    <article class="check-item ${passed ? "passed" : review ? "review" : "failed"}">
      <div class="check-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="check-body">
        <div class="check-top">
          <strong>${escapeHtml(check.title)}</strong>
          <span class="status-pill ${passed ? "passed" : review ? "review" : "failed"}">
            ${statusLabels[check.status] || "Риск"}
          </span>
        </div>
        <p><b>Что видно:</b> ${escapeHtml(check.evidence)}</p>
        ${
          check.fineMax
            ? `<div class="fine-badge">Возможный риск до ${formatRub(check.fineMax)}</div>`
            : ""
        }
        ${passed ? "" : `<p class="fix-line"><b>${review ? "Что проверить" : "Что сделать"}:</b> ${escapeHtml(check.fix)}</p>`}
        <div class="check-meta">
          ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderLockedCheck(check, index) {
  return `
    <article class="check-item locked-check">
      <div class="check-index">${String(index + 1).padStart(2, "0")}</div>
      <div class="check-body">
        <div class="check-top">
          <strong>${escapeHtml(check.title)}</strong>
          <span class="status-pill locked">закрыто</span>
        </div>
        <p>Этот пункт входит в расширенную диагностику. Откройте доступ, чтобы увидеть детали и рекомендацию.</p>
      </div>
    </article>
  `;
}

function renderActiveReport() {
  const title = modeTitle(selectedMode);
  activeReportHead.innerHTML = `<span class="dot ${selectedMode}"></span><h3>${title}: результат</h3>`;

  if (!lastAudit) {
    reportTitle.textContent = "Запустите проверку, чтобы увидеть результат";
    reportIntro.textContent =
      "Бесплатно покажем основную часть результата. Последние 10 пунктов расширенной диагностики открываются за 179 ₽.";
    resultStory.textContent = "Ожидаем проверку";
    fineValue.textContent = "—";
    totalCount.textContent = "—";
    accessState.textContent = "Бесплатный";
    activeChecks.innerHTML = `<div class="empty-state">Введите ссылку сайта и запустите проверку.</div>`;
    return;
  }

  const checks = sortedChecks();
  const freeCount = Math.max(checks.length - LOCKED_COUNT, 0);
  const visibleChecks = paidUnlocked ? checks : checks.slice(0, freeCount);
  const lockedChecks = paidUnlocked ? [] : checks.slice(freeCount);
  const failed = checks.filter((check) => check.status === "failed");
  const review = checks.filter((check) => check.status === "review");
  const fine = failed.reduce((sum, check) => sum + (check.fineMax || 0), 0);

  reportTitle.textContent = `${title}: нашли ${failed.length + review.length} пунктов для внимания`;
  reportIntro.textContent = paidUnlocked
    ? "Полный доступ открыт. Ниже все пункты диагностики с объяснениями и рекомендациями."
    : `Бесплатно открыто ${visibleChecks.length} пунктов. Последние ${lockedChecks.length} пунктов можно открыть за 179 ₽.`;
  resultStory.textContent = failed.length
    ? `Найдено ${failed.length} рисков`
    : review.length
      ? `Нужно проверить ${review.length} пункта`
      : "Критичных проблем не найдено";
  fineValue.textContent = fine ? `до ${formatRub(fine)}` : "0 ₽";
  totalCount.textContent = `${visibleChecks.length}/${checks.length}`;
  accessState.textContent = paidUnlocked ? "Полный" : "Бесплатный";

  activeChecks.innerHTML = [
    ...visibleChecks.map(renderCheck),
    ...lockedChecks.map(renderLockedCheck),
    lockedChecks.length
      ? `<div class="locked-banner">
          <strong>Осталось ${lockedChecks.length} закрытых пунктов</strong>
          <span>Расширенная диагностика стоит 179 ₽ и открывается сразу.</span>
          <button class="dark-button" type="button" data-open-payment>Открыть полный отчёт</button>
        </div>`
      : ""
  ].join("");

  activeChecks.querySelectorAll("[data-open-payment]").forEach((button) => {
    button.addEventListener("click", () => payDialog.showModal());
  });
}

function renderServices(services = defaultServices) {
  serviceGrid.innerHTML = services
    .slice(0, 3)
    .map(
      (service) => `
        <article class="service-card reveal ${service.active ? "active" : ""}">
          <span class="neutral-pill">${escapeHtml(service.tag)}</span>
          <h3>${escapeHtml(service.title)}</h3>
          <p>${escapeHtml(service.description)}</p>
          <details>
            <summary>Показать подробнее</summary>
            <ul>
              ${(service.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          </details>
          <div class="service-bottom">
            <strong>${escapeHtml(service.price)}</strong>
            <button class="soft-button" type="button" data-package="${escapeHtml(service.id)}">
              Узнать точную стоимость
            </button>
          </div>
        </article>
      `
    )
    .join("");

  serviceGrid.querySelectorAll("[data-package]").forEach((button) => {
    button.addEventListener("click", () => {
      const service = services.find((item) => item.id === button.dataset.package) || null;
      openLead(service);
    });
  });

  observeReveals();
}

function renderAudit(audit) {
  lastAudit = audit;
  paidUnlocked = false;
  renderActiveReport();
  renderServices(defaultServices);

  if (audit.warning) {
    notice.hidden = false;
    notice.textContent = audit.warning;
  } else {
    notice.hidden = true;
    notice.textContent = "";
  }
}

function renderError(message) {
  notice.hidden = false;
  notice.textContent = message;
}

async function runAudit(event) {
  event?.preventDefault();
  selectedMode = getSelectedMode();
  paidUnlocked = false;
  setSelectedMode(selectedMode);
  setLoading(true);
  startDiagnosticAnimation();
  renderError("Проверяем сайт и собираем диагностику...");

  const formData = new FormData(form);
  const profile = formData.get("profile") || "lead";
  const url = urlInput.value.trim();

  try {
    const response = await fetch(
      `/api/audit?url=${encodeURIComponent(url)}&profile=${encodeURIComponent(profile)}`
    );
    const payload = await response.json();

    if (!response.ok) throw new Error(payload.error || "Не удалось проверить сайт");

    finishDiagnosticAnimation();
    renderAudit(payload);
    document.querySelector("#report").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    renderError(error.message);
    diagnosticLog.textContent = "Не удалось завершить проверку.";
  } finally {
    setLoading(false);
  }
}

function copyCurrentSummary() {
  if (!lastAudit) {
    renderError("Сначала запустите проверку сайта.");
    return;
  }

  const checks = sortedChecks();
  const failed = checks.filter((check) => check.status === "failed");
  const lines = [
    `Kinava Pro: ${lastAudit.url}`,
    `Режим: ${modeTitle(selectedMode)}`,
    `Доступ: ${paidUnlocked ? "полный" : "бесплатный"}`,
    `Потенциальные штрафы: ${formatRub(failed.reduce((sum, check) => sum + (check.fineMax || 0), 0))}`,
    "",
    "Что исправить:",
    ...(failed.length
      ? failed.map((check) => `- ${check.title}: ${check.fix}`)
      : ["- Критичных проблем не найдено"])
  ];

  navigator.clipboard
    .writeText(lines.join("\n"))
    .then(() => {
      notice.hidden = false;
      notice.textContent = "Краткий вывод скопирован.";
    })
    .catch(() => {
      renderError("Браузер не дал доступ к буферу обмена.");
    });
}

function openLead(service = null) {
  selectedPackage = service;
  leadTitle.textContent = service
    ? `Заявка: ${service.title}`
    : "Разберём сайт и предложим план исправлений";
  leadPackage.textContent = service
    ? `${service.title}: ${service.price}. ${service.description}`
    : "Отправьте ссылку на сайт, а мы посмотрим результат проверки и подскажем следующий шаг.";
  leadComment.value = service
    ? `Интересует «${service.title}» для сайта ${urlInput.value.trim() || "..."}.`
    : `Нужна консультация по ${modeTitle(selectedMode).toLowerCase()} для сайта ${urlInput.value.trim() || "..."}.`;
  leadDialog.showModal();
}

function observeReveals() {
  const reveals = document.querySelectorAll(".reveal:not(.is-observed)");
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  reveals.forEach((element) => {
    element.classList.add("is-observed");
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.95) {
      element.classList.add("is-visible");
    } else {
      observer.observe(element);
    }
  });
}

document.querySelectorAll("[data-open-lead]").forEach((button) => {
  button.addEventListener("click", () => openLead());
});

document.querySelectorAll("[data-scroll-audit]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector("#audit").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

document.querySelectorAll("[data-select-mode]").forEach((button) => {
  button.addEventListener("click", () => setSelectedMode(button.dataset.selectMode));
});

modeInputs.forEach((input) => {
  input.addEventListener("change", () => setSelectedMode(input.value));
});

reportModeButtons.forEach((button) => {
  button.addEventListener("click", () => setSelectedMode(button.dataset.reportMode));
});

form.addEventListener("submit", runAudit);
copySummary.addEventListener("click", copyCurrentSummary);
openPayDialog.addEventListener("click", () => payDialog.showModal());
unlockPaid.addEventListener("click", () => {
  paidUnlocked = true;
  renderActiveReport();
  payDialog.close();
});

window.addEventListener("pointermove", (event) => {
  const x = (event.clientX / window.innerWidth - 0.5) * 18;
  const y = (event.clientY / window.innerHeight - 0.5) * 18;
  document.documentElement.style.setProperty("--mx", `${x}px`);
  document.documentElement.style.setProperty("--my", `${y}px`);
});

renderServices(defaultServices);
renderActiveReport();
observeReveals();
