function reportText(audit) {
  const statuses = { failed: 'Проблема', passed: 'Проверка пройдена', review: 'Нужна ручная проверка', skipped: 'Не применялась' };
  return [
    `Отчёт KinavaPro: ${audit.url}`, `Дата проверки: ${audit.checkedAt || ''}`,
    audit.scope || '', audit.summary?.fineBasis || '',
    ...audit.checks.map(check => [
      `\n${check.title} — ${statuses[check.status] || check.status}`, check.evidence || '',
      ...(check.locations || []).map(item => `${item.url}${item.forms?.length ? ` — формы: ${item.forms.join(', ')}` : ''}`),
      ...(check.details || []), check.fix ? `Как исправить: ${check.fix}` : '',
      check.law || '', check.condition || '', check.source || ''
    ].filter(Boolean).join('\n'))
  ].filter(Boolean).join('\n');
}
module.exports = { reportText };
