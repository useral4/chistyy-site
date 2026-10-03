const site = document.querySelector(".site");
const form = document.querySelector(".check-form");
const input = document.querySelector("#site-url");
const policyCheckbox = document.querySelector(".policy input");
const policyLabel = document.querySelector(".policy");
const policyError = document.querySelector(".policy-error");
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
  paymentHint && (paymentHint.textContent = paymentMode === "test" ? "Тестовый режим ЮKassa: используйте тестовую карту, реальные деньги не списываются." : "Тестовая ЮKassa пока не настроена на сервере. Реальные платежи отключены.");
  paymentModal?.classList.add("is-open");
  paymentModal?.setAttribute("aria-hidden", "false");
}

function closePaymentModal() {
  paymentModal?.classList.remove("is-open");
  paymentModal?.setAttribute("aria-hidden", "true");
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
  return Number(check.fineMax) > 0 ? `Справочно до ${formatRub(check.fineMax)}` : "Недостаток";
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
  const group = state.tab === "growth" ? "seo" : "legal";
  const groupChecks = checks.filter(check=>check.group===group);
  const count = group === "legal" ? (state.audit?.summary?.legalIssues ?? groupChecks.filter(c=>c.status==='failed').length) : (state.audit?.summary?.seoIssues ?? groupChecks.filter(c=>c.status==='failed').length);
  const review = groupChecks.filter((check) => check.status === "review");
  const fineMax = Number(state.audit?.summary?.fineMax) || 0;

  if (resultTitle) {
    if (state.audit?.warning) {
      resultTitle.textContent = "Нужна ручная проверка";
    } else if (count > 0) {
      const noun = plural(count, ["проблема", "проблемы", "проблем"]);
      const single = count % 10 === 1 && count % 100 !== 11;
      resultTitle.textContent = `${single ? "Найдена" : "Найдено"} ${count} ${noun}${group === "seo" ? " SEO" : " по штрафам"}`;
    } else {
      resultTitle.textContent = group === "seo" ? "SEO-проблем не найдено" : "Явных проблем по штрафам не найдено";
    }
  }

  if (riskLabel) riskLabel.textContent = "Справочный сценарий санкций для юрлица:";
  if (riskValue) riskValue.textContent = fineMax > 0 ? `до ${formatRub(fineMax)}` : "";
  if (riskValue?.parentElement) riskValue.parentElement.hidden = group !== "legal" || fineMax === 0;
  const summary = document.querySelector(".audit-summary");
  if (summary) summary.textContent = `${group === "legal" ? "Юридическая проверка" : "SEO-проверка"}: ${groupChecks.length + (group === "legal" ? (state.audit?.access?.hiddenLegal || 0) : 0)} пунктов. Найдено проблем: ${count}. Отдельно требуют проверки: ${review.length}. Успешно: ${groupChecks.filter(c=>c.status==='passed').length}.`;
  const scope = document.querySelector(".audit-scope");
  if (scope) scope.textContent = [state.audit?.scope, group === "legal" && fineMax > 0 ? state.audit?.summary?.fineBasis : ""].filter(Boolean).join(" ");
}

function getSeoOverviewHtml(checks) {
  if (state.tab !== "growth") return "";

  const allChecks = Array.isArray(state.audit?.checks) ? state.audit.checks : [];
  const seoChecks = allChecks.filter((check) => check.group === "seo");
  const failed = seoChecks.filter((check) => check.status === "failed").length;
  const review = seoChecks.filter((check) => check.status === "review").length;
  const openedNow = checks.length;
  const locked = 0;
  const score = seoChecks.length ? Math.round(100 * seoChecks.filter(c=>c.status === "passed").length / seoChecks.length) : 0;

  return `
    <section class="seo-overview" aria-label="SEO-сводка">
      <div class="seo-overview__head">
        <div>
          <span class="seo-overview__eyebrow">SEO-аудит</span>
          <h3>Базовая проверка видимости сайта</h3>
          <p>SEO-проверки и рекомендации доступны бесплатно и считаются отдельно от юридических проблем. Оценка — доля успешных автоматических проверок, а не прогноз позиций.</p>
        </div>
        <div class="seo-overview__score">
          <strong>${score}</strong>
          <span>из 100</span>
        </div>
      </div>
      <div class="seo-overview__cards">
        <div><span>Проверено пунктов</span><strong>${seoChecks.length}</strong></div>
        <div><span>Найдено проблем</span><strong>${failed}</strong></div>
        <div><span>Открыто сейчас</span><strong>${openedNow}${locked ? ` / +${locked}` : ""}</strong></div>
      </div>
      <div class="seo-overview__chips" aria-label="Разделы SEO-проверки">
        <span>Технические данные</span>
        <span>Метатеги</span>
        <span>Текстовые данные</span>
        <span>Мобильность</span>
        <span>Скорость</span>
        <span>Рекомендации</span>
      </div>
    </section>
  `;
}

