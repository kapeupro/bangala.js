// bangala island: counter
// Strategy: client:load — hydrates immediately on page load.
// Props: { start?: number }

export async function mount(el, props) {
  const btn = el.querySelector("button");
  if (!btn) {
    throw new Error("counter island: missing <button> child");
  }
  let count = typeof props?.start === "number" ? props.start : 0;
  const render = () => {
    btn.textContent = `count=${count}`;
  };
  render();
  btn.addEventListener("click", () => {
    count += 1;
    render();
  });
}
