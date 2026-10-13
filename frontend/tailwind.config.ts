import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    // Los mapas de estado y severidad (lib/auditoria, lib/contratos, lib/admin…)
    // arman clases de color. Sin esta línea Tailwind no las generaba y las
    // píldoras "Procesando", "En revisión" o "Media" salían en tinta plana.
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Identidad Píxel (2026-10): carbón y verde lima ────────────────────
        // Cada color es una variable CSS (globals.css) con canales RGB: así Tailwind
        // sigue entendiendo `bg-paper/80` y los nombres de siempre (paper, ink,
        // granate, maiz…) apuntan a la paleta nueva sin tocar cada componente.
        //
        // Roles (no los nombres) son los que importan:
        //   paper* = superficies (de la más lejana a la más hundida)
        //   ink*   = texto (claro sobre carbón)      mute = texto terciario
        //   granate = la marca y la acción primaria (hoy lima #D4FF3F)
        //   maiz    = el acento sobre secciones oscuras (también lima)
        // Una banda oscura (`bg-ink`, `bg-granate-deep`, `.sobre-oscuro`) redefine
        // esas variables en su ámbito (globals.css), así `text-paper` sigue siendo
        // "texto claro sobre banda" y `bg-paperSoft` una placa clara dentro de ella.
        paper: "rgb(var(--paper) / <alpha-value>)",
        paperSoft: "rgb(var(--paper-soft) / <alpha-value>)",
        paperDeep: "rgb(var(--paper-deep) / <alpha-value>)",
        paperEdge: "rgb(var(--paper-edge) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        inkSoft: "rgb(var(--ink-soft) / <alpha-value>)",
        mute: "rgb(var(--mute) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",

        // Color por intención de la navegación (globals.css: [data-intencion]).
        acento: {
          DEFAULT: "rgb(var(--acento) / <alpha-value>)",
          soft: "rgb(var(--acento-soft) / <alpha-value>)",
          borde: "rgb(var(--acento-borde) / <alpha-value>)",
          texto: "rgb(var(--acento-texto) / <alpha-value>)",
        },

        // Escala secuencial del choropleth: sin data → más intenso (lima).
        warm0: "#1B2323",
        warm1: "#3C4F12",
        warm2: "#6D8A15",
        warm3: "#A6CC25",
        warm4: "#D4FF3F",
        warm5: "#F4FFB3",

        // ── Estado ──
        // Sobre carbón los tonos oscuros de antes no llegan a 4.5:1; los de texto
        // son las versiones claras de cada matiz. Severidad alta (rojo) y media
        // (ámbar) conservan su distancia de color; verde = verificado.
        amberTexto: "rgb(var(--amber-texto) / <alpha-value>)",
        mossTexto: "rgb(var(--moss-texto) / <alpha-value>)",
        clayTexto: "rgb(var(--clay-texto) / <alpha-value>)",
        crimsonTexto: "rgb(var(--crimson-texto) / <alpha-value>)",
        clay: "rgb(var(--clay) / <alpha-value>)",
        rust: "rgb(var(--rust) / <alpha-value>)",
        moss: "rgb(var(--moss) / <alpha-value>)",
        amber: { DEFAULT: "rgb(var(--amber) / <alpha-value>)", soft: "rgb(var(--amber-soft) / <alpha-value>)" },
        crimson: { DEFAULT: "rgb(var(--crimson) / <alpha-value>)", soft: "rgb(var(--crimson-soft) / <alpha-value>)" },

        // ── Marca ── (el nombre `granate` se conserva por los ~700 usos; el color es lima)
        granate: {
          50: "rgb(var(--granate-50) / <alpha-value>)",
          soft: "rgb(var(--granate-soft) / <alpha-value>)",
          200: "rgb(var(--granate-200) / <alpha-value>)",
          300: "rgb(var(--granate-300) / <alpha-value>)",
          400: "rgb(var(--granate-400) / <alpha-value>)",
          500: "rgb(var(--granate-500) / <alpha-value>)",
          DEFAULT: "rgb(var(--granate) / <alpha-value>)",
          700: "rgb(var(--granate-700) / <alpha-value>)",
          deep: "rgb(var(--granate-deep) / <alpha-value>)",
          900: "rgb(var(--granate-900) / <alpha-value>)",
        },
        maiz: { DEFAULT: "rgb(var(--maiz) / <alpha-value>)", soft: "rgb(var(--maiz-soft) / <alpha-value>)" },
        // Series categóricas de gráficos (antes la paleta del tejido). SÓLO decoración
        // y series: nunca significa estado.
        textil: {
          ladrillo: "#FF6B5B",
          achiote: "#FFB020",
          ocre: "#D4FF3F",
          maiz: "#E7F0EE",
          tierra: "#8FA3A0",
          anil: "#6C8CFF",
          verde: "#3DDC97",
        },
        // Franja bicolor de la bandera: ya no se usa; se conserva por compatibilidad.
        rojoPeru: "#D91023",
        medalla: {
          oro: "#F0B83C",
          oroOscuro: "#B8841C",
          plata: "#C9CFD6",
          plataOscura: "#7F8A96",
          bronce: "#D08C4E",
          bronceOscuro: "#8A5424",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
        // Títulos: Space Grotesk (identidad Píxel).
        display: ["var(--font-display)", "Space Grotesk", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "'Source Serif Pro'", "Georgia", "serif"],
        mono: ["var(--font-mono)", "'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      // Escala de elevación real: cada nivel tiene offset Y creciente y blur
      // proporcional, así la altura se lee como altura y no como un halo.
      // card/paper/inset se conservan con sus valores exactos — los usan 200+
      // componentes y cambiarlos sería un rediseño encubierto de todo el sitio.
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35)",
        paper: "0 2px 0 rgba(0,0,0,0.2), 0 14px 40px -8px rgba(0,0,0,0.55)",
        inset: "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.3)",
        pop: "0 4px 8px -2px rgba(0,0,0,0.4), 0 12px 28px -6px rgba(0,0,0,0.55)",
        drawer: "-8px 0 24px -8px rgba(0,0,0,0.6), -1px 0 0 rgba(255,255,255,0.05)",
        dialog: "0 16px 32px -8px rgba(0,0,0,0.6), 0 40px 80px -24px rgba(0,0,0,0.7)",
      },
      // Esquinas más contenidas: la identidad Píxel es de rejilla, no de burbujas.
      // Space Grotesk llega a 700: `font-extrabold` (800) se sintetizaba y apelmazaba los títulos.
      fontWeight: { extrabold: "700", black: "700" },
      borderRadius: { xl: "10px", "2xl": "12px", "3xl": "16px" },
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
        // Podio de aliados: la columna sube, la medalla aparece y la corona cae (§14.6).
        // Sólo transform: el contenido nunca empieza oculto (nada de opacity 0 del servidor).
        podioSube: { "0%": { transform: "scaleY(0.12)" }, "100%": { transform: "scaleY(1)" } },
        medallaAparece: {
          "0%": { transform: "translateY(28px) scale(0.55)" },
          "70%": { transform: "translateY(-6px) scale(1.06)" },
          "100%": { transform: "translateY(0) scale(1)" },
        },
        coronaCae: {
          "0%": { transform: "translateY(-22px) rotate(-14deg)" },
          "65%": { transform: "translateY(3px) rotate(5deg)" },
          "100%": { transform: "translateY(0) rotate(0)" },
        },
        brilloOro: { "0%, 100%": { filter: "brightness(1)" }, "50%": { filter: "brightness(1.18)" } },
        // La llamita "camina" en su lugar mientras algo carga: un paso arriba y abajo.
        caminar: {
          "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
          "25%": { transform: "translateY(-2px) rotate(-1.5deg)" },
          "75%": { transform: "translateY(-1px) rotate(1deg)" },
        },

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
        /* El pulso que recorre el riel de un carril del pipeline. El elemento mide
           todo el riel y el pulso es su fondo (20 % de ancho), así el `translateX`
           en % es relativo al riel y no al pulso: mismo recorrido que el `left` de
           antes (-22 % → 100 %), pero sin recalcular el layout de la página en cada
           cuadro (con `left` la portada hacía un layout por cuadro, en pantalla o no). */
        rielPulso: {
          "0%": { transform: "translateX(-22%)", opacity: "0" },
          "12%": { opacity: "1" },
          "88%": { opacity: "1" },
          "100%": { transform: "translateX(100%)", opacity: "0" },
        },
        /* La ola que recorre el DAG (cada paso se enciende en su turno) ya no vive acá:
           es la clase `.paso-corriendo` de app/globals.css, con el resplandor en un
           pseudo-elemento que sólo cambia de opacidad. */
        /* Los datos corriendo por un cable del diagrama de orquestación. El
           desplazamiento es -32 con un patrón de período 16: dos períodos
           exactos, así que el bucle no tiene costura. */
        fluirDatos: {
          to: { strokeDashoffset: "-32" },
        },
        /* El anillo del orquestador: no gira ni parpadea, respira. Es el único
           nodo que está siempre encendido porque es el único que no se apaga. */
        latidoNodo: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.55" },
          "50%": { transform: "scale(1.06)", opacity: "0.15" },
        },
        /* El destello que marca dónde está la astilla de lo leído en la barra a
           escala real: 98 de 18 394 son 7 px y sin esto no se encuentran. */
        astillaViva: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(212, 255, 63,0.55)" },
          "50%": { boxShadow: "0 0 18px 3px rgba(212, 255, 63,0.85)" },
        },
        /* El corazón del botón de financiar: dos golpes, como un latido, y
           quieto. Sólo al pasar el cursor; nunca en bucle. */
        latir: {
          "0%, 100%": { transform: "scale(1)" },
          "14%": { transform: "scale(1.28)" },
          "28%": { transform: "scale(1)" },
          "42%": { transform: "scale(1.16)" },
          "70%": { transform: "scale(1)" },
        },
        /* La barra de la fuente elegida en el explorador de fuentes: se llena
           mientras la selección avanza sola. La duración la pone el componente. */
        llenarBarra: {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
      },
      animation: {
        podioSube: "podioSube 0.9s cubic-bezier(0.22, 1, 0.36, 1) both",
        medallaAparece: "medallaAparece 0.7s cubic-bezier(0.22, 1, 0.36, 1) both",
        coronaCae: "coronaCae 0.8s cubic-bezier(0.22, 1, 0.36, 1) both",
        brilloOro: "brilloOro 2.8s ease-in-out infinite",
        caminar: "caminar 0.9s ease-in-out infinite",

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
        rielPulso: "rielPulso 3.8s ease-in-out infinite",
        astillaViva: "astillaViva 2.6s ease-in-out infinite",
        // Cuatro vueltas (unos 6 s) al entrar a la sección y después quieto. El trazo punteado no se puede
        // animar en la GPU: mientras corre, obliga al navegador a trabajar en CADA cuadro por toda la página
        // (a mitad de la portada, un 40 % del tiempo sin que nadie tocara nada). Fuera de pantalla se pausa
        // (PausaFueraDePantalla) y retoma al volver hasta completar sus vueltas.
        fluirDatos: "fluirDatos 1.4s linear 4",
        latidoNodo: "latidoNodo 2.8s ease-in-out infinite",
        latir: "latir 900ms ease-in-out",
        llenarBarra: "llenarBarra linear both",
      },
    },
  },
  plugins: [typography],
};

export default config;
