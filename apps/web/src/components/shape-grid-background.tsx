"use client";

import { useEffect, useRef } from "react";

interface ShapeGridBackgroundProps {
  borderColor?: string;
  className?: string;
  hoverFillColor?: string;
  hoverTrailAmount?: number;
  speed?: number;
  squareSize?: number;
}

export function ShapeGridBackground({
  borderColor = "rgba(31, 77, 58, 0.2)",
  className = "",
  hoverFillColor = "rgba(154, 91, 20, 0.2)",
  hoverTrailAmount = 5,
  speed = 12,
  squareSize = 42
}: ShapeGridBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cellOpacities = new Map<string, number>();
    const trail: string[] = [];
    let frame = 0;
    let width = 0;
    let height = 0;
    let offsetX = 0;
    let offsetY = 0;
    let lastTime = performance.now();
    let hoveredCell: string | null = null;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;
      context.strokeStyle = borderColor;

      const normalizedX = ((offsetX % squareSize) + squareSize) % squareSize;
      const normalizedY = ((offsetY % squareSize) + squareSize) % squareSize;
      const columns = Math.ceil(width / squareSize) + 2;
      const rows = Math.ceil(height / squareSize) + 2;

      for (let column = -1; column < columns; column += 1) {
        for (let row = -1; row < rows; row += 1) {
          const x = column * squareSize + normalizedX;
          const y = row * squareSize + normalizedY;
          const key = `${column},${row}`;
          const opacity = cellOpacities.get(key) ?? 0;
          if (opacity > 0.005) {
            context.save();
            context.globalAlpha = opacity;
            context.fillStyle = hoverFillColor;
            context.fillRect(x, y, squareSize, squareSize);
            context.restore();
          }
          context.strokeRect(x, y, squareSize, squareSize);
        }
      }
    };

    const animate = (time: number) => {
      if (document.hidden || motionQuery.matches) {
        frame = 0;
        draw();
        return;
      }

      const elapsed = Math.min(time - lastTime, 64) / 1000;
      lastTime = time;
      offsetX -= speed * elapsed;
      offsetY -= speed * elapsed * 0.35;

      for (const [key, opacity] of cellOpacities) {
        const target = key === hoveredCell ? 1 : 0;
        const next = opacity + (target - opacity) * (target ? 0.28 : 0.055);
        if (next < 0.005) cellOpacities.delete(key);
        else cellOpacities.set(key, next);
      }

      draw();
      frame = window.requestAnimationFrame(animate);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      lastTime = performance.now();
      if (motionQuery.matches || document.hidden) {
        frame = 0;
        draw();
        return;
      }
      frame = window.requestAnimationFrame(animate);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (motionQuery.matches) return;

      const rect = canvas.getBoundingClientRect();
      const normalizedX = ((offsetX % squareSize) + squareSize) % squareSize;
      const normalizedY = ((offsetY % squareSize) + squareSize) % squareSize;
      const column = Math.floor((event.clientX - rect.left - normalizedX) / squareSize);
      const row = Math.floor((event.clientY - rect.top - normalizedY) / squareSize);
      const nextCell = `${column},${row}`;
      if (nextCell === hoveredCell) return;

      if (hoveredCell && hoverTrailAmount > 0) {
        trail.unshift(hoveredCell);
        trail.splice(hoverTrailAmount);
        trail.forEach((key, index) => {
          cellOpacities.set(key, Math.max(cellOpacities.get(key) ?? 0, (trail.length - index) / (trail.length + 1)));
        });
      }
      hoveredCell = nextCell;
      cellOpacities.set(nextCell, 1);
    };

    const handlePointerLeave = () => {
      hoveredCell = null;
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerleave", handlePointerLeave);
    motionQuery.addEventListener("change", start);
    document.addEventListener("visibilitychange", start);
    resize();
    start();

    return () => {
      resizeObserver.disconnect();
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerleave", handlePointerLeave);
      motionQuery.removeEventListener("change", start);
      document.removeEventListener("visibilitychange", start);
      window.cancelAnimationFrame(frame);
    };
  }, [borderColor, hoverFillColor, hoverTrailAmount, speed, squareSize]);

  return <canvas ref={canvasRef} className={`shape-grid-background ${className}`.trim()} aria-hidden="true" />;
}
