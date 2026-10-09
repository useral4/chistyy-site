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
let loadingTimer = null;
let auditRequest = null;
let paymentPolling = true;
let selectedPlan = 'single';
let startPlanAfterAudit = false;
let accessPasses = [];
let paymentFocus = null;
const loadingHelp = document.querySelector('[data-loading-help]');
const flashToast = document.querySelector('.flash-toast');
let toastTimer;

function showToast(message, duration = 7000) {
  if (!flashToast) return;
  clearTimeout(toastTimer);
  flashToast.querySelector('[data-toast-message]').textContent = message;
  flashToast.hidden = false;
  flashToast.dataset.duration = String(duration);
  if (duration > 0) toastTimer = setTimeout(() => { flashToast.hidden = true; }, duration);
}
document.querySelector('[data-toast-close]')?.addEventListener('click', () => { clearTimeout(toastTimer); flashToast.hidden = true; });
flashToast?.addEventListener('mouseenter', () => clearTimeout(toastTimer));
flashToast?.addEventListener('focusin', () => clearTimeout(toastTimer));
const resumeToast = () => {
  const duration = Number(flashToast?.dataset.duration);
  clearTimeout(toastTimer);
  if (duration > 0) toastTimer = setTimeout(() => { flashToast.hidden = true; }, duration);
};
flashToast?.addEventListener('mouseleave', resumeToast);
flashToast?.addEventListener('focusout', resumeToast);

const state = {
  audit: null,
  tab: "fines",
  checkedUrl: "https://вашсайт.ru",
  reportUnlocked: false
};

const severityOrder = { high: 0, medium: 1, low: 2 };
const statusOrder = { failed: 0, review: 1, passed: 2 };
const statPositions = ["stat-left", "stat-center", "stat-right"];

function resetAuditProgress(message = 'Подключаемся к проверке') {
  const bar = document.querySelector('.loading-progress');
  if (!bar) return;
  bar.removeAttribute('aria-valuenow');
  bar.removeAttribute('aria-valuetext');
  bar.querySelector('span').style.transform = 'scaleX(0)';
  document.querySelector('[data-progress-count]').textContent = message;
  document.querySelector('[data-progress-stage]').textContent = '';
}

function updateAuditProgress({completed, total, message, phase, queuePosition}) {
  if (!Number.isInteger(completed) || !Number.isInteger(total) || total <= 0 || completed < 0 || completed > total) return;
  const bar = document.querySelector('.loading-progress');
  if (!bar) return;
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(completed));
  bar.setAttribute('aria-valuetext', `Выполнено ${completed} из ${total} этапов`);
  bar.querySelector('span').style.transform = `scaleX(${completed / total})`;
  document.querySelector('[data-progress-count]').textContent = phase === 'queue' && Number.isInteger(queuePosition) && queuePosition > 0
    ? `В очереди · место ${queuePosition}` : `Выполнено ${completed} из ${total} этапов`;
  document.querySelector('[data-progress-stage]').textContent = typeof message === 'string' ? message : '';
}

async function readAuditResponse(response, onProgress) {
  if (!response.ok || !/application\/x-ndjson/i.test(response.headers.get('content-type') || '')) {
    const audit = await response.json();
    if (!response.ok || audit.error) throw new Error(audit.error || 'Проверка временно недоступна');
    return audit;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result;
  const consume = line => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); }
    catch { throw new Error('Не удалось прочитать данные проверки. Попробуйте ещё раз.'); }
    if (event.type === 'error') throw new Error(event.error || 'Проверка временно недоступна');
    if (event.type === 'progress' && !result) onProgress(event);
    if (event.type === 'result') result = event.audit;
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value, {stream: !done});
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!result || result.error) throw new Error(result?.error || 'Соединение прервалось до получения отчёта. Попробуйте ещё раз.');
    return result;
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

