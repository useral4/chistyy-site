const form = document.querySelector("#scanForm");
const urlInput = document.querySelector("#urlInput");
const riskLabel = document.querySelector("#riskLabel");
const scoreRing = document.querySelector("#scoreRing");
const scoreValue = document.querySelector("#scoreValue");
const fineValue = document.querySelector("#fineValue");
const fineHint = document.querySelector("#fineHint");
const legalCount = document.querySelector("#legalCount");
const seoCount = document.querySelector("#seoCount");
const totalCount = document.querySelector("#totalCount");
const legalChecks = document.querySelector("#legalChecks");
const seoChecks = document.querySelector("#seoChecks");
const serviceGrid = document.querySelector("#serviceGrid");
const notice = document.querySelector("#notice");
const copySummary = document.querySelector("#copySummary");
const leadDialog = document.querySelector("#leadDialog");
const leadPackage = document.querySelector("#leadPackage");
const leadComment = document.querySelector("#leadComment");
const leadTitle = document.querySelector("#leadTitle");
const parallaxLayer = document.querySelector("[data-parallax]");

let lastAudit = null;
let selectedPackage = null;

const riskLabels = {
  low: "Низкий",
  medium: "Средний",
  high: "Высокий",
  critical: "Критичный"
};

const severityLabels = {
  low: "низкий",
  medium: "средний",
  high: "важный"
};

