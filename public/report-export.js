(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KinavaReport = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  const statuses = {failed:'Проблема', passed:'Проверка пройдена', review:'Нужна ручная проверка', skipped:'Не применялась'};
  const groups = [['legal', 'Юридические риски'], ['seo', 'SEO-проверка']];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const rub = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  function date(value) {
    const parsed = new Date(value);
    return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('ru-RU', {timeZone:'Europe/Moscow'}) + ' (МСК)' : String(value || 'Не указана');
  }
  function risk(summary = {}) {
    if (!(summary.fineMax > 0)) return '';
    return Number.isFinite(summary.fineMin) && summary.fineMin > 0 && summary.fineMin <= summary.fineMax
      ? `${rub(summary.fineMin)} – ${rub(summary.fineMax)}` : `До ${rub(summary.fineMax)}; нижняя граница требует уточнения`;
  }
  function details(check) {
    return [...new Set([
      ...(check.locations || []).map(item => `${item.url}${item.forms?.length ? ` — формы: ${item.forms.join(', ')}` : ''}`),
      ...(check.details || [])
    ])];
  }
  function sourceLink(value) {
    try {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return `<a href="${escape(url.href)}" rel="noreferrer noopener">${escape(value)}</a>`;
    } catch {}
    return escape(value);
  }
  function reportText(audit) {
    const sections = [
      'KINAVAPRO — ОТЧЁТ О ПРОВЕРКЕ САЙТА',
      `Сайт: ${audit.url}\nДата проверки: ${date(audit.checkedAt)}`,
      'КРАТКИЙ ИТОГ',
      `Юридические проблемы: ${audit.summary?.legalIssues ?? audit.checks.filter(c=>c.group==='legal'&&c.status==='failed').length}\nSEO-проблемы: ${audit.summary?.seoIssues ?? audit.checks.filter(c=>c.group==='seo'&&c.status==='failed').length}`,
      risk(audit.summary) ? `Общий риск штрафов: ${risk(audit.summary)}` : '',
      audit.summary?.fineExplanation || audit.summary?.fineBasis || '',
      audit.scope ? `ЧТО ПРОВЕРЕНО\n${audit.scope}` : ''
    ];
    for (const [group, label] of groups) {
      const checks = audit.checks.filter(c=>c.group===group);
      if (!checks.length) continue;
      sections.push(label.toUpperCase());
      checks.forEach((check, index) => sections.push([
        `${index+1}. ${check.title}\nСтатус: ${statuses[check.status] || check.status}`,
        Number(check.fineMax)>0 ? `Возможный предел по этому пункту: до ${rub(check.fineMax)}` : '',
        check.evidence ? `Что обнаружено:\n${check.evidence}` : '',
        details(check).length ? `Где обнаружено / подробности:\n${details(check).map(line=>'  - '+line).join('\n')}` : '',
        check.fix ? `Как исправить:\n${check.fix}` : '',
        check.law ? `Правовое основание: ${check.law}` : '',
        check.condition ? `Ограничения оценки: ${check.condition}` : '',
        check.source ? `Источник: ${check.source}` : ''
      ].filter(Boolean).join('\n\n')));
    }
    return sections.filter(Boolean).join('\n\n' + '----------------------------------------' + '\n\n') + '\n';
  }
  function reportBody(audit) {
    const summary = audit.summary || {};
    const problems = group => audit.checks.filter(c=>c.group===group&&c.status==='failed').length;
    return `<header><div class="brand">kinava<span>Pro</span></div><h1>Отчёт о проверке сайта</h1><p class="site">${sourceLink(audit.url)}</p><p class="muted">${escape(date(audit.checkedAt))}</p></header>
      <section class="overview"><h2>Краткий итог</h2><p>Юридические проблемы: <strong>${escape(summary.legalIssues ?? problems('legal'))}</strong> · SEO-проблемы: <strong>${escape(summary.seoIssues ?? problems('seo'))}</strong></p>
      ${risk(summary)?`<p class="risk">Общий риск штрафов: <strong>${escape(risk(summary))}</strong></p>`:''}
      ${summary.fineExplanation||summary.fineBasis?`<p class="note">${escape(summary.fineExplanation||summary.fineBasis)}</p>`:''}</section>
      ${audit.scope?`<section><h2>Что проверено</h2><p>${escape(audit.scope)}</p></section>`:''}
      ${groups.map(([group,label])=>{
        const checks = audit.checks.filter(c=>c.group===group);
        if (!checks.length) return '';
        return `<section><h2>${label}</h2>${checks.map((check,index)=>`<article><div class="status ${check.status==='failed'?'failed':check.status==='passed'?'passed':'review'}">${escape(statuses[check.status]||check.status)}</div><h3>${index+1}. ${escape(check.title)}</h3>
          ${Number(check.fineMax)>0?`<p class="fine">Возможный предел по этому пункту: <strong>до ${escape(rub(check.fineMax))}</strong></p>`:''}
          ${check.evidence?`<h4>Что обнаружено</h4><p>${escape(check.evidence)}</p>`:''}
          ${details(check).length?`<h4>Где обнаружено / подробности</h4><ul>${details(check).map(line=>`<li>${escape(line)}</li>`).join('')}</ul>`:''}
          ${check.fix?`<h4>Как исправить</h4><p>${escape(check.fix)}</p>`:''}
          ${check.law||check.condition||check.source?`<div class="basis">${check.law?`<p><strong>Правовое основание:</strong> ${escape(check.law)}</p>`:''}${check.condition?`<p>${escape(check.condition)}</p>`:''}${check.source?`<p>Источник: ${sourceLink(check.source)}</p>`:''}</div>`:''}</article>`).join('')}</section>`;
      }).join('')}<footer>kinavaPro · Автоматическая проверка не заменяет правовую оценку.</footer>`;
  }
  function reportHtml(audit) {
    return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Отчёт kinavaPro — ${escape(audit.url)}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#f4f5f6;color:#202020;font:16px/1.6 Arial,sans-serif}main{max-width:900px;margin:auto;padding:32px 24px}header{padding:28px;background:#1b1b1b;color:white;border-radius:8px}header a{color:white}.brand{font-size:28px;font-weight:600}.brand span{color:#fb4f61}h1{font-size:28px;line-height:1.25;margin:24px 0 12px}h2{font-size:24px;line-height:1.3;margin:0 0 16px}h3{font-size:20px;line-height:1.4;margin:8px 0 16px}h4{font-size:16px;margin:20px 0 6px}p{margin:8px 0;white-space:pre-line;overflow-wrap:anywhere}a{color:#9c1420;text-underline-offset:3px;overflow-wrap:anywhere}section{margin:32px 0}.overview{padding:24px 0;border-bottom:1px solid #c8c8c8}.risk{font-size:20px}.risk strong{display:block;color:#ae1520}.note,.basis{font-size:14px;color:#505050}.note{margin-top:20px}.muted{color:#dedede}.site{font-size:18px}article{margin:16px 0;padding:24px;background:white;border:1px solid #d5d5d5;border-radius:8px}.status{font-size:14px;font-weight:bold}.failed{color:#a71420}.passed{color:#196b38}.review{color:#735000}.fine{color:#a71420}.basis{margin-top:20px;padding-top:12px;border-top:1px solid #ddd}ul{padding-left:22px}li{margin:8px 0;overflow-wrap:anywhere}footer{border-top:1px solid #c8c8c8;padding-top:16px;font-size:14px;color:#505050}
      @media(max-width:480px){main{padding:16px}header,article{padding:20px}h1{font-size:24px}h2{font-size:22px}h3{font-size:18px}.risk{font-size:18px}}@media print{body{background:white}main{max-width:none;padding:0}header{background:white;color:#111;padding:0;border-radius:0}header a,.brand span{color:#111}.muted{color:#555}article{break-inside:avoid}h2,h3,h4{break-after:avoid}a{color:inherit}section{margin:24px 0}}
      </style></head><body><main>${reportBody(audit)}</main></body></html>`;
  }
  return {reportText, reportHtml, reportBody};
});
