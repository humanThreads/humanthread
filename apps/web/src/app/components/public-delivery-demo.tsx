"use client";

import { animate } from "animejs";
import { Fragment, useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import styles from "./public-home.module.css";

export interface PublicDeliveryStage {
  key: string;
  label: string;
  detail: string;
}

export function PublicDeliveryDemo({
  stages,
}: {
  stages: readonly PublicDeliveryStage[];
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [runKey, setRunKey] = useState(0);
  const finalStageIndex = Math.max(0, stages.length - 1);
  const [activeStageIndex, setActiveStageIndex] = useState(finalStageIndex);
  const [isPlaying, setIsPlaying] = useState(false);
  const activeStage = stages[activeStageIndex] ?? stages[finalStageIndex];

  useEffect(() => {
    const root = rootRef.current;
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;

    if (!root || (reducedMotion && runKey === 0)) {
      return;
    }

    const compact = window.matchMedia?.("(max-width: 767px)")?.matches;
    const segments = Array.from(
      root.querySelectorAll<HTMLElement>("[data-delivery-segment]"),
    );
    const nodes = Array.from(
      root.querySelectorAll<HTMLElement>("[data-delivery-node]"),
    );
    const cursor = root.querySelector<HTMLElement>("[data-delivery-cursor]");
    const progress = root.querySelector<HTMLElement>("[data-delivery-progress]");
    const statusDot = root.querySelector<HTMLElement>("[data-delivery-status-dot]");
    const firstNode = nodes[0];
    const lastNode = nodes.at(-1);
    const firstRect = firstNode?.getBoundingClientRect();
    const lastRect = lastNode?.getBoundingClientRect();
    const cursorTravel = firstRect && lastRect
      ? Math.max(
          0,
          compact
            ? lastRect.top - firstRect.top
            : lastRect.left - firstRect.left,
        )
      : 0;
    const stageInterval = 900;
    const runDuration = Math.max(2400, (stages.length - 1) * stageInterval + 600);
    const stageTimers = stages.slice(1).map((_stage, index) =>
      window.setTimeout(() => {
        setActiveStageIndex(index + 1);
      }, (index + 1) * stageInterval),
    );
    const startTimer = runKey === 0
      ? window.setTimeout(() => {
          setActiveStageIndex(0);
          setIsPlaying(true);
        }, 0)
      : null;
    const finishTimer = window.setTimeout(() => {
      setIsPlaying(false);
    }, runDuration);
    const activeAnimations = [
      animate(segments, {
        ...(compact ? { scaleY: [0, 1] } : { scaleX: [0, 1] }),
        opacity: [0.25, 1],
        duration: 520,
        delay: (_target, index) => 440 + (index ?? 0) * stageInterval,
        ease: "outExpo",
      }),
      animate(nodes, {
        opacity: [0.35, 1],
        scale: [0.72, 1],
        duration: 420,
        delay: (_target, index) => (index ?? 0) * stageInterval,
        ease: "outBack(1.5)",
      }),
      ...(cursor
        ? [
            animate(cursor, {
              ...(compact
                ? { translateY: [0, cursorTravel] }
                : { translateX: [0, cursorTravel] }),
              opacity: [0, 1, 1, 1],
              duration: runDuration - 300,
              ease: "inOutQuad",
            }),
          ]
        : []),
      ...(progress
        ? [
            animate(progress, {
              scaleX: [0, 1],
              duration: runDuration,
              ease: "outExpo",
            }),
          ]
        : []),
      ...(statusDot
        ? [
            animate(statusDot, {
              scale: [1, 1.7, 1],
              opacity: [1, 0.45, 1],
              duration: 540,
              delay: Math.min(3, finalStageIndex) * stageInterval,
              ease: "inOutQuad",
            }),
          ]
        : []),
    ];

    return () => {
      if (startTimer !== null) window.clearTimeout(startTimer);
      stageTimers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(finishTimer);
      activeAnimations.forEach((animation) => animation.revert());
    };
  }, [finalStageIndex, runKey, stages]);

  function replay() {
    setActiveStageIndex(0);
    setIsPlaying(true);
    setRunKey((value) => value + 1);
  }

  return (
    <section
      ref={rootRef}
      aria-label="交付线程演示"
      className={styles.deliveryDemo}
    >
      <div className={styles.deliveryRunHeader}>
        <div>
          <span className={styles.deliveryRunKicker}>EXAMPLE DELIVERY THREAD</span>
          <strong>
            <code>HT-248</code>
            跨境运营周报与异常处理
            <span className={styles.demoLabel}>演示数据</span>
          </strong>
        </div>
        <button
          type="button"
          className={styles.deliveryReplay}
          onClick={replay}
          aria-label="重播交付演示"
        >
          <RotateCw aria-hidden="true" size={14} strokeWidth={1.8} />
          {isPlaying ? "重新开始" : "重播演示"}
        </button>
      </div>
      <div className={styles.deliveryTrack} data-delivery-track>
        {stages.map((stage, index) => (
          <Fragment key={stage.key}>
            <article
              className={styles.deliveryStage}
              data-active={activeStageIndex === index}
              data-complete={activeStageIndex > index}
              data-delivery-stage={stage.key}
            >
              <span
                aria-hidden="true"
                data-delivery-node
                className={styles.deliveryNode}
              />
              <div className={styles.deliveryIndex}>
                {String(index + 1).padStart(2, "0")}
              </div>
              <h2>{stage.label}</h2>
              <p>{stage.detail}</p>
            </article>
            {index < stages.length - 1 ? (
              <span
                aria-hidden="true"
                data-complete={activeStageIndex > index}
                data-delivery-segment
                className={styles.deliverySegment}
              />
            ) : null}
          </Fragment>
        ))}
        <span
          aria-hidden="true"
          data-delivery-cursor
          className={styles.deliveryCursor}
          style={{ opacity: 0 }}
        />
      </div>
      <div
        className={styles.deliveryRunbook}
        aria-label="交付演示状态"
        aria-live="polite"
        role="status"
      >
        <div className={styles.deliveryRunbookMain}>
          <span
            aria-hidden="true"
            data-delivery-status-dot
            className={styles.deliveryStatusDot}
          />
          <div>
            <span className={styles.deliveryRunKicker}>
              {isPlaying ? "CURRENT STAGE" : "DELIVERY COMPLETE"}
            </span>
            <strong>{activeStage?.label}</strong>
            <p>{activeStage?.detail}</p>
          </div>
        </div>
        <div className={styles.deliveryProgressMeta}>
          <span>交付进度</span>
          <code>
            {String(activeStageIndex + 1).padStart(2, "0")} / {String(stages.length).padStart(2, "0")}
          </code>
        </div>
        <span className={styles.deliveryProgressTrack}>
          <span
            aria-hidden="true"
            data-delivery-progress
            className={styles.deliveryProgress}
            style={{ transform: "scaleX(1)" }}
          />
        </span>
      </div>
    </section>
  );
}
