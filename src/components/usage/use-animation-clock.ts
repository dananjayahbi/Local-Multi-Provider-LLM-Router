"use client";

import { useEffect, useState } from "react";

/**
 * A lightweight monotonic clock that re-renders ~30×/s so the animated request
 * dots and token particles move smoothly. Paused when the page is hidden (keeps
 * CPU low). Returns seconds since mount.
 */
export function useAnimationClock(fps = 30): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let raf = 0;
    let last = Date.now();
    const interval = 1000 / fps;

    const tick = () => {
      const nowMs = Date.now();
      if (nowMs - last >= interval) {
        last = nowMs;
        setNow(nowMs);
      }
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = Date.now();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fps]);

  // Convert to seconds for the animation math.
  return now / 1000;
}
