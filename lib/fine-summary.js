// First-offense corporate ranges, КоАП РФ 13.11 parts 1 and 3.
const ranges = {
  '13.11.1': { min: 150000, max: 300000 },
  '13.11.3': { min: 30000, max: 60000 }
};
const legacyGroups = {
  'privacy-policy': '13.11.3',
  'form-consent': '13.11.1',
  'cookie-consent': '13.11.1',
  'analytics-before-consent': '13.11.1'
};

function summarizeFines(checks) {
  const sanctions = new Map();
  for (const check of checks || []) {
    const max = Number(check.fineMax);
    if (check.group !== 'legal' || check.status !== 'failed' || !Number.isFinite(max) || max <= 0) continue;
    const group = check.sanctionGroup || legacyGroups[check.id] || check.id;
    const range = ranges[group];
    const min = range?.max === max ? range.min : null;
    const previous = sanctions.get(group);
    if (!previous || max > previous.max) sanctions.set(group, { min, max });
  }
  const values = [...sanctions.values()];
  return {
    fineMin: values.some(range => range.min === null) ? null : values.reduce((sum, range) => sum + range.min, 0),
    fineMax: values.reduce((sum, range) => sum + range.max, 0)
  };
}

function withFineRange(audit) {
  return audit.summary ? { ...audit, summary: { ...audit.summary, ...summarizeFines(audit.checks), fineExplanation: explainFines(audit.checks) } } : audit;
}

function explainFines(checks) {
  const groups = new Map();
  for (const check of checks || []) {
    if (check.group !== 'legal' || check.status !== 'failed' || !(Number(check.fineMax) > 0)) continue;
    const group = check.sanctionGroup || legacyGroups[check.id] || check.id;
    const previous = groups.get(group) || {count:0, max:0};
    groups.set(group, {count:previous.count+1, max:Math.max(previous.max, Number(check.fineMax))});
  }
  const rub = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  const rows = [...groups].map(([group, value]) => {
    const range = ranges[group];
    const amount = range?.max === value.max ? `${rub(range.min)} – ${rub(value.max)}` : `до ${rub(value.max)}`;
    const law = ranges[group] ? `КоАП РФ, ст. 13.11, ч. ${group.split('.').at(-1)}` : 'другое основание';
    const n = value.count;
    const noun = n%10===1&&n%100!==11?'пункт':n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?'пункта':'пунктов';
    return `${law}: ${n} ${noun} отчёта; в оценке учтено один раз, ${amount}.`;
  });
  return ['Суммы в карточках не складываются напрямую. В этой оценке согласие у формы, cookie-баннер и ранний запуск аналитики объединены по одному возможному основанию: ч. 1 ст. 13.11 КоАП РФ.', ...rows, 'Это оценочный сценарий для юридического лица при первом нарушении, а не назначенный штраф. Независимые эпизоды, повторность, правовое основание обработки и другие составы могут изменить сумму; их нужно оценивать отдельно.'].join('\n\n');
}

module.exports = { summarizeFines, withFineRange, explainFines };
