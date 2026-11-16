"use client";

import type { ReactNode } from "react";
import { DetalleSenal } from "@/components/agentes/ListaSenales";
import { nombreDeAgente } from "@/components/agentes/catalogo";
import type { SenalAgente } from "@/components/agentes/senales";
import { descripcionDeRegla, etiquetaDeRegla, useReglasPerfil } from "@/components/agentes/useReglasPerfil";
import { BloqueDetalle, CuerpoDetalle } from "@/components/patrones";
import { Revelar } from "@/components/ui/Revelar";
import { Severidad } from "@/components/ui/Severidad";
import { reglaLabel } from "@/lib/auditoria";
import { plural } from "@/lib/formato";
import { peorSeveridad } from "@/lib/severidad";
import type { ContextoSenal } from "./directorio";
import { SobreQuien } from "./SobreQuien";

/**
 * El panel lateral de una señal del dictamen: el mismo en la cronología («Qué pasó»), en la lista de «Por qué llama la
 * atención» y en la tabla de la pestaña Señales (pedido del usuario del 2026-11-16: los chips de la cronología saltaban a
 * otra parte de la página y «Ver la evidencia completa» cambiaba de pestaña). Arriba, sobre quién es la señal; después lo
 * que se encontró, la norma, quién la encontró y qué no prueba.
 *
 * Con varias señales de la misma regla (tres «Señal en los documentos» en un mismo paso), el panel las trae todas,
 * numeradas, y dice una sola vez de quién se habla y qué mira la regla.
 */
export function CuerpoSenal({ senales, ctx, perfil }: { senales: SenalAgente[]; ctx: ContextoSenal | null; perfil?: string | null }) {
  const { reglas } = useReglasPerfil(perfil);
  if (senales.length === 0) return null;
  const regla = senales[0].regla;
  const etiqueta = etiquetaDeRegla(regla, reglas);
  const descripcion = descripcionDeRegla(regla, reglas);
  const sobre = ctx ? (
    <SobreQuien regla={regla} evidencias={senales.map((s) => s.evidencia)} ctx={ctx} otrasEmpresas={senales.flatMap((s) => s.otrasEmpresas ?? [])} />
  ) : null;

  if (senales.length === 1) return <DetalleSenal senal={senales[0]} etiqueta={etiqueta} descripcion={descripcion} contexto={sobre} />;

  return (
    <CuerpoDetalle>
      {sobre}
      {descripcion && (
        <BloqueDetalle titulo="Qué mira esta regla">
          <p>{descripcion}</p>
        </BloqueDetalle>
      )}
      <BloqueDetalle titulo={`Los ${senales.length} hallazgos de esta regla`}>
        <ol className="space-y-3">
          {senales.map((s, i) => (
            <li key={i} className="rounded-xl border border-line px-3.5 py-3">
              <p className="mb-2 text-rotulo font-semibold uppercase tracking-wide text-mute">
                Hallazgo {i + 1} de {senales.length}
              </p>
              <DetalleSenal senal={s} etiqueta={etiqueta} descripcion={null} sinGenerales />
            </li>
          ))}
        </ol>
      </BloqueDetalle>
      <BloqueDetalle titulo="Qué no prueba esto">
        <p className="text-inkSoft">
          Son señales de riesgo, no una acusación: cada una es un indicio que hay que verificar contra la fuente oficial antes de
          publicarlo o denunciarlo.
        </p>
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}

/** La línea bajo el título del panel: la gravedad, quién la encontró y, con varias, cuántas son. */
function descripcionPanel(senales: SenalAgente[]): ReactNode {
  const peor = peorSeveridad(senales) ?? "baja";
  const agentes = Array.from(new Set(senales.map((s) => nombreDeAgente(s.agenteBruto ?? s.agente))));
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Severidad bandera={peor} formato="linea" />
      {senales.length > 1 && <span>{plural(senales.length, "hallazgo", "hallazgos")}</span>}
      {agentes.length === 1 && (
        <span>
          la encontró <strong className="font-semibold text-ink">{agentes[0]}</strong>
        </span>
      )}
    </span>
  );
}

/**
 * Lo que se toca para abrir el panel de una señal (un chip, un botón, una fila): `Revelar` con el panel ya armado. El
 * panel no se monta hasta que se abre (ui/Panel), así que una lista de veinte señales no dibuja veinte paneles.
 */
export function VerSenal({
  senales,
  ctx,
  perfil,
  children,
  className,
  etiqueta,
}: {
  senales: SenalAgente[];
  ctx: ContextoSenal | null;
  perfil?: string | null;
  children: ReactNode;
  className?: string;
  /** Qué anuncia al lector de pantalla; sin él, «Ver la evidencia de <señal>». */
  etiqueta?: string;
}) {
  if (senales.length === 0) return <>{children}</>;
  const titulo = reglaLabel(senales[0].regla);
  return (
    <Revelar
      titulo={titulo}
      descripcion={descripcionPanel(senales)}
      detalle={<CuerpoSenal senales={senales} ctx={ctx} perfil={perfil} />}
      ancho="lg"
      className={className}
      etiqueta={etiqueta ?? `Ver la evidencia de ${titulo}`}
    >
      {children}
    </Revelar>
  );
}
