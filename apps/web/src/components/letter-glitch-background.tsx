"use client";

import { useEffect, useRef } from "react";

interface LetterGlitchBackgroundProps {
  characters?: string;
  className?: string;
  glitchColors?: string[];
  glitchSpeed?: number;
}

interface GlitchCell {
  character: string;
  color: string;
}

const DEFAULT_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789论证证据反驳立论质询总结";
const DEFAULT_GLITCH_COLORS = ["#456c58", "#8fa998", "#b57932"];

export function LetterGlitchBackground({
  characters = DEFAULT_CHARACTERS,
  className = "",
  glitchColors = DEFAULT_GLITCH_COLORS,
  glitchSpeed = 140
}: LetterGlitchBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const alphabet = Array.from(characters);
    const cellWidth = 12;
    const cellHeight = 22;
    let cells: GlitchCell[] = [];
    let columns = 0;
    let rows = 0;
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastUpdate = performance.now();

    const randomCharacter = () => alphabet[Math.floor(Math.random() * alphabet.length)] ?? "A";
    const randomColor = () => glitchColors[Math.floor(Math.random() * glitchColors.length)] ?? "#8fa998";

    const initialize = () => {
      columns = Math.max(1, Math.ceil(width / cellWidth));
      rows = Math.max(1, Math.ceil(height / cellHeight));
      cells = Array.from({ length: columns * rows }, () => ({
        character: randomCharacter(),
        color: randomColor()
      }));
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.font = "15px ui-monospace, SFMono-Regular, Consolas, monospace";
      context.textBaseline = "top";
      cells.forEach((cell, index) => {
        context.fillStyle = cell.color;
        context.fillText(cell.character, (index % columns) * cellWidth, Math.floor(index / columns) * cellHeight);
      });
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      initialize();
      draw();
    };

    const animate = (time: number) => {
      if (document.hidden || motionQuery.matches) {
        frame = 0;
        draw();
        return;
      }

      if (time - lastUpdate >= glitchSpeed) {
        const updateCount = Math.max(1, Math.floor(cells.length * 0.035));
        for (let index = 0; index < updateCount; index += 1) {
          const cell = cells[Math.floor(Math.random() * cells.length)];
          if (!cell) continue;
          cell.character = randomCharacter();
          cell.color = randomColor();
        }
        lastUpdate = time;
        draw();
      }
      frame = window.requestAnimationFrame(animate);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      lastUpdate = performance.now();
      if (motionQuery.matches || document.hidden) {
        frame = 0;
        draw();
        return;
      }
      frame = window.requestAnimationFrame(animate);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    motionQuery.addEventListener("change", start);
    document.addEventListener("visibilitychange", start);
    resize();
    start();

    return () => {
      resizeObserver.disconnect();
      motionQuery.removeEventListener("change", start);
      document.removeEventListener("visibilitychange", start);
      window.cancelAnimationFrame(frame);
    };
  }, [characters, glitchColors, glitchSpeed]);

  return (
    <div className={`letter-glitch-background ${className}`.trim()} aria-hidden="true">
      <canvas ref={canvasRef} />
      <div className="letter-glitch-vignette" />
    </div>
  );
}
