"use client";

import { animate } from "animejs";
import { useEffect, useRef, type ReactNode } from "react";

export function MotionReveal({
  children,
  className,
  motionKey,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  motionKey: string;
  delay?: number;
}) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;

    if (!elementRef.current || reducedMotion) {
      return;
    }

    animate(elementRef.current, {
      opacity: [0, 1],
      translateY: [6, 0],
      duration: 180,
      delay,
      ease: "outQuad",
    });
  }, [delay, motionKey]);

  return (
    <div ref={elementRef} data-motion-key={motionKey} className={className}>
      {children}
    </div>
  );
}
