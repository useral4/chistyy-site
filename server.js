const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const { performance } = require("node:perf_hooks");
const { randomUUID } = require("node:crypto");
const { fetchText: safeFetchText } = require("./lib/safe-fetch");
const { enhanceAudit, collectResources } = require("./lib/audit-engine");
const { inspectBrowser } = require("./lib/browser-audit");
const reports = require("./lib/reports");
const domainAccess = require("./lib/domain-access");
const { handlePayments, publicConfig } = require("./lib/payments");
const { notifyLead } = require("./lib/mail");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const PROFILES = {
  lead: { label: "Сайт услуг" },
  shop: { label: "Интернет-магазин" },
  media: { label: "Медиа / блог" },
  b2b: { label: "B2B / SaaS" }
};

const LEGAL_SOURCES = [
  {
    title: "152-ФЗ «О персональных данных»",
    url: "https://ips.pravo.gov.ru/api/ips/legislation/document?baseid=None&hash=98490812b3409e2a8d78a11ca9010f434ea3d9250a11dbbdb78690cd5551bdd6"
  },
  {
    title: "ПП РФ №948 о данных по интернет-рекламе",
    url: "https://publication.pravo.gov.ru/document/0001202205270045"
  },
  {
    title: "КоАП РФ",
    url: "https://www.consultant.ru/document/cons_doc_LAW_34661/"
  }
];

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  if (requestUrl.pathname === "/index.html") {
    res.writeHead(301, {Location: "/" + requestUrl.search}); res.end(); return;
  }
  const requestedPath =
    requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  const safePath = path
    .normalize(requestedPath)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".html" && /^[a-f0-9]{16,64}$/i.test(process.env.YANDEX_VERIFICATION || "")) data = Buffer.from(data.toString("utf8").replace("</head>", `<meta name="yandex-verification" content="${process.env.YANDEX_VERIFICATION}" /></head>`));
    if (requestUrl.searchParams.has("report") || requestUrl.searchParams.has("access")) res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function normalizeTarget(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Введите адрес сайта");

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Поддерживаются только http и https адреса");
  }

  url.hash = "";
  return url;
}