function showView(view, loadingMessage) {
  clearTimeout(loadingTimer);
  if(loadingHelp)loadingHelp.hidden=true;
  if(view==='loading'){
    resetAuditProgress(loadingMessage);
    loadingTimer=setTimeout(()=>{if(site?.dataset.view==='loading'&&loadingHelp)loadingHelp.hidden=false;},30000);
  }
  else if(view==='home'){paymentPolling=false;if(auditRequest){auditRequest.abort();auditRequest=null;}}
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
  if (!stats || statCards.length !== statPositions.length) return;
  const mobile = window.matchMedia("(max-width: 1100px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const indicators = [...document.querySelectorAll('[data-stat-index]')];
  const select = (index) => indicators.forEach((button, current) => button.setAttribute('aria-pressed', String(current === index)));
  const scrollToCard = (index) => {
    if (!mobile.matches) return;
    stats.scrollTo({ left: statCards[index].offsetLeft, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
  };
  indicators.forEach((button, index) => button.addEventListener('click', () => scrollToCard(index)));
  stats.addEventListener('scroll', () => {
    if (!mobile.matches) return;
    const nearest = statCards.reduce((best, card, index) => Math.abs(card.offsetLeft - stats.scrollLeft) < Math.abs(statCards[best].offsetLeft - stats.scrollLeft) ? index : best, 0);
    select(nearest);
  }, { passive: true });
  stats.addEventListener('keydown', (event) => {
    if (!mobile.matches || event.target !== stats || event.altKey || event.ctrlKey || event.metaKey) return;
    const current = indicators.findIndex(button => button.getAttribute('aria-pressed') === 'true');
    const destinations = { ArrowLeft: Math.max(0, current - 1), ArrowRight: Math.min(statCards.length - 1, current + 1), Home: 0, End: statCards.length - 1 };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    scrollToCard(destinations[event.key]);
  });
  window.setInterval(() => {
    if (!mobile.matches && !reducedMotion.matches && site?.dataset.view === 'home' && !document.hidden) rotateStats();
  }, 4200);
}

function updatePaymentPlan(planId) {
  const inputs = [...document.querySelectorAll('input[name="payment-plan"]')];
  const selected = inputs.find(radio => radio.value === planId) || inputs[0];
  selected.checked = true;
  selectedPlan = selected.value;
  const single = selectedPlan === 'single';
  const price = `${selected.dataset.price}\u202f₽`;
  const sites = Number(selected.dataset.sites);
  document.querySelector('#payment-modal-title').textContent = single ? 'Полный отчёт по вашему сайту' : `Полные отчёты по ${sites} сайтам`;
  document.querySelector('[data-payment-price]').textContent = price;
  document.querySelector('[data-payment-scope]').textContent = `${single ? '1 сайт' : `До ${sites} сайтов`} · перепроверки на 30 дней`;
  document.querySelector('[data-payment-buy]').textContent = single ? `Получить отчёт за ${price}` : `Получить пакет за ${price}`;
  document.querySelector('[data-payment-options] summary').textContent = single ? 'Несколько сайтов? Выбрать тариф' : `До ${sites} сайтов · изменить тариф`;
  if (lockedReportLink) lockedReportLink.textContent = single ? `Получить полный отчёт за ${price}` : `Получить пакет за ${price}`;
}

function openPaymentModal(planId = 'single') {
  paymentFocus = document.activeElement;
  paymentHint && (paymentHint.textContent = "Проверяем доступность оплаты…");
  paymentModal?.classList.add("is-open");
  paymentModal?.setAttribute("aria-hidden", "false");
  if (site) site.inert = true;
  updatePaymentPlan(planId);
  document.querySelector('[data-payment-buy]')?.focus();
  refreshPaymentConfig().then(()=>{
    if(paymentHint)paymentHint.textContent=paymentMode==="test"?"Тестовый режим ЮKassa: используйте тестовую карту, реальные деньги не списываются.":"Оплата временно недоступна. Попробуйте позже.";
  }).catch(()=>{if(paymentHint)paymentHint.textContent="Не удалось проверить доступность оплаты. Повторите попытку.";});
}

function closePaymentModal() {
  if (!paymentModal?.classList.contains('is-open')) return;
  paymentModal?.classList.remove("is-open");
  paymentModal?.setAttribute("aria-hidden", "true");
  if (site) site.inert = false;
  paymentFocus?.focus();
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
  if (check.status === "review") return "Нет данных";
  if (state.tab === "growth") return check.severity === "high" ? "Приоритет" : "Исправить";
  return Number(check.fineMax) > 0 ? `До ${formatRub(check.fineMax)}` : "Недостаток";
}

function getIssueText(check) {
  const evidence = String(check.evidence || "").trim();
  const fix = String(check.fix || "").trim();

  if (check.status === "review") {
    return evidence;
  }

  return evidence || fix || "Проверка нашла проблему, которую стоит исправить.";
}

function getIssueTitle(check) {
  const titles = {
    "form-consent": "У форм не найдено отдельное согласие",
    "company-details": "Реквизиты не найдены или требуют исправления",
    "offer-return": "Не найдены полные условия заказа и возврата",
    "consent-document": "У формы нет доступного текста согласия",
    "policy-purposes": "В политике не найдены цели и основания обработки",
    "policy-data": "В политике не описаны категории данных",
    "policy-retention": "В политике не найдены сроки хранения данных",
    "policy-rights": "В политике не описаны права и отзыв согласия",
    "policy-contact": "В политике не найден контакт для обращений",
    "payment-docs": "Не найден опубликованный порядок оплаты",
    "document-links": "Ссылки на юридические документы не работают"
  };
  return check.status === "failed" ? titles[check.id] || check.title : check.title;
}

function getCheckDetailsHtml(check) {
  const locations=Array.isArray(check.locations)?check.locations:[];
  const details=Array.isArray(check.details)?check.details:[];
  if(!locations.length&&!details.length)return '';
  const rows=locations.map(item=>{
    let url;try{url=new URL(item.url);if(!['http:','https:'].includes(url.protocol))return '';}catch{return '';}
    const numbers=Array.isArray(item.forms)?item.forms.join(', '):'';
    return `<li><a href="${escapeHtml(url.href)}" target="_blank" rel="noopener">${escapeHtml(url.hostname+url.pathname)}</a>${numbers?`<br>Формы: ${escapeHtml(numbers)}`:''}</li>`;
  }).join('')+details.map(item=>`<li>${escapeHtml(item)}</li>`).join('');
  return `<details class="issue-details"><summary>${locations.length?'Где обнаружено':'Подробнее о проверке'}</summary><ul>${rows}</ul></details>`;
}

function renderTabs() {
  tabs.forEach((button) => {
    const isActive = button.dataset.resultTab === state.tab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    const seo=button.dataset.resultTab==='growth';
    const count=seo?(state.audit?.summary?.seoIssues??state.audit?.access?.totalSeo):(state.audit?.summary?.legalIssues??state.audit?.access?.totalLegal);
    button.textContent=(seo?'SEO':'Штрафы')+(Number.isFinite(count)?` · ${count}`:'');
  });
}

function renderHero() {
  if (resultUrl) { resultUrl.textContent = state.checkedUrl; resultUrl.title = state.checkedUrl; }

  const checks = Array.isArray(state.audit?.checks) ? state.audit.checks : [];
  const group = state.tab === "growth" ? "seo" : "legal";
  const groupChecks = checks.filter(check=>check.group===group);
  const count = group === "legal" ? (state.audit?.summary?.legalIssues ?? state.audit?.access?.totalLegal ?? groupChecks.filter(c=>c.status==='failed').length) : (state.audit?.summary?.seoIssues ?? state.audit?.access?.totalSeo ?? groupChecks.filter(c=>c.status==='failed').length);
  const review = groupChecks.filter((check) => check.status === "review");
  const skipped = groupChecks.filter((check) => check.status === "skipped").length;
  const fineMax = Number(state.audit?.summary?.fineMax) || 0;
  const fineMin = state.audit?.summary?.fineMin;

  if (resultTitle) {
    if (state.audit?.warning) {
      resultTitle.textContent = "Нужна ручная проверка";
    } else if (count > 0) {
      const noun = plural(count, ["проблема", "проблемы", "проблем"]);
      const single = count % 10 === 1 && count % 100 !== 11;
      const finding = document.createElement('span');
      finding.textContent = `${single ? "Найдена" : "Найдено"} ${count} ${noun}`;
      const category = document.createElement('span');
      category.textContent = group === "seo" ? "по SEO" : "по штрафам";
      resultTitle.replaceChildren(finding, category);
    } else {
      resultTitle.textContent = group === "seo" ? "SEO-проблем не найдено" : "Явных проблем по штрафам не найдено";
    }
  }

  if (riskLabel) riskLabel.textContent = "Общий риск штрафов:";
  if (riskValue) riskValue.textContent = fineMax > 0 ? (Number.isFinite(fineMin) && fineMin > 0 && fineMin <= fineMax ? `${formatRub(fineMin)} – ${formatRub(fineMax)}` : "Требует уточнения") : "";
  if (riskValue?.parentElement) riskValue.parentElement.hidden = group !== "legal" || fineMax === 0;
  const explanation = document.querySelector('.risk-explanation');
  if (explanation) {
    explanation.hidden = group !== 'legal' || fineMax === 0;
    explanation.querySelector('p').textContent = state.audit?.summary?.fineExplanation || state.audit?.summary?.fineBasis || '';
  }
  const summary = document.querySelector(".audit-summary");
  const hidden=Number(group==='legal'?state.audit?.access?.hiddenLegal:state.audit?.access?.hiddenSeo)||0;
  if (summary) summary.textContent = `${group === "legal" ? "Юридическая проверка" : "SEO-проверка"}: ${groupChecks.length + hidden - skipped} пунктов. Найдено проблем: ${count}. Успешно: ${groupChecks.filter(c=>c.status==='passed').length}.${review.length?` Не удалось установить: ${review.length}.`:''}`;
  const scope = document.querySelector(".audit-scope");
  if (scope) scope.textContent = [state.audit?.scope, group === "legal" && fineMax > 0 ? state.audit?.summary?.fineBasis : ""].filter(Boolean).join(" ");
}

function getSeoOverviewHtml(checks) {
  if (state.tab !== "growth") return "";

  const allChecks = Array.isArray(state.audit?.checks) ? state.audit.checks : [];
  const seoChecks = allChecks.filter((check) => check.group === "seo");
  const failed = state.audit?.summary?.seoIssues ?? state.audit?.access?.totalSeo ?? seoChecks.filter((check) => check.status === "failed").length;
  const review = seoChecks.filter((check) => check.status === "review").length;
  const locked = Number(state.audit?.access?.hiddenSeo)||0;
  const openedNow = failed-locked;
  const checkedCount=seoChecks.length+locked;
  const score = checkedCount ? Math.round(100 * seoChecks.filter(c=>c.status === "passed").length / checkedCount) : 0;

  return `
    <section class="seo-overview" aria-label="SEO-сводка">
      <div class="seo-overview__head">
        <div>
          <span class="seo-overview__eyebrow">SEO-аудит</span>
          <h3>Базовая проверка видимости сайта</h3>
          <p>${locked?'Открыты первые 3 проблемы. Полный аудит за 179 ₽ раскроет остальные и добавит рекомендации по исправлению.':'Все найденные SEO-проблемы этого раздела открыты.'} Оценка показывает долю пройденных проверок, а не место сайта в поиске.</p>
        </div>
        <div class="seo-overview__score">
          <strong>${score}</strong>
          <span>из 100</span>
        </div>
      </div>
      <div class="seo-overview__cards">
        <div><span>Проверено пунктов</span><strong>${checkedCount}</strong></div>
        <div><span>Найдено проблем</span><strong>${failed}</strong></div>
        <div><span>Открыто проблем</span><strong>${openedNow} / ${failed}</strong></div>
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
  const seo=state.tab==='growth';
  const ownCount = Number(seo?state.audit?.access?.hiddenSeo:state.audit?.access?.hiddenLegal) || 0;
  const otherCount = Number(seo?state.audit?.access?.hiddenLegal:state.audit?.access?.hiddenSeo) || 0;
  const count = items ? ownCount || otherCount : 0;
  const locked = !state.reportUnlocked && count > 0;
  lockedReport.classList.toggle("is-hidden", !locked);
  lockedReport.classList.remove("is-transparent");
  if (!locked) { if (lockedItems) lockedItems.innerHTML=""; return; }
  // Generic shapes indicate locked findings without embedding private report data.
  if (lockedItems) lockedItems.innerHTML = Array.from({length:Math.min(count,3)},()=>'<div class="locked-item"><div class="locked-placeholder-title">Пункт полного отчёта</div><div class="locked-placeholder-copy">Доказательства и рекомендации</div><div class="locked-shape"></div></div>').join("");
  const hiddenGroup=ownCount?(seo?'SEO':'по штрафам'):(seo?'по штрафам':'SEO');
  if (lockedReportTitle) lockedReportTitle.textContent = `Ещё ${count} ${plural(count,["проблема","проблемы","проблем"])} ${hiddenGroup} в полном аудите`;
  if (lockedReportText) lockedReportText.textContent = ownCount ? 'Где обнаружены проблемы и как их исправить — в полном отчёте.' : 'Этот раздел открыт. Остальные проблемы и рекомендации — в полном отчёте.';
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
    renderLockedReport(state.reportUnlocked || state.audit?.warning ? null : true);
    issueList.append(lockedReport);
    renderPassedChecks();
    return;
  }

  const visibleChecks = checks.filter(check=>check.status==='failed');
  const failedCount = checks.filter(c=>c.status==='failed').length;
  const reviewCount = checks.filter(c=>c.status==='review').length;
  issueList.innerHTML =
    seoOverviewHtml +
    visibleChecks
    .map((check,index) => {
      const riskClass = check.status === "review" ? "is-review" : "";
      const sectionTitle = index===0 && failedCount ? '<h3 class="issue-section-title">Найденные проблемы</h3>' : '';

      return `
        ${sectionTitle}
        <article class="issue-entry" aria-labelledby="issue-title-${escapeHtml(check.id)}">
          <header class="issue-entry__head">
            <h3 id="issue-title-${escapeHtml(check.id)}">${escapeHtml(getIssueTitle(check))}</h3>
            <div class="risk ${riskClass}"><span aria-hidden="true">!</span> ${escapeHtml(getPillText(check))}</div>
          </header>
          <div class="issue-entry__body">
            <div class="issue-finding"><h4>Что найдено</h4><p>${escapeHtml(getIssueText(check))}</p></div>
            ${check.fix ? `<div class="issue-action"><h4>Как исправить</h4><p>${escapeHtml(check.fix)}</p></div>` : ""}
            ${getCheckDetailsHtml(check)}
            ${check.law || check.condition ? `<details class="issue-basis"><summary>Правовое основание и ограничения</summary>
              ${check.law ? `<p>${escapeHtml(check.law)}${check.source ? ` · <a href="${escapeHtml(check.source)}" target="_blank" rel="noopener">Источник</a>` : ""}</p>` : ""}
              ${check.condition ? `<p>${escapeHtml(check.condition)}</p>` : ""}
            </details>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  renderLockedReport(state.reportUnlocked || state.audit?.warning ? null : true);
  issueList.append(lockedReport);
  updatePaymentPlan(selectedPlan);
  const reviews=checks.filter(check=>check.status==='review');
  if(reviewCount)issueList.insertAdjacentHTML('beforeend',`<details class="audit-limitations"><summary>Что не удалось установить автоматически — ${reviewCount}</summary><p>Эти пункты не входят в число найденных проблем и не продаются как нарушения. Здесь указано, каких данных не хватает для вывода.</p>${reviews.map(check=>`<article><h3>${escapeHtml(check.title)}</h3><p>${escapeHtml(check.evidence)}</p>${check.fix?`<p><strong>Для точного вывода:</strong> ${escapeHtml(check.fix)}</p>`:''}</article>`).join('')}</details>`);
  renderPassedChecks();
}

function renderResult() {
  renderTabs();
  renderHero();
  renderIssueList();
}

function renderError(url, message) {
  document.querySelectorAll('[data-report-download], [data-report-print], [data-report-link], [data-report-refresh], [data-report-email], .report-payment-status').forEach(el => { el.hidden = true; });
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
  if(auditRequest)return;
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
  const controller=new AbortController();auditRequest=controller;

  try {
    const response = await fetch('/api/audit', {
      method: 'POST', headers: { Accept: "application/x-ndjson", 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, profile: 'lead', consent: policyCheckbox.checked }), signal:controller.signal
    });
    const audit = await readAuditResponse(response, updateAuditProgress);

    state.audit = audit;
    state.tab = "fines";
    state.reportUnlocked = audit.access?.full === true;
    const download=document.querySelector('[data-report-download]');
    if(download) download.hidden=!audit.reportToken;
    document.querySelector('[data-report-print]').hidden=!audit.reportToken;
    document.querySelector('[data-report-link]').hidden=!audit.reportToken;
    const status=document.querySelector('.report-payment-status');
    status.hidden=!audit.paid;
    status.classList.toggle('is-paid',Boolean(audit.paid));
    document.querySelector('[data-report-email]').hidden=true;
    status.textContent=audit.paid?paidAccessText(audit.domainAccess):'';
    document.querySelector('[data-report-refresh]').hidden=true;
    if (!startPlanAfterAudit) selectedPlan = 'single';
    renderResult();
    showView("result");
    if (audit.paid) await restoreReport(audit.reportToken);
    refreshAccess().catch(()=>{});
    if (startPlanAfterAudit && !audit.paid && audit.reportToken && (!state.reportUnlocked || selectedPlan !== 'single')) openPaymentModal(selectedPlan);
    startPlanAfterAudit = false;
  } catch (error) {
    if(error.name==='AbortError')return;
    renderError(url, error.message || "Проверка временно недоступна");
    showView("result");
  } finally {
    if(auditRequest===controller)auditRequest=null;
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
  openPaymentModal(selectedPlan);
});

document.querySelectorAll("[data-payment-close]").forEach((button) => {
  button.addEventListener("click", closePaymentModal);
});

document.querySelector("[data-payment-buy]")?.addEventListener("click", () => {
  startTestPayment();
});

document.querySelectorAll('input[name="payment-plan"]').forEach(radio => {
  radio.addEventListener('change', () => updatePaymentPlan(radio.value));
});

document.querySelector("[data-payment-terms]")?.addEventListener("click", () => {
  closePaymentModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePaymentModal();
  if (event.key === 'Tab' && paymentModal?.classList.contains('is-open')) {
    const controls = [...paymentModal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), summary')].filter(control => control.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

document.querySelectorAll(".js-home, .back-home, .logo, .nav a[href^='#'], .site-header__pricing, .footer-inner a[href^='#']").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showView("home");
    const hash=link.getAttribute('href');
    history.replaceState(null,'',hash&&hash!=='#'?'/'+hash:'/');
    if(hash&&hash!=='#')requestAnimationFrame(()=>document.getElementById(hash.slice(1))?.scrollIntoView({behavior:'smooth',block:'start'}));
  });
});

initStatsSlider();

function redirectLegacyPaymentTerms() {
  if (window.location.hash === '#payment-terms') window.location.replace('/terms.html#payment-terms');
}
redirectLegacyPaymentTerms();
window.addEventListener('hashchange', redirectLegacyPaymentTerms);

function renderPassedChecks() {
  const passed = (state.audit?.checks || []).filter(c => c.status === "passed" && c.group === (state.tab === "growth" ? "seo" : "legal"));
  document.querySelector(".passed-checks")?.remove();
  if (passed.length) issueList?.insertAdjacentHTML("beforeend", `<details class="passed-checks"><summary>Успешные проверки: ${passed.length}</summary>${passed.map(c=>`<div><strong>${escapeHtml(c.title)}</strong><p>${escapeHtml(c.evidence)}</p></div>`).join("")}</details>`);
}
let paymentMode = "unavailable";
async function refreshPaymentConfig(){
  const response=await fetch("/api/config",{cache:"no-store"});
  if(!response.ok)throw new Error("Оплата недоступна");
  const config=await response.json();paymentMode=config.paymentMode;return config;
}
refreshPaymentConfig().catch(()=>{});

async function startTestPayment() {
  const button = document.querySelector("[data-payment-buy]");
  if (!state.audit?.reportToken) { paymentHint.textContent = "Сначала проверьте сайт."; return; }
  button.disabled = true;
  paymentHint.textContent = "Готовим тестовый платёж…";
  try {
    selectedPlan = document.querySelector('input[name="payment-plan"]:checked')?.value || 'single';
    const response = await fetch("/api/payments", { method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify({reportToken:state.audit.reportToken,planId:selectedPlan}) });
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
  if(!paymentPolling&&site?.dataset.view==='home')return result;
  state.audit = result.audit;
  state.checkedUrl = result.audit.url;
  state.reportUnlocked = result.paid || result.audit.access?.full === true;
  renderResult(); showView("result");
  const note = document.querySelector(".report-payment-status");
  if (note) {
    note.hidden = !result.paid && state.reportUnlocked && !result.canceled && !result.paymentPending;
    note.classList.toggle('is-paid',Boolean(result.paid));
    note.textContent = result.paid ? paidAccessText(result.domainAccess) : result.canceled ? "Оплата отменена. Полный отчёт не открыт; предварительный отчёт сохранён. Можно повторить оплату." : result.paymentPending ? "Оплата ещё не подтверждена. Пока доступен предварительный отчёт. Полный отчёт откроется после подтверждения платежа; можно проверить статус ещё раз." : state.reportUnlocked ? '' : "Предварительный отчёт сохранён. Полный отчёт за 179 ₽ включает перепроверки этого сайта на 30 дней.";
  }
  document.querySelector('[data-report-email]').hidden=!result.reportEmailAvailable;
    document.querySelector("[data-report-refresh]").hidden = !result.paymentPending;
  document.querySelector("[data-report-download]").hidden = false;
  document.querySelector("[data-report-print]").hidden = false;
  document.querySelector("[data-report-link]").hidden = false;
  if(result.paid)refreshAccess().catch(()=>{});
  return result;
}
function paidAccessText(pass) {
  if(pass?.owned===false)return 'Полный отчёт открыт и останется доступным после окончания пакета. Для перепроверок восстановите пакет по личной ссылке покупателя в разделе «Мой доступ».';
  const until=pass?.expiresAt?new Date(pass.expiresAt).toLocaleDateString('ru-RU'):'';
  return `Полный отчёт открыт и останется доступным после окончания пакета. ${pass?.active?`Перепроверки добавленных сайтов включены до ${until}. ${pass.name}: использовано ${pass.used} из ${pass.limit} сайтов. Сохраните личную ссылку в разделе «Мой доступ» для других устройств.`:'Срок пакета закончился. Для новых проверок можно купить новый пакет; этот отчёт оплачивать повторно не нужно.'}`;
}

const accessDialog = document.querySelector('.access-dialog');
function renderAccessPasses() {
  const container=document.querySelector('[data-access-passes]');
  container.innerHTML=accessPasses.length?accessPasses.map((pass,index)=>`<section class="access-pass"><h3>${escapeHtml(pass.name)}</h3><p>${pass.active?`До ${new Date(pass.expiresAt).toLocaleDateString('ru-RU')} · ${pass.used} из ${pass.limit} сайтов`:'Пакет завершён. Сохранённые отчёты доступны.'}</p><p class="access-pass__domains">${pass.domains.map(escapeHtml).join(', ')}</p>${pass.reports.length?`<div class="access-pass__reports"><h4>Сохранённые отчёты · ${pass.reports.length}</h4>${pass.reports.map(report=>`<a href="/?report=${encodeURIComponent(report.token)}"><strong>Открыть отчёт</strong><span>${escapeHtml(report.url)}</span><span>${new Date(report.checkedAt).toLocaleString('ru-RU')}</span></a>`).join('')}</div>`:''}${pass.active?'<button type="button" data-access-check>Проверить сайт</button>':''}<button type="button" data-access-copy="${index}">Скопировать личную ссылку на пакет</button></section>`).join(''):'<p class="access-empty">В этом браузере пока нет оплаченного пакета. После оплаты он появится здесь. На другом устройстве откройте вашу личную ссылку доступа.</p>';
  const active=accessPasses.filter(pass=>pass.active);
  const remaining = active.reduce((sum,pass)=>sum+pass.remaining,0);
  document.querySelector('[data-access-status]').textContent=active.length?`Перепроверки включены · новых сайтов осталось: ${remaining}`:accessPasses.length?'Пакет завершён · сохранённые отчёты доступны':'Предварительная проверка бесплатна';
}
async function refreshAccess() {
  const response=await fetch('/api/access',{cache:'no-store'});
  if(!response.ok)throw new Error('Не удалось загрузить доступ. Попробуйте позже.');
  accessPasses=(await response.json()).passes||[];renderAccessPasses();
}
async function restoreAccess(token) {
  const response=await fetch('/api/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Не удалось восстановить доступ');
  await refreshAccess();return data.pass;
}
async function openSavedReport(token) {
  paymentPolling=true;
  state.tab='fines';
  accessDialog.close();
  showView('loading','Загружаем сохранённый отчёт');
  await restoreReport(token);
  if(paymentPolling)history.replaceState(null,'','/?report='+encodeURIComponent(token));
}
async function openAccessDestination(pass) {
  const saved=Array.isArray(pass.reports)?pass.reports:[];
  if(saved.length===1) {
    await openSavedReport(saved[0].token);
    return;
  }
  showView('home');
  accessDialog.showModal();
  document.querySelector('[data-access-message]').textContent=saved.length?'Выберите сохранённый отчёт. Вводить адрес сайта повторно не нужно.':'Доступ восстановлен. Нажмите «Проверить сайт», чтобы получить первый отчёт.';
}
document.querySelectorAll('[data-access-open]').forEach(button=>button.addEventListener('click',()=>{
  accessDialog.showModal();refreshAccess().catch(error=>document.querySelector('[data-access-message]').textContent=error.message);
}));
document.querySelector('[data-access-close]').addEventListener('click',()=>accessDialog.close());
document.querySelector('[data-access-passes]').addEventListener('click',async(event)=>{
  if(event.target.closest('[data-access-check]')){
    accessDialog.close();showView('home');form.scrollIntoView({behavior:'smooth',block:'center'});input.focus({preventScroll:true});return;
  }
  const button=event.target.closest('[data-access-copy]');if(!button)return;
  const link=new URL(accessPasses[Number(button.dataset.accessCopy)].accessUrl,location.origin).href;
  try{await navigator.clipboard.writeText(link);document.querySelector('[data-access-message]').textContent='Личная ссылка скопирована. Она восстанавливает весь пакет: не передавайте её посторонним.';}
  catch{document.querySelector('[data-access-message]').textContent='Ваша личная ссылка: '+link;}
});
document.querySelector('[data-access-restore]').addEventListener('submit',async(event)=>{
  event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
  const button=form.querySelector('button');button.disabled=true;
  try{
    const link=new URL(form.elements.link.value.trim());
    if(link.origin!==location.origin)throw new Error('Укажите личную ссылку с этого сайта.');
    const token=link.searchParams.get('access')||link.searchParams.get('report');
    if(!/^[a-f0-9]{48}$/.test(token||''))throw new Error('В ссылке не найден ключ доступа. Скопируйте её целиком.');
    form.reset();
    if(link.searchParams.get('access'))await openAccessDestination(await restoreAccess(token));
    else await openSavedReport(token);
  }catch(error){showView('home');accessDialog.showModal();document.querySelector('[data-access-message]').textContent=error.message;}
  finally{button.disabled=false;}
});
document.querySelectorAll('[data-plan-start]').forEach(button=>button.addEventListener('click',()=>{
  selectedPlan=button.dataset.planStart;startPlanAfterAudit=true;showView('home');
  form.scrollIntoView({behavior:'smooth',block:'center'});input.focus({preventScroll:true});
}));
const accessToken=new URLSearchParams(location.search).get('access');
const returnToken = new URLSearchParams(window.location.search).get("report");
if(/^[a-f0-9]{48}$/.test(accessToken||'')&&!returnToken){
  history.replaceState(null,'','/');
  showView('loading','Восстанавливаем доступ');
  restoreAccess(accessToken).then(openAccessDestination).catch(error=>{showView('home');accessDialog.showModal();document.querySelector('[data-access-message]').textContent=error.message;});
}else refreshAccess().catch(()=>{});
if (/^[a-f0-9]{48}$/.test(returnToken || "")) (async()=>{
  showView('loading', 'Загружаем сохранённый отчёт');
  for(let attempt=0;attempt<7&&paymentPolling;attempt++){
    const result=await restoreReport(returnToken);
    if(result.paid&&/^[a-f0-9]{48}$/.test(accessToken||'')){
      const restoredPass=await restoreAccess(accessToken);
      document.querySelector('.report-payment-status').textContent=paidAccessText(restoredPass);
      history.replaceState(null,'','/?report='+returnToken);
    }
    if(result.paid||result.canceled||!result.paymentPending)break;
    if(attempt<6)await new Promise(resolve=>setTimeout(resolve,5000));
  }
})().catch(error=>{showView("result");document.querySelector(".report-payment-status").hidden=false;document.querySelector(".report-payment-status").textContent=error.message;});
document.querySelector('[data-report-print]')?.addEventListener('click',()=>{
  if(!state.reportUnlocked){openPaymentModal();return;}
  document.querySelector('.print-report')?.remove();
  const report=document.createElement('section');report.className='print-report';
  report.innerHTML=KinavaReport.reportBody(state.audit);
  document.body.append(report);window.print();
});
window.addEventListener('afterprint',()=>document.querySelector('.print-report')?.remove());
document.querySelector('[data-report-link]')?.addEventListener('click',async()=>{
  const token=state.audit?.reportToken;
  if(!token)return;
  const url=new URL('/?report='+token,location.origin).href;
  try{await navigator.clipboard.writeText(url);showToast('Ссылка скопирована. Она даёт доступ к этому отчёту — храните её у себя.');}catch{showToast('Не удалось скопировать автоматически. Ссылка на отчёт: '+url,0);}
});
document.querySelector("[data-report-refresh]")?.addEventListener("click",()=>restoreReport(state.audit?.reportToken || returnToken).catch(error=>showToast(error.message)));
document.querySelector('[data-report-email]')?.addEventListener('submit',async(event)=>{
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector('button');
  const status=form.querySelector('.report-email__status');
  if(button.disabled||!form.reportValidity()||!state.reportUnlocked)return;
  button.disabled=true;form.setAttribute('aria-busy','true');status.textContent='Отправляем отчёт…';
  try{
    const response=await fetch('/api/report/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reportToken:state.audit.reportToken,email:form.elements.email.value.trim()})});
    const result=await response.json();
    if(!response.ok||!result.sent)throw new Error(result.error||'Не удалось отправить письмо. Скачайте отчёт или попробуйте позже.');
    status.textContent=result.alreadySent?'Письмо уже отправлено на этот адрес. Проверьте входящие и папку «Спам».':'Письмо отправлено. Проверьте входящие и папку «Спам».';
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;form.removeAttribute('aria-busy');}
});
document.querySelector("[data-report-download]")?.addEventListener("click",()=>{
  if (!state.reportUnlocked) {openPaymentModal();return;}
  const audit=state.audit;
  const content=KinavaReport.reportHtml(audit);
  const url=URL.createObjectURL(new Blob([content],{type:"text/html;charset=utf-8"}));const anchor=document.createElement("a");anchor.href=url;anchor.download="kinavapro-report.html";document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
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
