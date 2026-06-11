import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Paleta principal: papel kraft / periodístico ──
        paper: "#FFFFFF",        // bg principal (blanco)
        paperSoft: "#F5F6F8",    // surfaces (gris muy claro)
        paperDeep: "#EBEEF2",    // recessed
        paperEdge: "#DCE1E7",    // border sutil
        ink: "#14171A",          // texto primario (casi negro frío)
        inkSoft: "#3A4048",      // texto secundario
        mute: "#687180",         // texto muted (cool gray)
        line: "#E4E7EB",         // border default

        // ── Escala secuencial cálida (para el choropleth) ──
        warm0: "#E8DFC7",        // sin data
        warm1: "#D9B97A",        // bajo (sand)
        warm2: "#C28840",        // medio-bajo
        warm3: "#A05A1F",        // medio-alto (tobacco)
        warm4: "#7A2E18",        // alto (oxblood)
        warm5: "#4A150C",        // crítico (deep)

        // ── Acentos ──
        clay: "#B26A2E",         // CTA secundario (terracota cálido)
        rust: "#CF3A2C",         // alerta (rojo moderno)
        moss: "#3F7D43",         // verificado / positivo
        amber: { DEFAULT: "#BE7B26", soft: "#F7E8C8" },
        crimson: { DEFAULT: "#CF3A2C", soft: "#FBE3DF" },

        // ── Legacy (que otros componentes aún referencien) ──
        bone: "#FFFFFF",
        ash: "#687180",
        coal: "#14171A",
        // dark variants para componentes que aún las usen
        void: "#14171A",
        abyss: "#1B1F24",
        slate850: "#21262C",
        slate800: "#2C323A",
        slate700: "#475059",
        chalk: "#FFFFFF",
        chalkMuted: "#9AA3AF",
        cyan: { DEFAULT: "#A0512D", glow: "#C28840" },
        fuchsia: { DEFAULT: "#8B2A1E", glow: "#A05A1F" },
        navy: { DEFAULT: "#1B1611", soft: "#E8DFC7" },
        violet: { DEFAULT: "#5C4F40", glow: "#76695A" },
        emerald: { DEFAULT: "#3D5C2D", glow: "#5A7E45" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        serif: ["'Source Serif Pro'", "Georgia", "serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
        techno: ["'Chakra Petch'", "Inter", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(27,22,17,0.06), 0 8px 24px rgba(27,22,17,0.08)",
        paper: "0 2px 0 rgba(27,22,17,0.04), 0 14px 40px -8px rgba(27,22,17,0.18)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -1px 0 rgba(27,22,17,0.05)",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideIn: {
          from: { opacity: "0", transform: "translateX(20px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeInUp: {
          from: { opacity: "0", transform: "translateY(28px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        floatY: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        floatYSm: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-5px)" },
        },
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(calc(-100% - var(--gap)))" },
        },
        "border-beam": {
          "100%": { "offset-distance": "100%" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
        shimmerSweep: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        fadeIn: "fadeIn 200ms ease-out",
        slideIn: "slideIn 240ms ease-out",
        slideUp: "slideUp 280ms ease-out",
        fadeInUp: "fadeInUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
        floatY: "floatY 6s ease-in-out infinite",
        floatYSm: "floatYSm 4s ease-in-out infinite",
        marquee: "marquee var(--duration, 40s) linear infinite",
        "border-beam": "border-beam calc(var(--duration)*1s) infinite linear",
        pulseSoft: "pulseSoft 2.4s ease-in-out infinite",
        shimmerSweep: "shimmerSweep 3s linear infinite",
      },
    },
  },
  plugins: [typography],
};

export default config;
