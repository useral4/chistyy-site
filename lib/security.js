const {createHash} = require('node:crypto');

function headers(req, res) {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://mc.yandex.ru https://mc.yandex.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://mc.yandex.ru https://mc.yandex.com; font-src 'self'; connect-src 'self' https://mc.yandex.ru https://mc.yandex.com; frame-src https://mc.yandex.ru https://mc.yandex.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  const host = req.headers.host || '';
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function staticHeaders(req, res, pathname, data, privatePage) {
  if (privatePage) { res.setHeader('Cache-Control', 'no-store'); return false; }
  const etag = '"' + createHash('sha256').update(data).digest('hex').slice(0, 32) + '"';
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public, max-age=3600, must-revalidate' : 'public, max-age=0, must-revalidate');
  if (String(req.headers['if-none-match'] || '').split(/,\s*/).includes(etag)) { res.writeHead(304); res.end(); return true; }
  return false;
}

module.exports = {headers, staticHeaders};
