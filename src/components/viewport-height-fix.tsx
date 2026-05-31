"use client";
import { useEffect } from "react";

// Expõe --vh (altura do visual viewport) e --keyboard-height (altura do teclado)
// como CSS vars em :root. Usado em todo o app para alturas corretas no iOS Safari.
export function ViewportHeightFix() {
  useEffect(() => {
    function update() {
      const vp = window.visualViewport;
      const vh = vp?.height ?? window.innerHeight;
      const kh = vp ? Math.max(0, window.innerHeight - vp.offsetTop - vp.height) : 0;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
      document.documentElement.style.setProperty("--keyboard-height", `${kh}px`);
    }

    update();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);

    return () => {
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return null;
}
