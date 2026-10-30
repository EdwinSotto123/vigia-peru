/**
 * Datos estructurados de schema.org (JSON-LD) dentro de la página: lo que los buscadores leen para entender qué es cada
 * ficha (una entidad del Estado, una empresa, la ruta de navegación). Sirve en el servidor y en componentes de cliente.
 *
 * Se escapan `<`, `>` y `&`: un nombre que viene de un registro público podría traer `</script>` y cerrar la etiqueta.
 */
export function DatosEstructurados({ datos }: { datos: Record<string, unknown> }) {
  const json = JSON.stringify(datos).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