async function fetchOptional(url) {
  try {
    const result = await safeFetchText(url, 5000);
    return result.ok ? result.text : "";
  } catch {
    return "";
  }
}

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&laquo;|&raquo;|&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function matchText(html, regex) {
  const match = html.match(regex);
  return match ? stripTags(match[1] || match[0]) : "";
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function makeCheck({
  id,
  group,
  title,
  passed,
  status = "",
  severity,
  fineMax = 0,
  law = "",
  evidence = "",
  fix = ""
}) {
  const resolvedStatus = status || (passed ? "passed" : "failed");

  return {
    id,
    group,
    title,
    status: resolvedStatus,
    severity,
    fineMax: resolvedStatus === "failed" ? fineMax : 0,
    law,
    evidence,
    fix
  };
}

function riskScore(checks) {
  const weights = { high: 14, medium: 9, low: 5 };
  return Math.max(
    0,
    100 -
      checks
        .filter((check) => check.status === "failed")
        .reduce((sum, check) => sum + weights[check.severity], 0)
  );
}

function recommendServices(checks, profile) {
  const failed = checks.filter((check) => check.status === "failed");
  const hasLegal = failed.some((check) => check.group === "legal");
  const hasSeo = failed.some((check) => check.group === "seo");
  const hasAds = failed.some((check) => check.id === "ad-marking");
  const isShop = profile === "shop";

  return [
    {
      id: "legal",
      title: "Правовой порядок",
      price: hasLegal ? "от 29 000 ₽" : "от 12 000 ₽",
      tag: hasLegal ? "первым делом" : "контроль",
      description: "Политика ПДн, согласия, cookie, реквизиты, оферта и повторная проверка.",
      items: [
        "Политика обработки персональных данных",
        "Согласия у всех форм",
        "Cookie-уведомление",
        "Реквизиты и базовые документы",
        "Повторная проверка после внедрения"
      ],
      active: hasLegal
    },
    {
      id: "ads",
      title: "Реклама без риска",
      price: hasAds ? "от 17 000 ₽" : "от 9 000 ₽",
      tag: hasAds ? "срочно" : "профилактика",
      description: "Маркировка рекламы, рекламодатель, ERID и чек-лист для размещений.",
      items: [
        "Проверка рекламных блоков",
        "Пометки «Реклама»",
        "Рекламодатель и ERID",
        "Чек-лист для подрядчиков",
        "Рекомендации по спорным местам"
      ],
      active: hasAds
    },
    {
      id: "seo",
      title: "SEO-основа",
      price: hasSeo ? "от 35 000 ₽" : "от 15 000 ₽",
      tag: hasSeo ? "рост заявок" : "индексация",
      description: "Метатеги, структура заголовков, alt, sitemap, robots и скорость сайта.",
      items: [
        "Title и description",
        "H1/H2 и структура страницы",
        "Alt-тексты изображений",
        "robots.txt и sitemap.xml",
        "Schema.org, Open Graph и скорость"
      ],
      active: hasSeo
    },
    {
      id: "full",
      title: isShop ? "Магазин под контролем" : "Полный порядок",
      price: isShop ? "от 79 000 ₽" : "от 69 000 ₽",
      tag: "лучший выбор",
      description: "Юридические документы, SEO-правки, отчёт и повторный аудит через 14 дней.",
      items: [
        "Все правовые исправления",
        "SEO и техническая база",
        "Приоритетный список задач",
        "Отчёт для команды",
        "Повторный аудит через 14 дней"
      ],
      active: hasLegal && hasSeo
    }
  ];
}

function analyzeHtml({ html, robots, sitemap, targetUrl, profile, timing }) {
  const lower = html.toLowerCase();
  const text = stripTags(html).toLowerCase();
  const finalUrl = timing.finalUrl || targetUrl.href;
  const profileConfig = PROFILES[profile] || PROFILES.lead;

  const title = matchText(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = matchText(
    html,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i
  );
  const h1Count = countMatches(html, /<h1\b/gi);
  const h2Count = countMatches(html, /<h2\b/gi);
  const imageCount = countMatches(html, /<img\b/gi);
  const imageAltCount = countMatches(html, /<img\b(?=[^>]*\balt=(["']).+?\1)[^>]*>/gi);
  const formCount =
    countMatches(html, /<form\b/gi) || countMatches(html, /<(input|textarea|select)\b/gi);
  const htmlKb = Math.round(Buffer.byteLength(html, "utf8") / 1024);
  const visibleTextLength = stripTags(html).length;
  const anchorMatches = Array.from(html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi));
  const internalLinkCount = anchorMatches.filter((match) => {
    const href = String(match[1] || "").trim();
    if (!href || /^(#|tel:|mailto:|javascript:)/i.test(href)) return false;
    try {
      return new URL(href, targetUrl.href).hostname.replace(/^www\./i, "") === targetUrl.hostname.replace(/^www\./i, "");
    } catch {
      return false;
    }
  }).length;

  const hasPrivacy = hasAny(lower, [
    /политик[аиуы][^<]{0,90}персональн/i,
    /политик[аиуы][^<]{0,90}конфиденциальност/i,
    /privacy policy/i,
    /personal data/i,
    /152[-\s]?фз/i
  ]);
  const hasConsent = hasAny(lower, [
    /соглас[^\s<]{0,20}[^<]{0,90}персональн/i,
    /обработк[аи][^<]{0,90}персональн/i,
    /checkbox[^>]+required/i,
    /required[^>]+checkbox/i,
    /consent/i
  ]);
  const hasAnalytics = hasAny(lower, [
    /ym\(/i,
    /gtag\(/i,
    /ga\(/i,
    /google-analytics/i,
    /googletagmanager/i,
    /metrika/i,
    /mc\.yandex\.ru/i,
    /facebook\.net\/.*fbevents/i,
    /fbq\(/i
  ]);
  const hasCookieStorageCode = hasAny(lower, [
    /document\.cookie/i,
    /localstorage/i,
    /sessionstorage/i,
    /cookie[_-]?(consent|notice|banner)/i,
    /cookies?\.set/i
  ]);
  const hasCookieText = hasAny(lower, [/cookie/i, /cookies/i, /куки/i]);
  const usesCookie = hasCookieStorageCode || hasAnalytics || hasCookieText;
  const hasCookieBanner = hasAny(lower, [
    /cookie[^<]{0,140}(accept|agree|соглас|принять|ок)/i,
    /(accept|agree|соглас|принять|ок)[^<]{0,140}cookie/i,
    /куки[^<]{0,140}(соглас|принять|ок)/i
  ]);
  const hasAdPlacementSignal = hasAny(lower, [
    /erid\s*[:=]?\s*[a-zа-я0-9_-]{6,}/i,
    /advertisement/i,
    /sponsored/i,
    /<[^>]+class=["'][^"']*(?:ad-|ads-|banner-ad|promo-banner)[^"']*["']/i,
    /(партн[её]рск|спонсорск)[^<]{0,120}(?:материал|публикац|размещ|ссылка|баннер)/i,
    /реклама[^<]{0,120}(?:erid|рекламодатель|партн[её]ра|спонсор|промокод|скидк[аи])/i
  ]);
  const hasAdServiceContext = hasAny(text, [
    /агентств[оа][^\.]{0,80}реклам/i,
    /контекстная реклама/i,
    /таргетированная реклама/i,
    /ведение вконтакте/i,
    /маркетинг/i,
    /рекламная рассылка/i
  ]);
  const hasAdComplianceContext = hasAny(text, [
    /маркировк[аи][^\.]{0,90}реклам/i,
    /нет[^\.]{0,90}маркировк[аи][^\.]{0,90}реклам/i,
    /риск[^\.]{0,90}(?:erid|реклам)/i,
    /штраф[^\.]{0,90}(?:erid|реклам)/i,
    /провер[а-яё]+[^\.]{0,90}(?:erid|реклам)/i
  ]);
  const hasErid = /erid\s*[:=]?\s*[a-zа-я0-9_-]{6,}/i.test(lower);
  const hasAdPlacement = hasAdPlacementSignal && !hasAdServiceContext && !hasAdComplianceContext;
  const needsAdReview = hasAdPlacementSignal && !hasAdPlacement && !hasErid;
  const hasCompanyInfo = hasAny(text, [
    /инн\s*\d{10,12}/i,
    /огрн\s*\d{13,15}/i,
    /ооо(?:\s|["«])/i,
    /ип(?:\s|["«])/i,
    /юридический адрес/i,
    /реквизит/i
  ]) || hasAny(lower, [/"taxid"\s*:\s*"\d{10,12}"/i, /"legalname"\s*:/i]);
  const hasOffer = hasAny(text, [
    /оферта/i,
    /публичная оферта/i,
    /возврат/i,
    /условия оплаты/i,
    /доставка/i,
    /правила продажи/i
  ]);
  const hasOperatorNotice = hasAny(text, [
    /роскомнадзор/i,
    /уведомлени[ея][^<]{0,80}оператор/i,
    /реестр операторов/i
  ]);
  const hasChildrenData = hasAny(text, [/детск/i, /реб[её]н/i, /несовершеннолет/i]);
  const hasPaymentTerms = hasAny(text, [/оплат/i, /эквайринг/i, /касс/i, /чек/i, /54[-\s]?фз/i]);
  const commerceSignalCount = [
    /корзин|checkout|cart|add to cart|добавить в корзину/i.test(text),
    /оформить заказ|заказ оформлен|номер заказа/i.test(text),
    /доставк|возврат|обмен товара/i.test(text),
    /schema\.org\/(?:product|offer)|"@type"\s*:\s*"(?:product|offer)"/i.test(lower),
    hasPaymentTerms
  ].filter(Boolean).length;
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  const hasOpenGraph = /<meta[^>]+property=["']og:/i.test(html);
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const hasSchema = /application\/ld\+json|schema\.org/i.test(html);
  const hasFavicon = /<link[^>]+rel=["'][^"']*(icon|shortcut icon)[^"']*["']/i.test(html);
  const hasHtmlLang = /<html[^>]+\blang=["'][a-z]{2}(?:-[a-z]{2})?["']/i.test(html);
  const hasNoindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);
  const hasLazyImages = imageCount === 0 || /<img\b[^>]+loading=["']lazy["']/i.test(html);
  const robotsFound = /user-agent|sitemap|disallow/i.test(robots || "");
  const sitemapFound = /<urlset|<sitemapindex|\blocation:/i.test(sitemap || "");
  const isCommerce = profile === "shop" || commerceSignalCount >= 2;
  const isHttps = /^https:\/\//i.test(finalUrl);

  const checks = [
    makeCheck({
      id: "privacy-policy",
      group: "legal",
      title: "Политика обработки персональных данных",
      passed: hasPrivacy,
      severity: "high",
      fineMax: 60000,
      law: "152-ФЗ, ст. 18.1; КоАП РФ, ст. 13.11",
      evidence: hasPrivacy ? "На сайте есть признаки политики персональных данных" : "На странице не видно понятной ссылки на политику персональных данных",
      fix: "Добавить политику персональных данных и поставить ссылку рядом с формами, в футере и в cookie-блоке"
    }),
    makeCheck({
      id: "form-consent",
      group: "legal",
      title: "Согласие на обработку ПДн у форм",
      passed: formCount === 0 || hasConsent,
      severity: formCount > 0 ? "high" : "medium",
      fineMax: formCount > 0 ? 300000 : 0,
      law: "152-ФЗ, ст. 9; КоАП РФ, ст. 13.11",
      evidence: formCount > 0 ? `На странице есть формы или поля ввода: ${formCount}` : "Формы и поля ввода не обнаружены",
      fix: "Под каждой формой добавить чекбокс или текст согласия на обработку персональных данных"
    }),
    makeCheck({
      id: "cookie-consent",
      group: "legal",
      title: "Счётчики аналитики и cookie",
      passed: !usesCookie || hasCookieBanner || hasPrivacy,
      status:
        usesCookie && !hasCookieBanner && hasPrivacy
          ? "review"
          : !usesCookie || hasCookieBanner
            ? "passed"
            : "failed",
      severity: usesCookie ? "medium" : "low",
      fineMax: usesCookie && !hasPrivacy ? 100000 : 0,
      law: "152-ФЗ; позиция РКН по идентификаторам пользователей",
      evidence: hasAnalytics
        ? "Найдены счётчики аналитики. Это не всегда означает отдельный штраф, но их нужно описать в политике"
        : usesCookie
          ? "Найдены признаки cookie или локального хранения данных"
          : "Cookie, локальное хранение и счётчики аналитики не обнаружены",
      fix: hasPrivacy
        ? "Проверить, что в политике описаны счётчики аналитики и идентификаторы пользователей"
        : "Добавить политику и описать, какие идентификаторы собирает сайт"
    }),
    makeCheck({
      id: "ad-marking",
      group: "legal",
      title: "Маркировка рекламы и ERID",
      passed: !hasAdPlacementSignal || hasErid,
      status: !hasAdPlacementSignal || hasErid ? "passed" : needsAdReview ? "review" : "failed",
      severity: hasAdPlacementSignal ? "high" : "low",
      fineMax: hasAdPlacement && !hasErid ? 500000 : 0,
      law: "38-ФЗ «О рекламе», ст. 18.1; КоАП РФ, ст. 14.3",
      evidence: hasAdPlacement
        ? "Есть признаки рекламного размещения или ERID-блока"
        : needsAdReview
          ? "На странице есть текст про рекламу, партнёрские блоки или ERID, но по HTML нельзя честно отличить рекламный блок от описания услуги или примера"
        : hasAdServiceContext
          ? "Сайт говорит о рекламных услугах, но признаков чужого рекламного размещения на странице не найдено"
          : "Явные рекламные размещения не найдены",
      fix: "Маркировать нужно именно рекламные размещения: пометка «Реклама», рекламодатель и ERID там, где это требуется"
    }),
    makeCheck({
      id: "company-details",
      group: "legal",
      title: "Реквизиты владельца сайта",
      passed: hasCompanyInfo,
      status: hasCompanyInfo ? "passed" : isCommerce ? "failed" : "review",
      severity: "medium",
      fineMax: isCommerce ? 10000 : 0,
      law: "ЗоЗПП, ст. 8-10; КоАП РФ, ст. 14.8",
      evidence: hasCompanyInfo
        ? "Найдены ИНН, ОГРН, ИП/ООО или реквизиты"
        : isCommerce
          ? "Для коммерческого сценария не видно реквизитов продавца или исполнителя"
          : "По странице нельзя точно понять, обязаны ли здесь быть реквизиты владельца",
      fix: "Добавить реквизиты, юридический адрес, контакты и режим работы"
    }),
    makeCheck({
      id: "offer-return",
      group: "legal",
      title: "Оферта, оплата, доставка и возврат",
      passed: !isCommerce || hasOffer,
      severity: isCommerce ? "high" : "low",
      fineMax: isCommerce ? 40000 : 0,
      law: "ЗоЗПП; правила дистанционной продажи",
      evidence: hasOffer ? "Найдены признаки оферты, оплаты или возврата" : `${profileConfig.label}: условия покупки, оплаты или возврата не найдены`,
      fix: "Подготовить оферту и понятные правила оплаты, доставки, возврата или отмены услуги"
    }),
    makeCheck({
      id: "operator-notice",
      group: "legal",
      title: "Уведомление оператора ПДн",
      passed: hasOperatorNotice || formCount === 0,
      status: hasOperatorNotice || formCount === 0 ? "passed" : "review",
      severity: formCount > 0 ? "medium" : "low",
      fineMax: 0,
      law: "152-ФЗ, ст. 22; КоАП РФ, ст. 19.7",
      evidence: hasOperatorNotice
        ? "Есть признаки уведомления или упоминания РКН"
        : formCount > 0
          ? "По странице нельзя понять, подавал ли владелец уведомление в РКН"
          : "Формы сбора данных не обнаружены",
      fix: "Это проверяется не по дизайну сайта, а по реестру и процессам компании: нужно уточнить, подавалось ли уведомление оператора ПДн"
    }),
    makeCheck({
      id: "children-data",
      group: "legal",
      title: "Данные детей и особые категории",
      passed: !hasChildrenData,
      severity: "high",
      fineMax: hasChildrenData ? 300000 : 0,
      law: "152-ФЗ; КоАП РФ, ст. 13.11",
      evidence: hasChildrenData ? "Есть признаки работы с детьми или несовершеннолетними" : "Признаки работы с детьми или особыми категориями данных не найдены",
      fix: "Проверить возрастные сценарии, отдельные согласия и состав собираемых данных"
    }),
    makeCheck({
      id: "payment-docs",
      group: "legal",
      title: "Платёжные условия и кассовые чеки",
      passed: !isCommerce || hasPaymentTerms,
      severity: isCommerce ? "medium" : "low",
      fineMax: isCommerce ? 30000 : 0,
      law: "54-ФЗ; ЗоЗПП",
      evidence: hasPaymentTerms ? "Найдены признаки оплаты, кассы или чеков" : "Пользователь не видит понятные условия оплаты и выдачи чека",
      fix: "Добавить условия оплаты, выдачи чека и порядок подтверждения заказа"
    }),
    makeCheck({
      id: "title",
      group: "seo",
      title: "Title страницы",
      passed: title.length >= 20 && title.length <= 70,
      severity: "medium",
      evidence: title ? `Title есть, длина ${title.length} символов` : "Title не найден",
      fix: "Сделать title на 45-65 символов: основной запрос, польза для клиента и название бренда"
    }),
    makeCheck({
      id: "description",
      group: "seo",
      title: "Meta description",
      passed: description.length >= 70 && description.length <= 170,
      severity: "medium",
      evidence: description ? `Description есть, длина ${description.length} символов` : "Description не найден",
      fix: "Добавить description с понятным оффером, нишей и причиной перейти на сайт"
    }),
    makeCheck({
      id: "h1",
      group: "seo",
      title: "Один основной H1",
      passed: h1Count === 1,
      severity: "medium",
      evidence: `Основных заголовков H1 найдено: ${h1Count}`,
      fix: "Оставить один главный H1, остальные крупные заголовки перевести в H2 или H3"
    }),
    makeCheck({
      id: "headings",
      group: "seo",
      title: "Структура заголовков H2",
      passed: h2Count > 0,
      severity: "low",
      evidence: `Подзаголовков H2 найдено: ${h2Count}`,
      fix: "Добавить H2 для смысловых блоков, чтобы страницу было легче читать людям и поиску"
    }),
    makeCheck({
      id: "image-alt",
      group: "seo",
      title: "Alt-тексты изображений",
      passed: imageCount === 0 || imageAltCount / imageCount >= 0.65,
      severity: "low",
      evidence: `Alt-текст есть у ${imageAltCount} из ${imageCount} изображений`,
      fix: "Добавить короткие описательные alt для продуктов, кейсов и важных изображений"
    }),
    makeCheck({
      id: "canonical",
      group: "seo",
      title: "Canonical URL",
      passed: hasCanonical,
      severity: "low",
      evidence: hasCanonical ? "Canonical найден" : "Canonical не найден",
      fix: "Добавить canonical, чтобы снизить риск дублей страниц"
    }),
    makeCheck({
      id: "open-graph",
      group: "seo",
      title: "Open Graph для сниппетов",
      passed: hasOpenGraph,
      severity: "low",
      evidence: hasOpenGraph ? "OG-теги найдены" : "OG-теги не найдены",
      fix: "Добавить og:title, og:description, og:image и og:url"
    }),
    makeCheck({
      id: "robots",
      group: "seo",
      title: "robots.txt",
      passed: robotsFound,
      severity: "low",
      evidence: robotsFound ? "robots.txt доступен" : "robots.txt не найден или пуст",
      fix: "Добавить robots.txt и проверить, что важные страницы открыты для индексации"
    }),
    makeCheck({
      id: "sitemap",
      group: "seo",
      title: "sitemap.xml",
      passed: sitemapFound,
      severity: "low",
      evidence: sitemapFound ? "sitemap.xml найден" : "sitemap.xml не найден",
      fix: "Сгенерировать sitemap.xml и указать его в robots.txt"
    }),
    makeCheck({
      id: "meta-robots-index",
      group: "seo",
      title: "Индексация страницы",
      passed: !hasNoindex,
      severity: "high",
      evidence: hasNoindex ? "На странице найден meta robots с noindex" : "Запрета noindex в HTML не найдено",
      fix: "Проверить, не закрыта ли важная посадочная страница от индексации"
    }),
    makeCheck({
      id: "html-lang",
      group: "seo",
      title: "Язык HTML-документа",
      passed: hasHtmlLang,
      severity: "low",
      evidence: hasHtmlLang ? "Атрибут lang у html найден" : "У html не найден корректный lang",
      fix: "Добавить lang=\"ru\" или актуальный язык страницы, чтобы поиску и браузерам было проще интерпретировать контент"
    }),
    makeCheck({
      id: "text-volume",
      group: "seo",
      title: "Объём полезного текста",
      passed: visibleTextLength >= 1200,
      severity: "medium",
      evidence: `На странице примерно ${visibleTextLength} символов видимого текста`,
      fix: "Добавить описания услуг, преимуществ, кейсов, FAQ и коммерческие блоки под реальные запросы аудитории"
    }),
    makeCheck({
      id: "internal-links",
      group: "seo",
      title: "Внутренняя перелинковка",
      passed: internalLinkCount >= 3,
      severity: "low",
      evidence: `Внутренних ссылок найдено: ${internalLinkCount}`,
      fix: "Добавить ссылки на важные услуги, кейсы, контакты, политику и смежные страницы"
    }),
    makeCheck({
      id: "image-loading",
      group: "seo",
      title: "Оптимизация загрузки изображений",
      passed: hasLazyImages,
      severity: "low",
      evidence: imageCount === 0
        ? "Изображения на странице не найдены"
        : hasLazyImages
          ? "У части изображений есть loading=\"lazy\""
          : "Не видны признаки отложенной загрузки изображений",
      fix: "Для изображений ниже первого экрана добавить loading=\"lazy\" и проверить размеры файлов"
    }),
    makeCheck({
      id: "speed",
      group: "seo",
      title: "Скорость ответа HTML",
      passed: timing.responseMs <= 1800 && htmlKb <= 450,
      severity: timing.responseMs > 3000 ? "high" : "medium",
      evidence: `${timing.responseMs} мс, ${htmlKb} КБ HTML`,
      fix: "Проверить тяжёлые скрипты, изображения, критический CSS и скорость ответа сервера"
    }),
    makeCheck({
      id: "viewport",
      group: "seo",
      title: "Мобильная адаптация",
      passed: hasViewport,
      severity: "medium",
      evidence: hasViewport ? "Viewport найден" : "Viewport не найден",
      fix: "Добавить meta viewport и проверить первый экран на телефоне"
    }),
    makeCheck({
      id: "schema",
      group: "seo",
      title: "Schema.org / JSON-LD",
      passed: hasSchema,
      severity: "low",
      evidence: hasSchema ? "Структурированные данные найдены" : "Структурированные данные не найдены",
      fix: "Добавить Organization, Product, Service, FAQ или BreadcrumbList"
    }),
    makeCheck({
      id: "favicon",
      group: "seo",
      title: "Favicon и вид сайта во вкладках",
      passed: hasFavicon,
      severity: "low",
      evidence: hasFavicon ? "Favicon найден" : "Favicon не найден",
      fix: "Добавить favicon и touch icon для вкладок, поиска и мобильных устройств"
    }),
    makeCheck({
      id: "https",
      group: "seo",
      title: "Безопасный HTTPS",
      passed: isHttps,
      severity: "high",
      evidence: isHttps ? "Сайт открывается по HTTPS" : "Финальный URL не HTTPS",
      fix: "Настроить SSL и постоянный редирект с HTTP на HTTPS"
    })
  ];

  const failed = checks.filter((check) => check.status === "failed");
  const fineMax = failed.reduce((sum, check) => sum + check.fineMax, 0);
  const score = riskScore(checks);
  const legalFailed = failed.filter((check) => check.group === "legal").length;
  const seoFailed = failed.filter((check) => check.group === "seo").length;
  const riskLevel =
    fineMax >= 500000 || score < 45
      ? "critical"
      : fineMax >= 150000 || legalFailed >= 2 || score < 70
        ? "high"
        : failed.length > 0
          ? "medium"
          : "low";

  return {
    url: targetUrl.href,
    profile,
    profileLabel: profileConfig.label,
    checkedAt: new Date().toISOString(),
    summary: {
      score,
      riskLevel,
      fineMax,
      legalIssues: legalFailed,
      seoIssues: seoFailed,
      totalIssues: failed.length
    },
    facts: {
      title,
      description,
      h1Count,
      imageCount,
      imageAltCount,
      formCount,
      htmlKb,
      responseMs: timing.responseMs,
      status: timing.status,
      finalUrl
    },
    checks,
    services: recommendServices(checks, profile),
    sources: LEGAL_SOURCES
  };
}

async function handleAudit(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  let data;
  if (req.method === 'POST') {
    try {
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error();
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) throw new Error(); chunks.push(chunk); }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return sendJson(res, 400, { error: 'Некорректный запрос' }); }
    if (data?.consent !== true) return sendJson(res, 400, { error: 'Подтвердите согласие с политикой конфиденциальности' });
  }
  const raw = data ? data.url : requestUrl.searchParams.get("url");
  const profile = (data ? data.profile : requestUrl.searchParams.get("profile")) || "lead";

  let targetUrl;
  try {
    targetUrl = normalizeTarget(raw);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  try {
    const page = await safeFetchText(targetUrl.href);
    if (!page.ok || !/text\/html|application\/xhtml/i.test(page.contentType)) throw new Error(`Страница не доступна как HTML (HTTP ${page.status})`);
    const finalUrl = new URL(page.finalUrl || targetUrl.href);
    const [robots, sitemap, resources] = await Promise.all([
      fetchOptional(new URL("/robots.txt", finalUrl).href),
      fetchOptional(new URL("/sitemap.xml", finalUrl).href),
      collectResources(page)
    ]);

    const browser = await inspectBrowser(page, resources);
    const audit = enhanceAudit({
      html: browser.available ? browser.html : page.text,
      browser,
      robots,
      sitemap,
      resources,
      targetUrl,
      profile,
      timing: page
    }, analyzeHtml);

    if (!page.ok) {
      audit.warning = `Сайт ответил HTTP ${page.status}; часть проверки может быть неполной.`;
    }

    const token = await reports.create(audit);
    const record = await reports.read(token);
    // Only same-origin POSTs may spend a buyer's domain allowance; public GET previews never do.
    const pass = req.method === 'POST' ? await domainAccess.apply(record, token, req) : null;
    sendJson(res, 200, { ...(pass ? reports.full(audit, token) : reports.preview(audit, token)), paid: Boolean(pass), domainAccess: pass });
  } catch (error) {
    const profileConfig = PROFILES[profile] || PROFILES.lead;
    const message = `Не удалось загрузить сайт: ${error.message}. Автоматические выводы не сформированы.`;
    const checks = [
      makeCheck({
        id: "fetch-error",
        group: "legal",
        title: "Сайт не удалось проверить автоматически",
        status: "review",
        severity: "high",
        fineMax: 0,
        evidence: message,
        fix: "Проверьте адрес, доступность страницы и блокировки ботов, затем запустите проверку повторно"
      })
    ];

    sendJson(res, 200, {
      url: targetUrl.href,
      profile,
      profileLabel: profileConfig.label,
      checkedAt: new Date().toISOString(),
      warning: message,
      summary: {
        score: 0,
        riskLevel: "review",
        fineMax: 0,
        legalIssues: 0,
        seoIssues: 0,
        totalIssues: 0
      },
      facts: {
        title: "",
        description: "",
        h1Count: 0,
        imageCount: 0,
        imageAltCount: 0,
        formCount: 0,
        htmlKb: 0,
        responseMs: 0,
        status: 0,
        finalUrl: targetUrl.href
      },
      checks,
      services: recommendServices(checks, profile),
      sources: LEGAL_SOURCES
    });
  }
}

async function handleRequest(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Используйте POST" });
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) {
    return sendJson(res, 415, { error: "Нужен формат JSON" });
  }
  const chunks = [];
  try {
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 16384) {
        sendJson(res, 413, { error: "Заявка слишком большая" });
        return;
      }
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const limits = { website: 2048, email: 254, name: 100, message: 2000 };
    if (!data || typeof data !== "object" || !["legal", "seo"].includes(data.service) || data.consent !== true) {
      return sendJson(res, 400, { error: "Выберите услугу и подтвердите согласие на обработку данных" });
    }
    for (const [field, limit] of Object.entries(limits)) {
      if (data[field] != null && (typeof data[field] !== "string" || data[field].length > limit)) {
        return sendJson(res, 400, { error: "Проверьте длину и формат полей" });
      }
    }
    const email = (data.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(res, 400, { error: "Укажите email для ответа" });
    }
    let website;
    try {
      website = normalizeTarget(data.website);
      if (!website.hostname.includes(".") || website.username || website.password) throw new Error();
    } catch {
      return sendJson(res, 400, { error: "Проверьте адрес сайта, например example.ru" });
    }
    const request = {
      id: randomUUID(), createdAt: new Date().toISOString(), service: data.service,
      website: website.href, email, name: (data.name || "").trim(),
      message: (data.message || "").trim(), consent: true, consentVersion: "request-v1"
    };
    const directory = path.resolve(process.env.LEADS_DIR || path.join(__dirname, "data"));
    const relative = path.relative(PUBLIC_DIR, directory);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw Object.assign(new Error("LEADS_DIR must be outside public"), { code: "UNSAFE_LEADS_DIR" });
    }
    await fs.promises.mkdir(directory, { recursive: true });
    // One file per request: no shared append races and no publicly served personal data.
    await fs.promises.writeFile(path.join(directory, `${request.id}.json`), JSON.stringify(request, null, 2), { flag: "wx", mode: 0o600 });
    // Saved requests remain queued if SMTP is unavailable; delivery failures do not discard them.
    notifyLead(request, directory).catch(() => console.error("Lead notification remains queued"));
    sendJson(res, 201, { id: request.id });
  } catch (error) {
    if (error instanceof SyntaxError) return sendJson(res, 400, { error: "Некорректный JSON" });
    console.error("Request could not be saved:", error.code || "unknown");
    if (!res.headersSent) sendJson(res, 503, { error: "Не удалось сохранить заявку. Попробуйте ещё раз или напишите нам в Telegram." });
  }
}

const requestRates = new Map();
let activeAudits = 0;
const server = http.createServer((req, res) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const route = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (req.method === 'POST' && route.startsWith('/api/') && route !== '/api/payments/webhook') {
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site' || (origin && ![new URL(process.env.PUBLIC_URL || 'https://kinavapro.ru').origin, `http://${req.headers.host}`, `https://${req.headers.host}`].includes(origin))) return sendJson(res, 403, { error: 'Запрос должен быть отправлен с сайта KinavaPro' });
  }
  if (["/api/audit", "/api/requests", "/api/payments", "/api/report", "/api/report/email", "/api/access"].includes(route)) {
    const ip = process.env.TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",").pop().trim() : req.socket.remoteAddress;
    const key = route + (route === '/api/access' ? req.method : '') + ip;
    const now = Date.now();
    for (const [entry, value] of requestRates) if (value.until < now) requestRates.delete(entry);
    const limit = route === '/api/access' && req.method === 'GET' ? 30 : route === "/api/audit" || route === "/api/report" ? 10 : 5;
    const value = requestRates.get(key) || {count: 0, until: now + 60000};
    if (++value.count > limit || requestRates.size > 10000) {
      res.setHeader("Retry-After", "60"); return sendJson(res, 429, {error:"Слишком много запросов. Повторите через минуту."});
    }
    requestRates.set(key, value);
  }
  if (route === "/api/config") return sendJson(res, 200, publicConfig());
  if (["/api/payments", "/api/report", "/api/report/email", "/api/payments/webhook", "/api/access"].includes(route)) {
    handlePayments(req, res, sendJson).catch(() => sendJson(res, 503, {error:"Платёжный сервис временно недоступен. Попробуйте позже."}));
    return;
  }
  if (new URL(req.url, `http://${req.headers.host}`).pathname === "/api/requests") {
    handleRequest(req, res);
    return;
  }
  if (route === "/api/audit") {
    if (!["GET", "POST"].includes(req.method)) return sendJson(res, 405, {error:"Нужен GET или POST"});
    if (activeAudits >= 6) return sendJson(res, 503, {error:"Все проверки заняты. Повторите чуть позже."});
    activeAudits++;
    handleAudit(req, res).catch(() => { if (!res.headersSent) sendJson(res, 503, {error:"Не удалось выполнить проверку"}); }).finally(() => activeAudits--);
    return;
  }

  serveStatic(req, res);
});

if (require.main === module) server.listen(PORT, () => {
  console.log(`Kinava Audit running at http://localhost:${PORT}`);
});
module.exports = { analyzeHtml, server };
