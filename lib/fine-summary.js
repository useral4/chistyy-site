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
  return audit.summary ? { ...audit, summary: { ...audit.summary, ...summarizeFines(audit.checks) } } : audit;
}

module.exports = { summarizeFines, withFineRange };
