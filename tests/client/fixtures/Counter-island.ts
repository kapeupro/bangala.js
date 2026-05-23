export async function mount(
  el: HTMLElement,
  props: Record<string, unknown>,
  _ctx: { strategy: string; entry: string },
): Promise<void> {
  const start = typeof props.start === "number" ? props.start : 0;
  let n = start;
  const button = el.querySelector<HTMLButtonElement>("button");
  if (!button) throw new Error("Counter island: missing <button> in SSR HTML");
  button.textContent = `count=${n}`;
  button.addEventListener("click", () => {
    n += 1;
    button.textContent = `count=${n}`;
  });
}
