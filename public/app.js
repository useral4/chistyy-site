const form = document.querySelector(".check-form");
const input = document.querySelector("#site-url");
const button = form?.querySelector("button[type='submit']");

function setButtonState(text, disabled = false) {
  if (!button) return;
  button.disabled = disabled;
  button.innerHTML = `${text} <span aria-hidden="true">→</span>`;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = input?.value.trim();
  if (!url) {
    input?.focus();
    return;
  }

  const original = button?.textContent?.trim() || "Проверить нарушения";
  setButtonState("Проверяем", true);

  try {
    await fetch(`/api/audit?url=${encodeURIComponent(url)}&profile=lead`, {
      headers: { Accept: "application/json" }
    });
    setButtonState("Проверка готова", false);
  } catch {
    setButtonState("Попробовать ещё раз", false);
  }

  window.setTimeout(() => setButtonState(original.replace("→", "").trim(), false), 2600);
});