function renderLockedReport(items) {
  if (!lockedReport) return;
  const count = items ? Number(state.audit?.access?.hiddenLegal) || 0 : 0;
  const locked = state.tab === "fines" && !state.reportUnlocked && count > 0;
  lockedReport.classList.toggle("is-hidden", !locked);
  lockedReport.classList.remove("is-transparent");
  if (!locked) { if (lockedItems) lockedItems.innerHTML=""; return; }
  // Generic shapes indicate locked findings without embedding private report data.
  if (lockedItems) lockedItems.innerHTML = Array.from({length:Math.min(count,3)},()=>'<div class="locked-item"><div class="locked-shape"></div><div class="locked-shape"></div></div>').join("");
  if (lockedReportTitle) lockedReportTitle.textContent = `Ещё ${count} ${plural(count,["проблема","проблемы","проблем"])} по штрафам`;
  if (lockedReportText) lockedReportText.textContent = `Открыты первые ${state.audit.access.visibleLegal}. После оплаты получите все ${state.audit.access.totalLegal} найденных проблем: что обнаружено, на какой странице и как исправить. Пункты ручной проверки не входят в платный счётчик.`;
  if (lockedReportLink) lockedReportLink.textContent = "Открыть все проблемы — 179 ₽";
}

function renderIssueList() {
  if (!issueList) return;

  const checks = getTabChecks();
  const seoOverviewHtml = getSeoOverviewHtml(checks);

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
      ${seoOverviewHtml}
      <article class="issue-empty">
        <div>
          <h3>${title}</h3>
          <p>${text}</p>
        </div>
      </article>
    `;
    renderLockedReport(null);
    renderPassedChecks();
    return;
  }

  const visibleChecks = checks;
  const failedCount = checks.filter(c=>c.status==='failed').length;
  const reviewCount = checks.filter(c=>c.status==='review').length;
  issueList.innerHTML =
    seoOverviewHtml +
    visibleChecks
    .map((check,index) => {
      const riskClass = check.status === "review" ? "is-review" : "";
      const sectionTitle = check.status==='review' && (index===0 || checks[index-1].status!=='review') ? `<div data-lock-position></div><h3 class="issue-section-title">Нужна ручная проверка — ${reviewCount}</h3><p class="issue-section-note">Эти пункты не подтверждены как нарушения и не входят в число найденных проблем.</p>` : index===0 && failedCount ? '<h3 class="issue-section-title">Найденные проблемы</h3>' : '';

      return `
        ${sectionTitle}
        <article>
          <div>
            <h3>${escapeHtml(check.title)}</h3>
            <p>${escapeHtml(getIssueText(check))}</p>
            ${check.law ? `<small class="issue-law">${escapeHtml(check.law)}${check.source ? ` · <a href="${escapeHtml(check.source)}" target="_blank" rel="noopener">Источник</a>` : ""}</small>` : ""}
            ${check.condition ? `<small class="issue-condition">${escapeHtml(check.condition)}</small>` : ""}
            ${check.fix ? `<p class="issue-fix"><strong>Что сделать:</strong> ${escapeHtml(check.fix)}</p>` : ""}
          </div>
          <div class="risk ${riskClass}"><span>!</span> ${escapeHtml(getPillText(check))}</div>
        </article>
      `;
    })
    .join("");

  renderLockedReport(state.reportUnlocked || state.audit?.warning ? null : true);
  const lockPosition=issueList.querySelector('[data-lock-position]');
  if(lockPosition)lockPosition.replaceWith(lockedReport);
  else issueList.append(lockedReport);
  renderPassedChecks();
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

  if (!policyCheckbox?.checked) {
    policyLabel?.classList.add("is-invalid");
    if (policyError) policyError.textContent = "Подтвердите согласие с политикой конфиденциальности";
    policyCheckbox?.focus();
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
    state.reportUnlocked = audit.access?.full === true;
    const download=document.querySelector('[data-report-download]');
    if(download) download.hidden=!state.reportUnlocked;
    document.querySelector('[data-report-print]').hidden=!state.reportUnlocked;
    document.querySelector('[data-report-link]').hidden=!audit.reportToken;
    const status=document.querySelector('.report-payment-status');
    status.hidden=!state.reportUnlocked;
    if(state.reportUnlocked)status.textContent='Весь отчёт открыт бесплатно: найдено не больше 5 юридических проблем. Можно сохранить ссылку и скачать результаты.';
    document.querySelector('[data-report-refresh]').hidden=true;
    renderResult();
    showView("result");
  } catch (error) {
    renderError(url, error.message || "Проверка временно недоступна");
    showView("result");
  }
});

policyCheckbox?.addEventListener("change", () => {
  if (!policyCheckbox.checked) return;
  policyLabel?.classList.remove("is-invalid");
  if (policyError) policyError.textContent = "";
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

document.querySelector("[data-payment-buy]")?.addEventListener("click", () => {
  startTestPayment();
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

function renderPassedChecks() {
  const passed = (state.audit?.checks || []).filter(c => c.status === "passed" && c.group === (state.tab === "growth" ? "seo" : "legal"));
  document.querySelector(".passed-checks")?.remove();
  if (passed.length) issueList?.insertAdjacentHTML("beforeend", `<details class="passed-checks"><summary>Успешные проверки: ${passed.length}</summary>${passed.map(c=>`<div><strong>${escapeHtml(c.title)}</strong><p>${escapeHtml(c.evidence)}</p></div>`).join("")}</details>`);
}
let paymentMode = "unavailable";
fetch("/api/config").then(r=>r.json()).then(config=>{paymentMode=config.paymentMode;}).catch(()=>{});

async function startTestPayment() {
  const button = document.querySelector("[data-payment-buy]");
  if (!state.audit?.reportToken) { paymentHint.textContent = "Сначала проверьте сайт."; return; }
  button.disabled = true;
  paymentHint.textContent = "Готовим тестовый платёж…";
  try {
    const response = await fetch("/api/payments", { method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify({reportToken:state.audit.reportToken}) });
    const payment = await response.json();
    if (!response.ok) throw new Error(payment.error || "Не удалось создать тестовый платёж");
    if (payment.paid || payment.free) { await restoreReport(state.audit.reportToken); closePaymentModal(); return; }
    if (payment.test !== true) throw new Error("Доступен только тестовый режим");
    window.location.assign(payment.confirmationUrl);
  } catch (error) { paymentHint.textContent = error.message; }
  finally { button.disabled = false; }
}

async function restoreReport(token) {
  const response = await fetch(`/api/report?token=${encodeURIComponent(token)}`, {headers:{Accept:"application/json"}});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Отчёт недоступен");
  state.audit = result.audit;
  state.checkedUrl = result.audit.url;
  state.reportUnlocked = result.paid || result.audit.access?.full === true;
  renderResult(); showView("result");
  const note = document.querySelector(".report-payment-status");
  if (note) {
    note.hidden = false;
    note.textContent = result.paid ? "Тестовый платёж подтверждён. Все найденные проблемы и рекомендации открыты. Сохраните ссылку или скачайте отчёт." : state.reportUnlocked ? "Найдено не больше 5 юридических проблем — полный отчёт доступен бесплатно." : result.canceled ? "Тестовый платёж отменён. Отчёт сохранён, можно повторить оплату." : "Оплата пока не подтверждена. Если платёж ещё обрабатывается, отчёт откроется после подтверждения. Можно проверить статус ещё раз.";
  }
  document.querySelector("[data-report-refresh]").hidden = state.reportUnlocked;
  document.querySelector("[data-report-download]").hidden = !state.reportUnlocked;
  document.querySelector("[data-report-print]").hidden = !state.reportUnlocked;
  document.querySelector("[data-report-link]").hidden = false;
  return result;
}
const returnToken = new URLSearchParams(window.location.search).get("report");
if (/^[a-f0-9]{48}$/.test(returnToken || "")) (async()=>{
  for(let attempt=0;attempt<7;attempt++){
    const result=await restoreReport(returnToken);
    if(state.reportUnlocked||result.canceled)break;
    if(attempt<6)await new Promise(resolve=>setTimeout(resolve,5000));
  }
})().catch(error=>{showView("result");document.querySelector(".report-payment-status").hidden=false;document.querySelector(".report-payment-status").textContent=error.message;});
document.querySelector('[data-report-print]')?.addEventListener('click',()=>{
  if(!state.reportUnlocked)return;
  document.querySelector('.print-report')?.remove();
  const report=document.createElement('section');report.className='print-report';
  const status={failed:'Проблема',review:'Требует проверки',passed:'Проверка пройдена'};
  report.innerHTML=`<h1>Отчёт KinavaPro</h1><p>${escapeHtml(state.audit.url)} · ${escapeHtml(state.audit.checkedAt||'')}</p><p>${escapeHtml(state.audit.scope)}</p>${state.audit.checks.map(c=>`<article><h2>${escapeHtml(c.title)} — ${status[c.status]||''}</h2><p>${escapeHtml(c.evidence)}</p>${c.fix?`<p><strong>Что сделать:</strong> ${escapeHtml(c.fix)}</p>`:''}<p>${escapeHtml(c.law||'')} ${escapeHtml(c.condition||'')}</p></article>`).join('')}`;
  document.body.append(report);window.print();
});
window.addEventListener('afterprint',()=>document.querySelector('.print-report')?.remove());
document.querySelector('[data-report-link]')?.addEventListener('click',async()=>{
  const token=state.audit?.reportToken;
  if(!token)return;
  const url=new URL('/?report='+token,location.origin).href;
  try{await navigator.clipboard.writeText(url);document.querySelector('.report-payment-status').hidden=false;document.querySelector('.report-payment-status').textContent='Ссылка скопирована. Она даёт доступ к этому отчёту — храните её у себя.';}catch{document.querySelector('.report-payment-status').hidden=false;document.querySelector('.report-payment-status').textContent='Ссылка на отчёт: '+url;}
});
document.querySelector("[data-report-refresh]")?.addEventListener("click",()=>restoreReport(state.audit?.reportToken || returnToken).catch(error=>{document.querySelector(".report-payment-status").textContent=error.message;}));
document.querySelector("[data-report-download]")?.addEventListener("click",()=>{
  if (!state.reportUnlocked) return;
  const audit=state.audit;
  const content=[`Отчёт KinavaPro: ${audit.url}`,`Проверка: ${audit.checkedAt}`,audit.scope,audit.summary.fineBasis,...audit.checks.map(check=>`\n${check.title} [${check.status}]\n${check.evidence}\n${check.fix || ""}\n${check.law || ""}`)].join("\n");
  const url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));const anchor=document.createElement("a");anchor.href=url;anchor.download="kinavapro-report.txt";anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});

const requestModal = document.querySelector(".request-modal");
const requestForm = document.querySelector(".request-form");
const requestSuccess = document.querySelector(".request-success");
const requestStatus = document.querySelector(".request-status");
const requestSubmit = document.querySelector(".request-submit");
let requestPending = false;
let requestTrigger = null;

document.querySelectorAll("[data-request-service]").forEach((button) => {
  button.addEventListener("click", () => {
    requestTrigger = button;
    requestForm.reset();
    requestForm.elements.service.value = button.dataset.requestService;
    requestForm.elements.website.value = input?.value.trim() || "";
    requestForm.hidden = false;
    requestSuccess.hidden = true;
    requestStatus.textContent = "";
    requestModal.showModal();
    requestForm.elements.website.focus();
  });
});

function closeRequest() {
  if (!requestPending) requestModal.close();
}
document.querySelector(".request-close")?.addEventListener("click", closeRequest);
document.querySelector(".request-done")?.addEventListener("click", closeRequest);
requestModal?.addEventListener("click", (event) => {
  const bounds = requestModal.getBoundingClientRect();
  if (event.target === requestModal && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) closeRequest();
});
requestModal?.addEventListener("cancel", (event) => {
  if (requestPending) event.preventDefault();
});
requestModal?.addEventListener("close", () => requestTrigger?.focus());
requestForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (requestPending || !requestForm.reportValidity()) return;
  const fields = Object.fromEntries(new FormData(requestForm));
  fields.consent = requestForm.elements.consent.checked;
  requestPending = true;
  requestSubmit.disabled = true;
  requestForm.setAttribute("aria-busy", "true");
  requestSubmit.textContent = "Отправляем…";
  requestStatus.textContent = "";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/requests", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields), signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok || !result.id) throw new Error(result.error || "Не удалось отправить заявку");
    document.querySelector(".request-confirmation").textContent = `Номер заявки: ${result.id}. Email для ответа: ${fields.email}.`;
    requestForm.hidden = true;
    requestSuccess.hidden = false;
    requestSuccess.focus();
  } catch (error) {
    requestStatus.textContent = error.name === "AbortError" || error instanceof TypeError
      ? "Не удалось получить подтверждение. Проверьте соединение и повторите отправку или напишите нам в Telegram."
      : error.message;
  } finally {
    window.clearTimeout(timeout);
    requestPending = false;
    requestSubmit.disabled = false;
    requestForm.removeAttribute("aria-busy");
    requestSubmit.textContent = "Отправить заявку";
  }
});
