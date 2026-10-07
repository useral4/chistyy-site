const {test}=require('node:test');
const assert=require('node:assert/strict');
const {conditions}=require('../scripts/monitor');
const {authorized}=require('../lib/operations');
const fs=require('node:fs'),path=require('node:path');

test('Operator alerts distinguish healthy state, backlog, memory pressure and missing backups',()=>{
  const now=Date.now();
  assert.deepEqual(conditions('kinava_audits_waiting 0\nkinava_process_resident_memory_bytes 1000',true,now,now),[]);
  assert.equal(conditions('kinava_audits_waiting 5\nkinava_process_resident_memory_bytes 900000000',false,now-4000000,now).length,4);
  assert.equal(conditions('',true,undefined,now).length,1);
});

test('Metrics and worker authorization fail closed on missing, short or incorrect keys',()=>{
  assert.equal(authorized({headers:{}},''),false);
  assert.equal(authorized({headers:{authorization:'Bearer short'}},'short'),false);
  assert.equal(authorized({headers:{authorization:'Bearer '+'a'.repeat(48)}},'b'.repeat(48)),false);
  assert.equal(authorized({headers:{authorization:'Bearer '+'a'.repeat(48)}},'a'.repeat(48)),true);
});

test('VPS worker has no customer volumes, runs non-root with sandbox and never publishes private ports',()=>{
  const root=path.join(__dirname,'..'),docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
  const worker=docker.slice(docker.indexOf('AS browser-worker'));
  assert.match(worker,/USER node/);
  assert.doesNotMatch(worker,/COPY (?:server|public|scripts|\.env)|COPY lib \.\/lib/);
  const compose=fs.readFileSync(path.join(root,'deploy/compose.yaml'),'utf8');
  const workerConfig=compose.slice(compose.indexOf('  worker:\n'),compose.indexOf('  database:\n'));
  assert.doesNotMatch(workerConfig,/env_file:|volumes:|ports:|YOOKASSA|SMTP|DATABASE_URL|SYS_ADMIN|unconfined/);
  assert.match(workerConfig,/read_only: true/);assert.match(workerConfig,/seccomp=/);
  assert.match(workerConfig,/mem_limit: 1536m/);assert.match(workerConfig,/cpus: 1\.0/);
  assert.match(fs.readFileSync(path.join(root,'lib/browser-audit.js'),'utf8'),/BROWSER_EXECUTABLE_PATH.*chromiumSandbox:true/);
  assert.match(fs.readFileSync(path.join(root,'deploy/Caddyfile'),'utf8'),/respond @operations 404/);
  const profile=JSON.parse(fs.readFileSync(path.join(root,'deploy/seccomp_profile.json'),'utf8'));
  assert.equal(profile.defaultAction,'SCMP_ACT_ERRNO');
});

test('Monitoring runs independently of a failed app, without restarting customer services',()=>{
  const root=path.join(__dirname,'..');
  const unit=fs.readFileSync(path.join(root,'deploy/kinavapro-monitor.service'),'utf8');
  assert.match(unit,/compose run --rm --no-deps -T monitor/);
  assert.doesNotMatch(unit,/compose exec.*app/);
  const compose=fs.readFileSync(path.join(root,'deploy/compose.yaml'),'utf8');
  assert.match(compose,/MONITOR_BASE_URL: http:\/\/app:4173/);
  const monitor=compose.slice(compose.indexOf('  monitor:\n'),compose.indexOf('\nvolumes:'));
  assert.doesNotMatch(monitor,/ipv4_address:|depends_on:|ports:/);
});

test('Application database credentials are separate from the database administrator',()=>{
  const root=path.join(__dirname,'..');
  const compose=fs.readFileSync(path.join(root,'deploy/compose.yaml'),'utf8');
  const app=compose.slice(compose.indexOf('  app:\n'),compose.indexOf('  worker:\n'));
  assert.match(app,/DATABASE_URL: postgres:\/\/kinava:\$\{APP_DATABASE_PASSWORD/);
  assert.doesNotMatch(app,/\$\{POSTGRES_PASSWORD/);
  assert.match(compose,/POSTGRES_USER: postgres/);
  assert.match(fs.readFileSync(path.join(root,'deploy/init-database.sh'),'utf8'),/NOSUPERUSER NOCREATEDB NOCREATEROLE/);
});
