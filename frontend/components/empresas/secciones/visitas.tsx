import Link from "next/link";
import { Ayuda, CuerpoDetalle, DatosClave, EstadoVacio, FuenteDato, Nota, PieDetalle, type DatoClave } from "@/components/patrones";
import { CeldaFecha, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { fecha, fechaConAnio, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { VISITAS_EN_LINEA, avisoVisitas, registroVisita } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { rutaEmpresa, type VisitaEmpresa } from "@/lib/empresas";
import { rutaContrato } from "@/lib/rutas";
import { entidadTexto, NoCargo, opcionesLocales, paraClave } from "./comun";
import { P_CONTRATOS } from "./contratos";
import { P_ORDENES } from "./ordenes";

/** La pestaña Visitas: las visitas de su gente a entidades del Estado. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Visitas ──────────────────────────────────────────────────────────────────

const COLUMNAS_VISITAS: Columna[] = [
  { clave: "fecha", titulo: "Fecha", ancho: "92px", desde: "md", apilar: true },
  { clave: "entidad", titulo: "Entidad visitada", ancho: "minmax(0,1.4fr)" },
  { clave: "quien", titulo: "Quién fue", ancho: "minmax(0,1fr)", desde: "lg" },
  {
    clave: "despues", titulo: "Después", ancho: "minmax(0,0.9fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué dice «Después»?">
        Si esa entidad le adjudicó un contrato o le dio una orden a la empresa después de la visita: lo primero que le dio y
        cuántos días después. Una visita no prueba nada: dice qué revisar.
      </Ayuda>
    ),
  },
];

/** «Orden de servicio» / «Contrato» / «Contrato en consorcio»: qué fue lo primero que le dio la entidad. */
function queFue(v: VisitaEmpresa): string {
  if (v.despuesTipo === "contrato") return "Contrato";
  if (v.despuesTipo === "consorcio") return "Contrato en consorcio";
  const t = (v.primero?.tipoOrden ?? "").toLowerCase();
  return t.includes("servicio") ? "Orden de servicio" : t.includes("compra") ? "Orden de compra" : "Orden";
}

/** «ese mismo día» / «13 días después». */
const cuando = (d: number | null) => (d === 0 ? "ese mismo día" : `${plural(d ?? 0, "día", "días")} después`);

/**
 * Dónde ver lo que le dio: la orden en su lista de órdenes (buscada por su número, en esa entidad) o el contrato en su
 * ficha (por su OCID) o, si no está en la base, en su lista de contratos buscado por su código.
 */
function enlaceDespues(ruc: string, v: VisitaEmpresa): { texto: string; href: string } | null {
  const p = v.primero;
  if (!p || !v.entidadRuc) return null;
  if (v.despuesTipo === "orden") {
    return p.numero ? { texto: "Ver la orden", href: rutaEmpresa(ruc, "ordenes", { [P_ORDENES.entidad]: v.entidadRuc, [P_ORDENES.q]: p.numero }) } : null;
  }
  if (p.ocid) return { texto: "Ver el contrato", href: rutaContrato(p.ocid) };
  const q = p.codigo ?? p.numero;
  return q ? { texto: "Ver el contrato", href: rutaEmpresa(ruc, "contratos", { [P_CONTRATOS.entidad]: v.entidadRuc, [P_CONTRATOS.q]: q }) } : null;
}

export async function VisitasEmpresa({ ruc, datos }: { ruc: string; datos: Promise<{ total: number; visitas: VisitaEmpresa[]; hasta?: string | null } | null> }) {
  const d = await datos;
  if (!d) return <NoCargo que="sus visitas" />;
  if (!d.total) {
    return (
      <EstadoVacio compacto titulo="Sin visitas registradas">
        Ningún socio, representante ni directivo de la empresa figura en los registros de visitas cargados, ni alguien que dijera
        venir de ella.
      </EstadoVacio>
    );
  }
  const filas: FilaFiltrable[] = d.visitas.map((v, i) => {
    const entidad = entidadTexto(v.entidad);
    const registro = registroVisita(v.fecha, v.fuente);
    // CUÁL fue lo primero que le dio (el usuario: «le dio una orden ese mismo día… pero no dice cuál»): su número y monto
    // en la celda; qué se compró, lo de los 90 días siguientes y si ya le vendía, en el detalle.
    const p = v.primero;
    const despues = v.despues ? (
      <span className="block text-meta text-ink">
        {queFue(v)} <span className="font-semibold">{cuando(v.diasDespues)}</span>
        {p && (p.numero || p.monto != null) && (
          <span className="block text-rotulo text-mute">
            {[p.numero ? `N.° ${p.numero}` : null, p.monto != null ? soles(p.monto) : null].filter(Boolean).join(", ")}
          </span>
        )}
      </span>
    ) : v.antes ? (
      <span className="text-meta text-mute">Le vendía antes, no después</span>
    ) : v.entidadRuc ? (
      <span className="text-meta text-mute">No le vendió (en lo cargado)</span>
    ) : (
      <span className="text-meta text-mute">Sin cruce con sus compras</span>
    );
    const enlace = enlaceDespues(ruc, v);
    const datosDespues: DatoClave[] = v.despues
      ? [
          {
            etiqueta: "Lo primero después",
            valor: `${queFue(v)}${p?.numero ? ` N.° ${p.numero}` : ""}, del ${fechaConAnio(v.despues)} (${cuando(v.diasDespues)} de la visita)`,
          },
          ...(p?.descripcion ? [{ etiqueta: "Qué se compró", valor: `«${oracion(p.descripcion)}»` }] : []),
          {
            etiqueta: v.despuesTipo === "consorcio" ? "Adjudicado al consorcio" : "Monto",
            valor: p?.monto != null ? soles(p.monto) : "Sin monto en soles",
            mono: p?.monto != null,
          },
          ...(v.en90
            ? [{
                etiqueta: "En los 90 días desde la visita",
                valor: [
                  v.en90.ordenes ? `${plural(v.en90.ordenes, "orden", "órdenes")}${v.en90.montoOrdenes ? ` por ${solesCompacto(v.en90.montoOrdenes)}` : ""}` : null,
                  v.en90.contratos ? plural(v.en90.contratos, "contrato", "contratos") : null,
                ].filter(Boolean).join(" y ") || "Sólo eso",
              }]
            : []),
          {
            etiqueta: "Antes de la visita",
            valor: v.antes ? "Ya le vendía: es un proveedor de antes, no algo nuevo" : "Nunca le había vendido (en lo cargado)",
          },
        ]
      : [{
          etiqueta: "Después de la visita",
          valor: v.antes ? "Le vendía antes; nada desde esa fecha" : v.entidadRuc ? "Esa entidad no le adjudicó ni le compró" : "No reconocemos la entidad visitada en las compras",
        }];
    return {
      id: `${v.fecha}-${i}`,
      buscable: `${entidad} ${v.cargoFuncionario ?? ""} ${v.area ?? ""} ${v.motivo ?? ""} ${v.via}`,
      valores: {
        entidad: v.entidad ? paraClave(v.entidad) : null,
        via: v.via,
        despues: v.despues ? (v.despuesTipo === "consorcio" ? "contrato" : v.despuesTipo ?? "contrato") : v.antes ? "antes" : "no_cliente",
        nueva: v.despues ? (v.antes ? "ya" : "primera") : null,
        anio: v.fecha?.slice(0, 4) ?? null,
      },
      claves: { fecha: v.fecha, dias: v.diasDespues },
      celdas: {
        fecha: <CeldaFecha fecha={v.fecha} />,
        entidad: (
          <CeldaPrincipal
            titulo={entidad}
            meta={[
              v.cargoFuncionario && <Dato key="cargo" tipo="cargo" nombre="Cargo de quien recibió">{tituloNatural(v.cargoFuncionario)}</Dato>,
              v.motivo && <span key="motivo" className="text-inkSoft">{oracion(v.motivo).slice(0, 90)}</span>,
            ]}
          />
        ),
        quien: (
          <span className="text-meta text-ink">
            {v.visitante ?? "Sin nombre"} <span className="text-inkSoft">{`(${v.via})`}</span>
          </span>
        ),
        despues,
      },
      detalle: {
        titulo: `Visita a ${entidad}`,
        etiqueta: `Ver el detalle de la visita del ${v.fecha ? fechaConAnio(v.fecha) : ""}`.trim(),
        descripcion: v.fecha ? fechaConAnio(v.fecha) : undefined,
        contenido: (
          <CuerpoDetalle>
            <DatosClave
              items={[
                {
                  etiqueta: "Quién fue",
                  // Su socio, representante o directivo está en «Su gente» (quien sólo dijo venir de ella, no).
                  valor: v.visitante && /socio|representante|directivo/i.test(v.via) ? (
                    <Link href={rutaEmpresa(ruc, "socios")} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                      {v.visitante}
                    </Link>
                  ) : (
                    v.visitante
                  ),
                },
                { etiqueta: "Qué es de la empresa", valor: v.via },
                { etiqueta: "Dijo venir de", valor: v.entidadDeclarada },
                {
                  etiqueta: "Entidad visitada",
                  valor: v.entidadRuc ? (
                    <Link href={`/entidad/${v.entidadRuc}`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                      {entidad}
                    </Link>
                  ) : (
                    entidad
                  ),
                },
                { etiqueta: "Cargo de quien la recibió", valor: v.cargoFuncionario ? tituloNatural(v.cargoFuncionario) : null },
                { etiqueta: "Área", valor: v.area ? tituloNatural(v.area) : null },
                { etiqueta: "Motivo", valor: v.motivo ? oracion(v.motivo) : null },
                { etiqueta: "Lugar", valor: v.lugar },
              ]}
            />
            <DatosClave items={datosDespues} />
            {v.despues && (
              <p className="text-rotulo leading-relaxed text-mute">
                Una visita no prueba nada: dice qué revisar. Pesa más si la empresa nunca le había vendido y si lo que ganó llegó
                pocos días después.
              </p>
            )}
          </CuerpoDetalle>
        ),
        // La orden o el contrato que le dio después y el registro del que salió la visita (el del Congreso, el reporte
        // mensual de la PNDA, que es sólo de Loreto, o el registro en línea de la PCM).
        pie: (
          <PieDetalle
            principal={enlace ? <EnlaceAccion href={enlace.href} flecha>{enlace.texto}</EnlaceAccion> : undefined}
            secundarias={
              <FuenteDato
                fuente={registro.fuente}
                href={registro.href}
                enlaces={[registro.href !== VISITAS_EN_LINEA && { texto: "Registro de visitas en línea", href: VISITAS_EN_LINEA }]}
              />
            }
          />
        ),
      },
    };
  });
  const aClientes = d.visitas.filter((v) => v.despues || v.antes).length;
  const despues = d.visitas.filter((v) => v.despues).length;
  return (
    <div className="space-y-3">
      {/* Corto (menos de 140 caracteres, la guardia visual): quiénes son «su gente» lo dice la columna «Quién fue». */}
      <p className="max-w-prose text-meta text-inkSoft">
        {`${plural(d.total, "visita", "visitas")} de su gente`}
        {aClientes ? `; ${numero(aClientes)} a entidades que le compran` : ""}
        {despues ? `; tras ${plural(despues, "visita", "visitas")}, la entidad le dio algo.` : "."}
      </p>
      {avisoVisitas(d.hasta) && <Nota>{avisoVisitas(d.hasta)}</Nota>}
      <TablaFiltrable
        columnas={COLUMNAS_VISITAS}
        filas={filas}
        etiqueta="Visitas registradas de su gente"
        tam={20}
        nombre="visitas"
        buscar={{ placeholder: "Buscar entidad, cargo o motivo…", etiqueta: "Buscar en sus visitas" }}
        filtros={[
          { clave: "entidad", etiqueta: "Entidad visitada", corta: "Entidad", opciones: opcionesLocales(filas.map((f) => f.valores?.entidad as string | null), (v) => tituloNatural(v)) },
          { clave: "via", etiqueta: "Quién fue", corta: "Quién fue", opciones: opcionesLocales(filas.map((f) => f.valores?.via as string), (v) => v.charAt(0).toUpperCase() + v.slice(1)) },
          {
            clave: "despues", etiqueta: "Después de la visita", corta: "Después",
            opciones: [
              { valor: "contrato", etiqueta: "Le adjudicó un contrato" }, { valor: "orden", etiqueta: "Le dio una orden" },
              { valor: "antes", etiqueta: "Le vendió antes, no después" }, { valor: "no_cliente", etiqueta: "No le vende" },
            ],
          },
          {
            clave: "nueva", etiqueta: "Antes de la visita", corta: "Antes",
            opciones: [{ valor: "primera", etiqueta: "Nunca le había vendido" }, { valor: "ya", etiqueta: "Ya le vendía" }],
          },
          { clave: "anio", etiqueta: "Año de la visita", corta: "Año", opciones: opcionesLocales(filas.map((f) => f.valores?.anio as string | null), (v) => v).reverse() },
        ]}
        ordenes={[
          { valor: "reciente", etiqueta: "Más recientes", clave: "fecha", dir: "desc" },
          { valor: "antigua", etiqueta: "Más antiguas", clave: "fecha", dir: "asc" },
          { valor: "rapido", etiqueta: "Lo que le dieron más pronto", clave: "dias", dir: "asc" },
        ]}
      />
    </div>
  );
}
