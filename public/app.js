const site = document.querySelector(".site");
const form = document.querySelector(".check-form");
const input = document.querySelector("#site-url");
const resultUrl = document.querySelector(".checked-url b");

function showView(view) {
  site?.setAttribute("data-view", view);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "https://вашсайт.ru";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = normalizeUrl(input?.value || "");
  if (!input?.value.trim()) {
    input?.focus();
    return;
  }

  if (resultUrl) resultUrl.textContent = url;
  showView("loading");

  fetch(`/api/audit?url=${encodeURIComponent(url)}&profile=lead`, {
    headers: { Accept: "application/json" }
  }).catch(() => {});

  window.setTimeout(() => showView("result"), 900);
});

document.querySelectorAll(".js-home, .back-home").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showView("home");
  });
});
