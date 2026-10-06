const steps = new Set(['page', 'robots', 'sitemap', 'resources', 'browser', 'analysis', 'save']);

function createAuditProgress(res) {
  const completed = new Set();
  let message = 'Загружаем главную страницу';
  const write = event => {
    if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n');
  };
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  const update = next => {
    if (next) message = next;
    write({type: 'progress', completed: completed.size, total: steps.size, message});
  };
  update();
  return {
    update,
    complete(step, next) {
      if (!steps.has(step)) throw new Error('Unknown audit step');
      completed.add(step);
      update(next);
    },
    finish(status, payload) {
      write(status >= 400 ? {type: 'error', error: payload.error} : {type: 'result', audit: payload});
      if (!res.writableEnded) res.end();
    }
  };
}

module.exports = {createAuditProgress};
