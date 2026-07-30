"use client";

import { useEffect, useRef, useState } from "react";

interface RollingNumberProps {
  value: number;
  duration?: number;
  className?: string;
}

function formatWithCommas(n: number): string {
  return n.toLocaleString("en-US");
}

export function RollingNumber({ value, duration = 600, className }: RollingNumberProps) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      // First mount — animate from 0 to initial value
      mountedRef.current = true;
      prevValue.current = 0;
    }

    const start = prevValue.current;
    const end = value;
    prevValue.current = value;

    if (start === end) {
      setDisplay(end);
      return;
    }

    // Cancel any in-progress animation
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startTimeRef.current = 0;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(start + (end - start) * eased);

      setDisplay(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        startTimeRef.current = 0;
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  return <span className={className}>{formatWithCommas(display)}</span>;
}
