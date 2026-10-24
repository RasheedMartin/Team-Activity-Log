import { useCallback, useLayoutEffect, useState } from "react";

/**
 * Largest width×height with the given aspect ratio that fits inside the measured container.
 * Uses a callback ref so it works inside portals (dialogs), whose content mounts late.
 */
export function useFit<T extends HTMLElement>(aspect: number) {
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const width = Math.min(el.clientWidth, el.clientHeight * aspect);
      setSize({ width: Math.floor(width), height: Math.floor(width / aspect) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, aspect]);
  return { ref, ...size };
}
