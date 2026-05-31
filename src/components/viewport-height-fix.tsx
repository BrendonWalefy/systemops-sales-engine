"use client";
import { useEffect } from "react";

// iOS Safari não redimensiona o viewport quando o teclado abre.
// Este componente usa a Visual Viewport API para medir a altura real
// disponível e expõe como --vh, que o CSS usa no lugar de dvh/vh.
export function ViewportHeightFix() {
  useEffect(() => {
    function update() {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--vh", `${h}px`);
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
