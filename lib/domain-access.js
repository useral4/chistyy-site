const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const reports = require('./reports');

const DAY = 86400000;
const plans = Object.freeze({
  __proto__: null,
  single: { id: 'single', name: 'Один сайт', price: '179.00', domains: 1, days: 30 },
  specialist: { id: 'specialist', name: 'Специалист', price: '390.00', domains: 10, days: 30 },
  agency: { id: 'agency', name: 'Агентство', price: '999.00', domains: 30, days: 30 }
});
const directory = path.join(reports.directory, 'passes');
const cookieName = 'kinava_access';
const valid = token => typeof token === 'string' && /^[a-f0-9]{48}$/.test(token);
const locks = new Map();

function domain(input) {
  const url = new URL(/^https?:\/\//i.test(String(input)) ? input : 'https://' + input);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid domain');
  return url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '') + (url.port ? ':' + url.port : '');
}

async function read(token) {
  if (!valid(token)) return null;
  try { return JSON.parse(await fs.readFile(path.join(directory, token + '.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function write(token, pass) {
  if (!valid(token)) throw new Error('Invalid access key');
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, token + '.' + randomUUID() + '.tmp');
  await fs.writeFile(temporary, JSON.stringify(pass), { mode: 0o600 });
  await fs.rename(temporary, path.join(directory, token + '.json'));
}

async function withLock(token, operation) {
  const previous = locks.get(token) || Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  locks.set(token, task);
  try { return await task; } finally { if (locks.get(token) === task) locks.delete(token); }
}

function credentials(req) {
  const value = String(req.headers?.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(cookieName + '='));
  if (!value) return [];
  return [...new Set(value.slice(cookieName.length + 1).split(',').filter(valid))].slice(-16);
}

function attach(req, res, token) {
  const tokens = [...credentials(req).filter(item => item !== token), token].slice(-16);
  const local = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers?.host || '');
  res.setHeader?.('Set-Cookie', `${cookieName}=${tokens.join(',')}; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax${local ? '' : '; Secure'}`);
}

function summary(pass, token, includeLink = true) {
  const plan = plans[pass.planId];
  const active = pass.expiresAt > Date.now();
  return {
    planId: plan.id, name: plan.name, limit: plan.domains, used: pass.domains.length,
    remaining: active ? Math.max(0, plan.domains - pass.domains.length) : 0,
    activatedAt: pass.activatedAt, expiresAt: pass.expiresAt, active, owned: includeLink,
    ...(includeLink ? { domains: pass.domains, reports: pass.history || [], accessUrl: '/?access=' + token } : {})
  };
}

// Package credentials are separate from shareable report links. Legacy receipts migrate once.
async function ensure(record, token) {
  if (!record.paid) return null;
  if (record.sourcePass) return read(record.sourcePass);
  const key = record.passToken || token;
  return withLock(key, async () => {
    const existing = await read(key);
    if (existing) return existing;
    const plan = plans[record.planId || 'single'];
    if (!plan) throw new Error('Unknown paid plan');
    const activatedAt = record.paidAt || record.createdAt;
    const pass = {
      planId: plan.id, activatedAt, expiresAt: activatedAt + plan.days * DAY,
      domains: reports.access(record.audit).full ? [] : [domain(record.audit.url)],
      history: [{ token, url: record.audit.url, checkedAt: record.audit.checkedAt || new Date(record.createdAt).toISOString() }]
    };
    await write(key, pass);
    return pass;
  });
}

async function status(req) {
  const entries = await Promise.all(credentials(req).map(async token => {
    const pass = await read(token);
    return pass ? summary(pass, token) : null;
  }));
  return { passes: entries.filter(Boolean) };
}

async function apply(record, token, req) {
  const key = domain(record.audit.url);
  const candidates = (await Promise.all(credentials(req).map(async id => ({ id, pass: await read(id) }))))
    .filter(item => item.pass && item.pass.expiresAt > Date.now())
    .sort((a, b) => Number(b.pass.domains.includes(key)) - Number(a.pass.domains.includes(key)) || a.pass.expiresAt - b.pass.expiresAt);
  for (const { id } of candidates) {
    const applied = await withLock(id, async () => {
      const pass = await read(id);
      if (!pass || pass.expiresAt <= Date.now()) return false;
      const known = pass.domains.includes(key);
      // A report that is already free does not consume a new domain slot.
      if (!known && (reports.access(record.audit).full || pass.domains.length >= plans[pass.planId].domains)) return false;
      if (!known) pass.domains.push(key);
      pass.history = [{ token, url: record.audit.url, checkedAt: record.audit.checkedAt }, ...(pass.history || []).filter(item => item.token !== token)].slice(0, 100);
      await write(id, pass);
      record.paid = true; record.paidAt = pass.activatedAt; record.sourcePass = id;
      await reports.write(token, record);
      return { ...summary(pass, id, false), owned: true };
    });
    if (applied) return applied;
  }
  return null;
}

async function restore(req, res, token) {
  if (!valid(token)) return null;
  let pass = await read(token);
  if (!pass) {
    const record = await reports.read(token);
    if (!record?.paid || record.sourcePass || record.passToken) return null;
    pass = await ensure(record, token);
  }
  attach(req, res, token);
  return summary(pass, token);
}

module.exports = { plans, domain, read, ensure, apply, status, restore, credentials, attach, summary };
