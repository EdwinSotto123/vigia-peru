/**
 * Imprimir (o guardar como PDF) SÓLO una parte de la página: una copia en `#vigia-impresion`, que globals.css deja como lo
 * único en el papel (sin menús, cabeceras ni franjas: en pantalla nada se mueve) y en modo día. El mismo mecanismo que la
 * evidencia de un antecedente (components/contratos/TablaEvidencia.tsx); éste lo usa el informe para control.
 *
 *   `estilos`   CSS sólo para esta copia (va dentro de ella, no toca globals.css)
 *   `preparar`  ajustes a la copia antes de imprimir (abrir los <details>, quitar botones)
 */
export function imprimirParte(objetivo: HTMLElement, opciones: { estilos?: string; preparar?: (copia: HTMLElement) => void } = {}): void {
  document.getElementById("vigia-impresion")?.remove();
  const html = document.documentElement;
  const modo = html.dataset.modo;
  const copia = document.createElement("div");
  copia.id = "vigia-impresion";
  if (opciones.estilos) {
    const estilo = document.createElement("style");
    estilo.textContent = opciones.estilos;
    copia.appendChild(estilo);
  }
  const clon = objetivo.cloneNode(true) as HTMLElement;
  opciones.preparar?.(clon);
  copia.appendChild(clon);
  document.body.appendChild(copia);
  document.body.dataset.imprimir = "parte";
  html.dataset.modo = "dia"; // en papel, siempre el modo día
  let listo = false;
  const impresora = window.matchMedia("print");
  const fin = () => {
    if (listo) return;
    listo = true;
    copia.remove();
    delete document.body.dataset.imprimir;
    if (modo) html.dataset.modo = modo;
    else delete html.dataset.modo;
    window.removeEventListener("afterprint", fin);
    impresora.removeEventListener("change", alCambiar);
  };
  const alCambiar = (e: MediaQueryListEvent) => {
    if (!e.matches) fin();
  };
  window.addEventListener("afterprint", fin);
  impresora.addEventListener("change", alCambiar);
  window.print();
}

/** Baja un texto como archivo («informe-control-1250529.md»). */
export function descargarTexto(texto: string, nombre: string, tipo = "text/markdown;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
