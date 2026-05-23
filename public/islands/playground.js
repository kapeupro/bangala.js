import { compile } from "https://esm.sh/bangala@0.5.0";

const DEBOUNCE_MS = 250;

const presets = {
  basic: [
    "---",
    'const greeting = "Hello bangala!"',
    'const items = ["islands", "html-first", "0 kb"]',
    "---",
    "<h1>{greeting}</h1>",
    "<ul>",
    "  {#each items as item}",
    "    <li>{item}</li>",
    "  {/each}",
    "</ul>",
  ].join("\n"),
  conditional: [
    "---",
    "const user = { name: 'Ada', admin: true }",
    "---",
    "<h1>Hello {user.name}</h1>",
    "{#if user.admin}",
    "  <p>Welcome back, admin.</p>",
    "{:else}",
    "  <p>Standard user view.</p>",
    "{/if}",
  ].join("\n"),
  expression: [
    "---",
    "const price = 19.9",
    "const qty = 3",
    "const taxRate = 0.2",
    "---",
    "<h1>Receipt</h1>",
    "<p>Unit: {price.toFixed(2)} EUR</p>",
    "<p>Quantity: {qty}</p>",
    "<p>Subtotal: {(price * qty).toFixed(2)} EUR</p>",
    "<p>Tax (20%): {(price * qty * taxRate).toFixed(2)} EUR</p>",
    "<p><strong>Total: {(price * qty * (1 + taxRate)).toFixed(2)} EUR</strong></p>",
  ].join("\n"),
  escape: [
    "---",
    "// All interpolation is auto-HTML-escaped — XSS impossible by default.",
    'const userBio = \'<script>alert("hi")</script> hello <b>world</b>\'',
    "---",
    "<h1>Profile</h1>",
    "<p>Bio:</p>",
    "<blockquote>{userBio}</blockquote>",
    "<p><em>The user input above is rendered as text, not HTML.</em></p>",
  ].join("\n"),
  await: [
    "---",
    "// Frontmatter runs on the server. Top-level await is allowed.",
    "const posts = await Promise.resolve([",
    "  { title: 'Hello world', date: '2026-05-24' },",
    "  { title: 'Why HTML first', date: '2026-05-22' },",
    "  { title: 'Islands explained', date: '2026-05-20' },",
    "])",
    "---",
    "<h1>Latest posts</h1>",
    "<ul>",
    "  {#each posts as post}",
    "    <li><strong>{post.title}</strong> — {post.date}</li>",
    "  {/each}",
    "</ul>",
  ].join("\n"),
  island: [
    "---",
    'import Counter from "./Counter.bangala"',
    "const start = 10",
    "---",
    "<h1>Page with an island</h1>",
    "<p>The counter below ships as the only JS. Everything else is static HTML.</p>",
    "<Counter start={start} client:load/>",
  ].join("\n"),
};

export async function mount(el) {
  const textarea = el.querySelector("textarea");
  if (!textarea.value.trim()) textarea.value = presets.basic;
  const tabs = el.querySelectorAll("[data-pane]");
  const panes = {
    html: el.querySelector('[data-pane-content="html"]'),
    module: el.querySelector('[data-pane-content="module"]'),
    islands: el.querySelector('[data-pane-content="islands"]'),
  };
  const errorBar = el.querySelector("[data-error]");
  const presetButtons = el.querySelectorAll("[data-preset]");

  let timer = null;
  let lastBlobUrl = null;

  function setActiveTab(name) {
    tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.pane === name));
    Object.entries(panes).forEach(([k, p]) => p.classList.toggle("is-active", k === name));
  }

  function showError(message) {
    errorBar.textContent = message;
    errorBar.hidden = false;
  }
  function clearError() {
    errorBar.hidden = true;
    errorBar.textContent = "";
  }

  async function recompile() {
    const source = textarea.value;
    let result;
    try {
      result = compile(source, { filename: "playground.bangala" });
      clearError();
    } catch (err) {
      showError(err.message || String(err));
      return;
    }

    panes.module.textContent = result.code;
    panes.islands.textContent = JSON.stringify(result.islands, null, 2);

    try {
      if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
      const shimmed = result.code.replace(
        /import \{[^}]+\} from "bangala\/runtime";?/,
        `const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const renderComponent = async (Comp, props, children) => Comp.render({ ...props, children: children ? await children() : "" });
const island = async (Comp, props, entry, strategy) => {
  const html = await Comp.render(props);
  const serialized = escape(JSON.stringify(props));
  const strat = strategy.replace(/^client:/, "");
  return \`<bangala-island data-entry="\${entry}" data-props="\${serialized}" data-strategy="\${strat}">\${html}</bangala-island>\`;
};`,
      ).replace(/^import .+ from "[^"]+\.bangala\.js";?$/gm, (line) => {
        const name = line.match(/^import\s+(\w+)/)?.[1] ?? "Comp";
        return `const ${name} = { render: async (p) => "<div data-placeholder>" + ${JSON.stringify(name)} + " (stub)</div>" };`;
      });
      const blob = new Blob([shimmed], { type: "text/javascript" });
      lastBlobUrl = URL.createObjectURL(blob);
      const mod = await import(/* @vite-ignore */ lastBlobUrl);
      const html = await mod.render({});
      panes.html.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{font-family:system-ui;color:#e5e5e5;background:#0a0a0a;padding:1.5rem;margin:0}a{color:#f97316}bangala-island{display:block;border:1px dashed rgba(249,115,22,.5);padding:.5rem;border-radius:6px;margin:.5rem 0}[data-placeholder]{opacity:.6;font-style:italic}blockquote{border-left:3px solid #f97316;padding-left:1rem;color:#a3a3a3;margin:1rem 0;font-style:italic}</style>${html}`;
    } catch (err) {
      showError(`Runtime: ${err.message || err}`);
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(recompile, DEBOUNCE_MS);
  }

  textarea.addEventListener("input", schedule);
  tabs.forEach((t) => t.addEventListener("click", () => setActiveTab(t.dataset.pane)));
  presetButtons.forEach((b) =>
    b.addEventListener("click", () => {
      textarea.value = presets[b.dataset.preset];
      recompile();
    }),
  );

  setActiveTab("html");
  await recompile();
}
