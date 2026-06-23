const site = document.querySelector(".site");
const form = document.querySelector(".check-form");
const input = document.querySelector("#site-url");
const resultUrl = document.querySelector(".checked-url b");
const resultTitle = document.querySelector(".result-title");
const riskLabel = document.querySelector(".result-risk-label");
const riskValue = document.querySelector(".result-risk-value");
const issueList = document.querySelector(".issue-list");
const tabs = document.querySelectorAll("[data-result-tab]");
const lockedReport = document.querySelector(".locked-report");
const lockedItems = document.querySelector(".locked-items");
const lockedReportTitle = document.querySelector(".locked-report-title");
const lockedReportText = document.querySelector(".locked-report-text");
const lockedReportLink = document.querySelector(".locked-report-link");
const paymentModal = document.querySelector(".payment-modal");
const paymentHint = document.querySelector("[data-payment-hint]");
const stats = document.querySelector(".stats");
const statCards = Array.from(document.querySelectorAll(".stats .stat"));

const state = {
  audit: null,
  tab: "fines",
  checkedUrl: "https://вашсайт.ru",
  reportUnlocked: false
};

const severityOrder = { high: 0, medium: 1, low: 2 };
const statusOrder = { failed: 0, review: 1, passed: 2 };
const statPositions = ["stat-left", "stat-center", "stat-right"];

