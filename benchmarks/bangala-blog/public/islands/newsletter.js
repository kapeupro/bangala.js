// bangala island: newsletter
// Strategy: client:load — hydrates immediately on page load.

export async function mount(el) {
  const form = el.querySelector("form");
  const input = el.querySelector("input");
  const btn = el.querySelector("button");
  const msg = el.querySelector(".nl-msg");
  if (!form || !input || !btn || !msg) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    btn.disabled = true;
    msg.textContent = `Thanks, ${input.value}!`;
  });
}
