"use client";
import { useEffect } from "react";

// Expõe alturas de viewport como CSS vars em :root.
// --vh acompanha a viewport visível; --stable-vh mantém a altura sem teclado
// para telas que não devem encolher quando o teclado virtual abre.
export function ViewportHeightFix() {
  useEffect(() => {
    let stableHeight = window.innerHeight;

    function update() {
      const vp = window.visualViewport;
      const vh = vp?.height ?? window.innerHeight;
      const kh = vp ? Math.max(0, window.innerHeight - vp.offsetTop - vp.height) : 0;
      if (kh < 24) {
        stableHeight = Math.max(vh, window.innerHeight);
      }
      document.documentElement.style.setProperty("--vh", `${vh}px`);
      document.documentElement.style.setProperty("--stable-vh", `${stableHeight}px`);
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
