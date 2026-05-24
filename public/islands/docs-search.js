function normalize(value) {
  return String(value || "").toLowerCase();
}

function shortcutLabel() {
  return navigator.platform && navigator.platform.toLowerCase().includes("mac") ? "⌘K" : "Ctrl K";
}

export async function mount(el, props) {
  const items = Array.isArray(props.items) ? props.items : [];
  const openButton = el.querySelector("[data-docs-search-open]");
  if (!openButton) return;

  const dialog = document.createElement("div");
  dialog.className = "docs-search-modal";
  dialog.setAttribute("aria-hidden", "true");
  dialog.innerHTML = `
    <div class="docs-search-backdrop" data-docs-search-close></div>
    <div class="docs-search-panel" role="dialog" aria-modal="true" aria-label="Search documentation">
      <div class="docs-search-field">
        <span aria-hidden="true">⌕</span>
        <input type="search" placeholder="Search Bangala docs..." autocomplete="off" />
        <kbd>${shortcutLabel()}</kbd>
      </div>
      <div class="docs-search-results" role="listbox"></div>
    </div>
  `;
  document.body.appendChild(dialog);

  const input = dialog.querySelector("input");
  const results = dialog.querySelector(".docs-search-results");

  function render(query = "") {
    const q = normalize(query);
    const matches = items
      .filter((item) => {
        if (!q) return true;
        return [item.label, item.desc, item.group, item.href].some((part) =>
          normalize(part).includes(q),
        );
      })
      .slice(0, 8);

    results.innerHTML = matches.length
      ? matches.map((item) => `
          <a class="docs-search-result" role="option" href="${item.href}">
            <span>
              <strong>${item.label}</strong>
              <small>${item.desc || item.group || ""}</small>
            </span>
            <em>${item.group || ""}</em>
          </a>
        `).join("")
      : `<p class="docs-search-empty">No docs page found.</p>`;
  }

  function open() {
    render(input.value);
    dialog.classList.add("is-open");
    dialog.setAttribute("aria-hidden", "false");
    document.documentElement.classList.add("docs-search-lock");
    setTimeout(() => input.focus(), 0);
  }

  function close() {
    dialog.classList.remove("is-open");
    dialog.setAttribute("aria-hidden", "true");
    document.documentElement.classList.remove("docs-search-lock");
    openButton.focus();
  }

  openButton.querySelector("kbd").textContent = shortcutLabel();
  openButton.addEventListener("click", open);
  input.addEventListener("input", () => render(input.value));
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-docs-search-close]")) close();
  });
  results.addEventListener("click", (event) => {
    if (event.target.closest("a")) close();
  });

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "k") {
      event.preventDefault();
      open();
      return;
    }
    if (event.key === "Escape" && dialog.classList.contains("is-open")) close();
  });

  render();
}
