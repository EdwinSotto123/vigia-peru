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
        // ── Variantes de TEXTO ──────────────────────────────────────────
        // Un color puede servir como marca (punto, barra, relleno, donde el
        // piso es 3:1) y no servir como texto (4.5:1). Medido sobre los tres
        // fondos del producto — paper, paperSoft, paperDeep:
        //   amber #BE7B26 → 3.47 / 3.21 / 2.98   FALLA en los tres
        //   clay  #B26A2E → 4.20 / 3.89 / 3.61   FALLA en los tres
        //   moss  #3F7D43 → 4.97 / 4.60 / 4.27   FALLA sobre paperDeep
        // Eso importaba de verdad: lib/severidad.ts usaba `text-amber` para
        // "Señal media", así que la etiqueta de severidad del propio sistema
        // no alcanzaba el piso que el sistema exige. Estas variantes pasan en
        // los tres fondos (5.08 la peor). Los tonos de arriba se conservan
        // intactos para puntos, barras y rellenos, donde sí son correctos.
        // Mismos tres fondos, salvo donde se indica.
        amberTexto: "#8A5A15",   // 5.91 / 5.46 / 5.08
        mossTexto: "#2F6B36",    // 6.41 / 5.93 / 5.51
        clayTexto: "#8A4F1E",    // 6.53 / 6.04 / 5.61
        // heroGreen #2FA84C da 3.08 sobre papel: sirve como TEXTO GRANDE (piso
        // 3:1, titulares de 24 px o más) y como marca, pero no para una línea
        // de 12 px. crimson #CF3A2C cae a 3.99 sobre su propio crimson-soft,
        // que es justo el par del Badge de error.
        heroGreenTexto: "#16702C", // 6.20 / 5.73 / 5.33 · 5.49 sobre heroGreen-soft
        crimsonTexto: "#8F2318",   // 8.67 / 8.02 / 7.45 · 7.08 sobre crimson-soft
        clay: "#B26A2E",         // CTA secundario (terracota cálido)
        // rust era #CF3A2C. Contra amber #BE7B26 daba ΔE 13.6, por debajo del
        // piso de 15: "señal alta" y "señal media" costaba distinguirlas incluso
        // con visión de color completa. Con #A81E12 el peor par sube a ΔE 18.3 y
        // la escala de severidad completa pasa la validación. Es el encoding del
        // que depende la credibilidad del producto — no era un ajuste de gusto.
        rust: "#A81E12",         // severidad alta
        moss: "#3F7D43",         // verificado / positivo
        amber: { DEFAULT: "#BE7B26", soft: "#F7E8C8" },
        crimson: { DEFAULT: "#CF3A2C", soft: "#FBE3DF" },
        // ── Identidad de marca (referencia del usuario, sept 2026): morado + verde —
        // color de acento del sitio ENTERO (chrome: header, footer, sidebar, CTAs), no
        // solo del hero. El isotipo (vigia_peru_512.png) sigue siendo vino/textil andino
        // — un logo raster no se recolorea — pero eso es normal: el mark queda fijo,
        // el sistema de acento de UI evoluciona. `amber`/`clay`/`moss`/`rust` arriba NO
        // se tocan: son semántica de estado (advertencia/positivo/error), no de marca —
        // ver EstadoPill.tsx y Bitacora.tsx, que dependen de esa escala tipo semáforo.
        heroViolet: { DEFAULT: "#4F3D96", deep: "#332463", soft: "#EFEBFA" },
        heroGreen: { DEFAULT: "#2FA84C", soft: "#E3F6E7" },

        // El bloque "legacy" (bone/ash/coal/void/abyss/slate*/chalk/cyan/
        // fuchsia/navy/violet/emerald) se eliminó: 0 usos reales en app/ y
        // components/, y varios mentían sobre su propio nombre — `cyan` era
        // un marrón #A0512D y `fuchsia` un oxblood #8B2A1E. Un alias que no
        // dice la verdad sobre su color es una trampa para el próximo que
        // lo use de buena fe.
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "'Source Serif Pro'", "Georgia", "serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      // Escala de elevación real: cada nivel tiene offset Y creciente y blur
      // proporcional, así la altura se lee como altura y no como un halo.
      // card/paper/inset se conservan con sus valores exactos — los usan 200+
      // componentes y cambiarlos sería un rediseño encubierto de todo el sitio.
      boxShadow: {
        card: "0 1px 2px rgba(27,22,17,0.06), 0 8px 24px rgba(27,22,17,0.08)",
        paper: "0 2px 0 rgba(27,22,17,0.04), 0 14px 40px -8px rgba(27,22,17,0.18)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -1px 0 rgba(27,22,17,0.05)",
        // Nivel 3 — popover/tooltip: despega del contenido, sigue cerca de él.
        pop: "0 4px 8px -2px rgba(20,23,26,0.10), 0 12px 28px -6px rgba(20,23,26,0.16)",
        // Nivel 4 — drawer/panel lateral: sombra direccional hacia el contenido.
        drawer: "-8px 0 24px -8px rgba(20,23,26,0.18), -1px 0 0 rgba(20,23,26,0.06)",
        // Nivel 5 — diálogo centrado: lo más alto que existe en el producto.
        dialog: "0 16px 32px -8px rgba(20,23,26,0.20), 0 40px 80px -24px rgba(20,23,26,0.28)",
      },
      transitionTimingFunction: {
        // Salida exponencial: arranca rápido y se asienta. Es la curva de todo
        // lo que aparece (paneles, popovers, reveals).
        salida: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        // Rango de producto según Impeccable: 150–250 ms. Nada de coreografía.
        rapido: "150ms",
        normal: "200ms",
        panel: "240ms",
      },
      zIndex: {
        // Orden explícito del chrome, para no volver a escribir z-[9999].
        mapa: "5",
        barra: "20",
        panel: "40",
        overlay: "50",
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
        llamaStep: {
          "0%, 100%": { transform: "rotate(-9deg)" },
          "50%": { transform: "rotate(9deg)" },
        },
        llamaBob: {
          "0%, 50%, 100%": { transform: "translateY(0)" },
          "25%, 75%": { transform: "translateY(-2px)" },
        },
        tooltipIn: {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
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
        llamaStepFront: "llamaStep 0.9s ease-in-out infinite",
        llamaStepBack: "llamaStep 0.9s ease-in-out infinite reverse",
        llamaBob: "llamaBob 0.9s ease-in-out infinite",
        tooltipIn: "tooltipIn 120ms ease-out both",
      },
    },
  },
  plugins: [typography],
};

export default config;
