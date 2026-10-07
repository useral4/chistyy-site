const {timingSafeEqual} = require('node:crypto');
const {monitorEventLoopDelay} = require('node:perf_hooks');

const delay = monitorEventLoopDelay({resolution: 20});
delay.enable();
const totals = {started: 0, completed: 0, failed: 0, canceled: 0, rejected: 0, durationSeconds: 0, downloadedBytes: 0};
let lastSuccess = 0;

function authorized(req, token = process.env.METRICS_TOKEN) {
  if (!token || token.length < 32) return false;
  const expected = Buffer.from('Bearer ' + token), supplied = Buffer.from(req.headers.authorization || '');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function finish(outcome, started, bytes = 0) {
  totals[outcome]++;
  totals.durationSeconds += (Date.now() - started) / 1000;
  totals.downloadedBytes += bytes;
  if (outcome === 'completed') lastSuccess = Date.now();
}

function metrics(queue) {
  const state = queue.snapshot(), memory = process.memoryUsage(), cpu = process.cpuUsage();
  const values = {
    kinava_audits_active: state.active, kinava_audits_waiting: state.waiting,
    kinava_audit_capacity: state.capacity, kinava_audit_queue_limit: state.limit,
    kinava_audits_started_total: totals.started, kinava_audits_completed_total: totals.completed,
    kinava_audits_failed_total: totals.failed, kinava_audits_canceled_total: totals.canceled,
    kinava_audits_rejected_total: totals.rejected, kinava_audit_duration_seconds_sum: totals.durationSeconds,
    kinava_audit_duration_seconds_count: totals.completed + totals.failed + totals.canceled,
    kinava_audit_downloaded_bytes_total: totals.downloadedBytes,
    kinava_last_success_timestamp_seconds: lastSuccess / 1000,
    kinava_process_resident_memory_bytes: memory.rss, kinava_process_heap_bytes: memory.heapUsed,
    kinava_process_cpu_seconds_total: (cpu.user + cpu.system) / 1000000,
    kinava_event_loop_delay_seconds: Number.isFinite(delay.mean) ? delay.mean / 1000000000 : 0,
    kinava_process_uptime_seconds: process.uptime()
  };
  return Object.entries(values).map(([name, value]) => `${name} ${value}`).join('\n') + '\n';
}

module.exports = {authorized, finish, metrics, totals};
