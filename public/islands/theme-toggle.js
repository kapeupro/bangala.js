// bangala island: theme-toggle
// Strategy: client:idle — hydrates when the browser is idle.

const STORAGE_KEY = "bangalaTheme";

export async function mount(el) {
  const btn = el.querySelector("button");
  if (!btn) {
    throw new Error("theme-toggle island: missing <button> child");
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  let theme = stored === "light" || stored === "dark" ? stored : "dark";
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    btn.textContent = theme === "light" ? "☀ Light" : "🌙 Dark";
  };
  apply();
  btn.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    localStorage.setItem(STORAGE_KEY, theme);
    apply();
  });
}