function showView(view) {
  site?.setAttribute("data-view", view);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function getStatPosition(card) {
  return statPositions.findIndex((position) => card.classList.contains(position));
}

function rotateStats() {
  stats?.classList.add("is-sliding");

  statCards.forEach((card) => {
    const currentPosition = getStatPosition(card);
    const nextPosition = currentPosition === statPositions.length - 1 ? 0 : currentPosition + 1;

    card.classList.remove(...statPositions);
    card.classList.add(statPositions[nextPosition]);
  });

  window.setTimeout(() => {
    stats?.classList.remove("is-sliding");
  }, 760);
}

function initStatsSlider() {
  if (!stats || statCards.length !== statPositions.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  window.setInterval(() => {
    rotateStats();
  }, 4200);
}

function openPaymentModal() {
  paymentHint && (paymentHint.textContent = "Доступ к цифровому отчёту предоставляется после оплаты. До подключения магазина можно открыть демо-доступ для теста.");
  paymentModal?.classList.add("is-open");
  paymentModal?.setAttribute("aria-hidden", "false");
}

function closePaymentModal() {
  paymentModal?.classList.remove("is-open");
  paymentModal?.setAttribute("aria-hidden", "true");
}

function unlockReportDemo() {
  state.reportUnlocked = true;
  closePaymentModal();
  renderResult();
  document.querySelector(".result-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "https://вашсайт.ru";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plural(value, forms) {
  const number = Math.abs(value) % 100;
  const last = number % 10;

  if (number > 10 && number < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

function formatRub(value) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.max(0, Math.round(Number(value) || 0)))} ₽`;
}

function getActionableChecks() {
  return Array.isArray(state.audit?.checks)
    ? state.audit.checks.filter((check) => check.status === "failed" || check.status === "review")
    : [];
}

function getTabChecks() {
  const group = state.tab === "growth" ? "seo" : "legal";

  return getActionableChecks()
    .filter((check) => check.group === group)
    .sort((a, b) => {
      const byStatus = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (byStatus) return byStatus;

      const bySeverity = (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9);
      if (bySeverity) return bySeverity;

      return (Number(b.fineMax) || 0) - (Number(a.fineMax) || 0);
    });
}

function getPillText(check) {
  if (check.status === "review") return "Проверить";
  if (state.tab === "growth") return check.severity === "high" ? "Срочно" : "Теряете заявки";
  return Number(check.fineMax) > 0 ? `Риск до ${formatRub(check.fineMax)}` : "Риск";
}

function getIssueText(check) {
  const evidence = String(check.evidence || "").trim();
  const fix = String(check.fix || "").trim();

  if (check.status === "review") {
    return [evidence, fix ? `Нужна ручная проверка: ${fix}` : ""].filter(Boolean).join(". ");
  }

  return evidence || fix || "Проверка нашла проблему, которую стоит исправить.";
}

function renderTabs() {
  tabs.forEach((button) => {
    const isActive = button.dataset.resultTab === state.tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

function renderHero() {
  if (resultUrl) resultUrl.textContent = state.checkedUrl;

  const checks = Array.isArray(state.audit?.checks) ? state.audit.checks : [];
  const failed = checks.filter((check) => check.status === "failed");
  const failedLegal = failed.filter((check) => check.group === "legal");
  const failedSeo = failed.filter((check) => check.group === "seo");
  const review = checks.filter((check) => check.status === "review");
  const fineMax = Number(state.audit?.summary?.fineMax) || 0;

  if (resultTitle) {
    if (state.audit?.warning && failed.length === 0) {
      resultTitle.textContent = "Нужна ручная проверка";
    } else if (failed.length > 0) {
      const noun =
        failedLegal.length > 0 && failedSeo.length === 0
          ? plural(failed.length, ["нарушение", "нарушения", "нарушений"])
          : plural(failed.length, ["проблема", "проблемы", "проблем"]);

      resultTitle.textContent = `Найдено ${failed.length} ${noun}`;
    } else if (review.length > 0) {
      resultTitle.textContent = "Есть пункты для проверки";
    } else {
      resultTitle.textContent = "Критичных нарушений не найдено";
    }
  }

  if (riskLabel) riskLabel.textContent = "Общий риск штрафов:";
  if (riskValue) riskValue.textContent = fineMax > 0 ? `до ${formatRub(fineMax)}` : "0 ₽";
}

function renderLockedReport(hiddenChecks) {
  if (!lockedReport) return;

  const checks = Array.isArray(hiddenChecks) ? hiddenChecks : [];
  const hiddenCount = checks.length;

  if (hiddenCount <= 0) {
    lockedReport.classList.add("is-hidden");
    if (lockedItems) lockedItems.innerHTML = "";
    return;
  }

  lockedReport.classList.remove("is-hidden");

  if (lockedItems) {
    lockedItems.innerHTML = checks
      .slice(0, 3)
      .map((check) => {
        const riskClass = check.status === "review" ? "is-review" : "";

        return `
          <article class="locked-item">
            <div>
              <h3>${escapeHtml(check.title)}</h3>
              <p>${escapeHtml(getIssueText(check))}</p>
            </div>
            <div class="risk ${riskClass}"><span>!</span> ${escapeHtml(getPillText(check))}</div>
          </article>
        `;
      })
      .join("");
  }

  if (lockedReportTitle) {
    const useNeutralText = state.tab === "growth" || checks.some((check) => check.status === "review");
    const noun = useNeutralText
      ? plural(hiddenCount, ["пункт", "пункта", "пунктов"])
      : plural(hiddenCount, ["нарушение", "нарушения", "нарушений"]);

    lockedReportTitle.innerHTML = `Ещё ${hiddenCount} ${noun} требуют<br />вашего внимания`;
  }

  if (lockedReportText) {
    lockedReportText.textContent =
      state.tab === "growth"
        ? "Где именно сайт теряет заявки - в полном отчёте"
        : "Где именно и как исправить - в полном отчёте";
  }
}

function renderIssueList() {
  if (!issueList) return;

  const checks = getTabChecks();

  if (!checks.length) {
    const title =
      state.tab === "growth"
        ? "Критичных SEO-проблем не найдено"
        : "Явных штрафных нарушений не найдено";
    const text =
      state.tab === "growth"
        ? "По автоматической проверке базовые элементы для поиска и заявок выглядят нормально."
        : "Автоматическая проверка не нашла нарушений, которые можно честно подтвердить по странице.";

    issueList.innerHTML = `
      <article class="issue-empty">
        <div>
          <h3>${title}</h3>
          <p>${text}</p>
        </div>
      </article>
    `;
    renderLockedReport([]);
    return;
  }

  const visibleChecks = state.reportUnlocked ? checks : checks.slice(0, 3);
  issueList.innerHTML = visibleChecks
    .map((check) => {
      const riskClass = check.status === "review" ? "is-review" : "";

      return `
        <article>
          <div>
            <h3>${escapeHtml(check.title)}</h3>
            <p>${escapeHtml(getIssueText(check))}</p>
          </div>
          <div class="risk ${riskClass}"><span>!</span> ${escapeHtml(getPillText(check))}</div>
        </article>
      `;
    })
    .join("");

  renderLockedReport(state.reportUnlocked ? [] : checks.slice(visibleChecks.length));
}

function renderResult() {
  renderTabs();
  renderHero();
  renderIssueList();
}

function renderError(url, message) {
  state.checkedUrl = url;
  state.reportUnlocked = false;
  state.audit = {
    warning: message,
    summary: { fineMax: 0 },
    checks: [
      {
        id: "fetch-error",
        group: "legal",
        title: "Сайт не удалось проверить автоматически",
        status: "review",
        severity: "high",
        fineMax: 0,
        evidence: message,
        fix: "Проверьте адрес сайта и доступность страницы, затем запустите проверку ещё раз."
      }
    ]
  };
  state.tab = "fines";
  renderResult();
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeUrl(input?.value || "");

  if (!input?.value.trim()) {
    input?.focus();
    return;
  }

  state.checkedUrl = url;
  if (resultUrl) resultUrl.textContent = url;
  showView("loading");

  try {
    const response = await fetch(`/api/audit?url=${encodeURIComponent(url)}&profile=lead`, {
      headers: { Accept: "application/json" }
    });
    const audit = await response.json();

    if (!response.ok || audit.error) {
      throw new Error(audit.error || "Проверка временно недоступна");
    }

    state.audit = audit;
    state.tab = "fines";
    state.reportUnlocked = false;
    renderResult();
    showView("result");
  } catch (error) {
    renderError(url, error.message || "Проверка временно недоступна");
    showView("result");
  }
});

tabs.forEach((button) => {
  button.addEventListener("click", () => {
    state.tab = button.dataset.resultTab || "fines";
    renderResult();
  });
});

lockedReportLink?.addEventListener("click", (event) => {
  event.preventDefault();
  openPaymentModal();
});

document.querySelectorAll("[data-payment-close]").forEach((button) => {
  button.addEventListener("click", closePaymentModal);
});

document.querySelector("[data-demo-unlock]")?.addEventListener("click", unlockReportDemo);

document.querySelector("[data-payment-buy]")?.addEventListener("click", () => {
  if (paymentHint) {
    paymentHint.textContent = "Платёжный переход будет доступен после подключения магазина. Стоимость цифрового отчёта - 179 ₽.";
  }
});

document.querySelector("[data-payment-terms]")?.addEventListener("click", (event) => {
  event.preventDefault();
  closePaymentModal();
  showView("home");
  requestAnimationFrame(() => {
    document.querySelector("#payment-terms")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePaymentModal();
});

document.querySelectorAll(".js-home, .back-home").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showView("home");
  });
});

initStatsSlider();