const defaultServices = [
  {
    id: "legal",
    title: "Правовой порядок",
    price: "от 29 000 ₽",
    tag: "документы",
    description: "ПДн, согласия, cookie, реквизиты, оферта и повторная проверка.",
    items: [
      "Политика обработки персональных данных",
      "Согласия у всех форм",
      "Cookie-уведомление",
      "Реквизиты и базовые документы",
      "Повторная проверка после внедрения"
    ],
    active: true
  },
  {
    id: "ads",
    title: "Реклама без риска",
    price: "от 17 000 ₽",
    tag: "реклама",
    description: "Маркировка рекламы, рекламодатель, ERID и чек-лист размещений.",
    items: [
      "Проверка рекламных блоков",
      "Пометки «Реклама»",
      "Рекламодатель и ERID",
      "Чек-лист для подрядчиков",
      "Рекомендации по спорным местам"
    ],
    active: false
  },
  {
    id: "seo",
    title: "SEO-основа",
    price: "от 35 000 ₽",
    tag: "поиск",
    description: "Метатеги, H1/H2, alt, robots, sitemap, schema и скорость.",
    items: [
      "Title и description",
      "H1/H2 и структура страницы",
      "Alt-тексты изображений",
      "robots.txt и sitemap.xml",
      "Schema.org, Open Graph и скорость"
    ],
    active: true
  },
  {
    id: "full",
    title: "Полный порядок",
    price: "от 69 000 ₽",
    tag: "под ключ",
    description: "Документы, SEO-правки, отчёт и повторная проверка через 14 дней.",
    items: [
      "Все правовые исправления",
      "SEO и техническая база",
      "Приоритетный список задач",
      "Отчёт для команды",
      "Повторный аудит через 14 дней"
    ],
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

function setLoading(isLoading) {
  const button = form.querySelector("button[type='submit']");
  button.disabled = isLoading;
  button.querySelector("span").textContent = isLoading ? "Проверяем..." : "Проверить сайт";
}

function renderCheck(check) {
  const passed = check.status === "passed";
  const meta = [`приоритет: ${severityLabels[check.severity] || check.severity}`];

  if (check.law) meta.push(check.law);

  return `
    <div class="check-item ${passed ? "passed" : "failed"}">
      <div class="check-top">
        <strong>${escapeHtml(check.title)}</strong>
        <span class="status-pill ${passed ? "passed" : "failed"}">
          ${passed ? "ОК" : "Риск"}
        </span>
      </div>
      <p>${escapeHtml(check.evidence)}</p>
      ${
        check.fineMax
          ? `<div class="fine-badge">Возможный риск до ${formatRub(check.fineMax)}</div>`
          : ""
      }
      ${passed ? "" : `<p class="fix-line">${escapeHtml(check.fix)}</p>`}
      <div class="check-meta">
        ${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </div>
  `;
}

function renderServices(services) {
  serviceGrid.innerHTML = services
    .map(
      (service) => `
        <article class="service-card reveal ${service.active ? "active" : ""}" data-service-card="${escapeHtml(service.id)}">
          <div>
            <span class="tag">${escapeHtml(service.tag)}</span>
            <h3>${escapeHtml(service.title)}</h3>
            <p>${escapeHtml(service.description)}</p>
            <details>
              <summary>Что входит</summary>
              <ul>
                ${(service.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </details>
          </div>
          <div class="service-bottom">
            <strong>${escapeHtml(service.price)}</strong>
            <button class="primary-button compact" type="button" data-package="${escapeHtml(service.id)}">
              Оставить заявку
            </button>
          </div>
        </article>
      `
    )
    .join("");

  serviceGrid.querySelectorAll("[data-package]").forEach((button) => {
    button.addEventListener("click", () => {
      const service = services.find((item) => item.id === button.dataset.package);
      openLead(service);
    });
  });

  observeReveals();
}

function renderAudit(audit) {
  lastAudit = audit;

  const summary = audit.summary;
  const score = summary.score ?? 0;

  riskLabel.textContent = riskLabels[summary.riskLevel] || "Средний";
  scoreRing.style.setProperty("--score", score);
  scoreValue.textContent = score;
  fineValue.textContent = summary.fineMax ? `до ${formatRub(summary.fineMax)}` : "0 ₽";
  fineHint.textContent = summary.fineMax
    ? "Верхняя граница риска по найденным признакам"
    : "Критичных штрафных признаков не найдено";
  legalCount.textContent = summary.legalIssues;
  seoCount.textContent = summary.seoIssues;
  totalCount.textContent = summary.totalIssues;

  legalChecks.innerHTML = audit.checks
    .filter((check) => check.group === "legal")
    .map(renderCheck)
    .join("");
  seoChecks.innerHTML = audit.checks
    .filter((check) => check.group === "seo")
    .map(renderCheck)
    .join("");
  renderServices(audit.services);

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
  setLoading(true);
  renderError("Загружаем сайт и собираем отчёт...");

  const profile = new FormData(form).get("profile");
  const url = urlInput.value.trim();

  try {
    const response = await fetch(
      `/api/audit?url=${encodeURIComponent(url)}&profile=${encodeURIComponent(profile)}`
    );
    const payload = await response.json();

    if (!response.ok) throw new Error(payload.error || "Не удалось проверить сайт");

    renderAudit(payload);
    document.querySelector("#report").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    renderError(error.message);
  } finally {
    setLoading(false);
  }
}

function copyCurrentSummary() {
  if (!lastAudit) {
    renderError("Сначала запустите проверку сайта.");
    return;
  }

  const failed = lastAudit.checks.filter((check) => check.status === "failed");
  const lines = [
    `Чистый сайт: ${lastAudit.url}`,
    `Риск: ${riskLabels[lastAudit.summary.riskLevel]}`,
    `Потенциальные штрафы: ${formatRub(lastAudit.summary.fineMax)}`,
    `Юридические риски: ${lastAudit.summary.legalIssues}`,
    `SEO-задачи: ${lastAudit.summary.seoIssues}`,
    "",
    "Что исправить:",
    ...failed.map((check) => `- ${check.title}: ${check.fix}`)
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
    ? `Заявка на пакет «${service.title}»`
    : "Разберём сайт и зафиксируем стоимость";
  leadPackage.textContent = service
    ? `${service.title}: ${service.price}. ${service.description}`
    : "Выберите пакет или отправьте общий запрос.";
  leadComment.value = service
    ? `Интересует пакет «${service.title}» для сайта ${urlInput.value.trim() || "..."}.`
    : "";
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
    { threshold: 0.16 }
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

form.addEventListener("submit", runAudit);
copySummary.addEventListener("click", copyCurrentSummary);

window.addEventListener("pointermove", (event) => {
  if (!parallaxLayer) return;
  const x = (event.clientX / window.innerWidth - 0.5) * 18;
  const y = (event.clientY / window.innerHeight - 0.5) * 18;
  parallaxLayer.style.transform = `translate3d(${x}px, ${y}px, 0)`;
});

renderServices(defaultServices);
observeReveals();
