export type StrategyName = "load" | "idle" | "visible";

export type Schedule = (el: HTMLElement, run: () => void) => void;

export const load: Schedule = (_el, run) => {
  run();
};

export const idle: Schedule = (_el, run) => {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2000 });
  } else {
    setTimeout(run, 1);
  }
};

export const visible: Schedule = (el, run) => {
  if (typeof IntersectionObserver !== "function") {
    run();
    return;
  }
  let fired = false;
  const io = new IntersectionObserver(
    (entries) => {
      if (fired) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          fired = true;
          io.disconnect();
          run();
          return;
        }
      }
    },
    { rootMargin: "200px" },
  );
  io.observe(el);
};

const TABLE: Record<StrategyName, Schedule> = { load, idle, visible };

export function getStrategy(name: StrategyName): Schedule {
  return TABLE[name];
}
