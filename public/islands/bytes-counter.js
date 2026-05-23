// bangala island: bytes-counter
// Strategy: client:visible — hydrates when scrolled into the viewport.
// Animates 300 → 0 over 1.2s with an ease-out curve.

export async function mount(el) {
  const out = el.querySelector(".bytes-value");
  if (!out) {
    throw new Error("bytes-counter island: missing .bytes-value");
  }
  const from = 300;
  const to = 0;
  const duration = 1200;
  const start = performance.now();
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const v = Math.round(from + (to - from) * easeOut(t));
    out.textContent = String(v);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
