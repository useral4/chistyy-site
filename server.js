const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
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

async function fetchText(url, timeoutMs = 12000) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "KinavaAuditBot/0.3 (+https://kinava.local; legal and seo audit)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      text: await response.text(),
      responseMs: Math.round(performance.now() - startedAt),
      contentType: response.headers.get("content-type") || ""
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOptional(url) {
  try {
    const result = await fetchText(url, 5000);
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
  const hasAdPlacement = hasAny(lower, [
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
  const hasErid = /erid\s*[:=]?\s*[a-zа-я0-9_-]{6,}/i.test(lower);
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
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  const hasOpenGraph = /<meta[^>]+property=["']og:/i.test(html);
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  const hasSchema = /application\/ld\+json|schema\.org/i.test(html);
  const hasFavicon = /<link[^>]+rel=["'][^"']*(icon|shortcut icon)[^"']*["']/i.test(html);
  const robotsFound = /user-agent|sitemap|disallow/i.test(robots || "");
  const sitemapFound = /<urlset|<sitemapindex|\blocation:/i.test(sitemap || "");
  const isCommerce = profile === "shop";
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
      passed: !hasAdPlacement || hasErid,
      severity: hasAdPlacement ? "high" : "low",
      fineMax: hasAdPlacement && !hasErid ? 500000 : 0,
      law: "38-ФЗ «О рекламе», ст. 18.1; КоАП РФ, ст. 14.3",
      evidence: hasAdPlacement
        ? "Есть признаки рекламного размещения или ERID-блока"
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
      severity: "medium",
      fineMax: isCommerce ? 10000 : 0,
      law: "ЗоЗПП, ст. 8-10; КоАП РФ, ст. 14.8",
      evidence: hasCompanyInfo ? "Найдены ИНН, ОГРН, ИП/ООО или реквизиты" : "Пользователь не видит, кто юридически отвечает за сайт",
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

function demoAudit(rawUrl, profile, message) {
  const targetUrl = normalizeTarget(rawUrl || "demo.kinava.local");
  const demoHtml = `<!doctype html>
    <html lang="ru">
      <head><title>Демо сайт</title></head>
      <body>
        <h1>Услуги для бизнеса</h1>
        <form><input name="phone"></form>
        <img src="case.jpg">
        <section>Реклама партнера. Скидка на запуск сайта.</section>
      </body>
    </html>`;

  const audit = analyzeHtml({
    html: demoHtml,
    robots: "",
    sitemap: "",
    targetUrl,
    profile,
    timing: {
      responseMs: 2200,
      status: 0,
      finalUrl: targetUrl.href
    }
  });

  audit.warning = message;
  return audit;
}

async function handleAudit(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const raw = requestUrl.searchParams.get("url");
  const profile = requestUrl.searchParams.get("profile") || "lead";

  let targetUrl;
  try {
    targetUrl = normalizeTarget(raw);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
    return;
  }

  try {
    const page = await fetchText(targetUrl.href);
    const finalUrl = new URL(page.finalUrl || targetUrl.href);
    const [robots, sitemap] = await Promise.all([
      fetchOptional(new URL("/robots.txt", finalUrl).href),
      fetchOptional(new URL("/sitemap.xml", finalUrl).href)
    ]);

    const audit = analyzeHtml({
      html: page.text,
      robots,
      sitemap,
      targetUrl,
      profile,
      timing: page
    });

    if (!page.ok) {
      audit.warning = `Сайт ответил HTTP ${page.status}; часть проверки может быть неполной.`;
    }

    sendJson(res, 200, audit);
  } catch (error) {
    sendJson(
      res,
      200,
      demoAudit(
        raw,
        profile,
        `Не удалось загрузить сайт: ${error.message}. Показываем демонстрационный отчёт.`
      )
    );
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/audit")) {
    handleAudit(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Kinava Audit running at http://localhost:${PORT}`);
});
