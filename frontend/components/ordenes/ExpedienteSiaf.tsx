"use client";

import { useState } from "react";
import { FileSearch } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaConAnio } from "@/lib/formato";

/**
 * El expediente SIAF de una orden de CONOSCE, a pedido: el botón pide al API (GET /v1/ordenes/siaf) las órdenes de la
 * entidad en el mes de la orden, del reporte «ongei» del SEACE, y la reconoce por su tipo (O/C, O/S) y su número. Se pide
 * sólo al hacer clic: la lista no consulta al SEACE por sí sola (un robot que recorre fichas no dispara nada).
 */

type Estado =
  | { fase: "inicio" }
  | { fase: "buscando" }
  | { fase: "hallada"; siaf: string | null; compromiso: string | null; estado: string | null }
  | { fase: "no_esta"; total: number }
  | { fase: "error" };

interface FilaSiaf { tipo: string | null; numero: string | null; siaf: string | null; compromiso: string | null; estado: string | null }

/**
 * El número de la orden sin ceros a la izquierda ni el año: «000564», «564-2026», «O/C 564» → «564», y «2026001620» →
 * «1620» (CONOSCE y el SEACE escriben unas con el año delante y otras sin él, a veces en la misma entidad).
 */
function numeroOrden(v: string | null | undefined, anio: string): string {
  let d = (v ?? "").split(/[-/]/)[0].replace(/\D/g, "");
  if (d.length >= 8 && d.startsWith(anio)) d = d.slice(4);
  return d.replace(/^0+/, "");
}

export function ExpedienteSiaf({ entidadRuc, fecha, compra, numero }: { entidadRuc: string; fecha: string; compra: boolean; numero: string }) {
  const [e, setE] = useState<Estado>({ fase: "inicio" });
  const buscar = async () => {
    setE({ fase: "buscando" });
    try {
      const q = new URLSearchParams({ entidad: entidadRuc, anio: fecha.slice(0, 4), mes: String(Number(fecha.slice(5, 7))) });
      const r = await fetch(`/v1/ordenes/siaf?${q}`);
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { total: number; ordenes: FilaSiaf[] };
      const tipo = compra ? "O/C" : "O/S";
      const anio = fecha.slice(0, 4);
      const n = numeroOrden(numero, anio);
      const f = d.ordenes.find((x) => x.tipo === tipo && numeroOrden(x.numero, anio) === n);
      setE(f ? { fase: "hallada", siaf: f.siaf, compromiso: f.compromiso, estado: f.estado } : { fase: "no_esta", total: d.total });
    } catch {
      setE({ fase: "error" });
    }
  };
  if (e.fase === "hallada") {
    return (
      <p className="text-ink">
        {e.siaf ? (
          <>
            Expediente SIAF <span className="font-mono font-semibold">N.º {e.siaf}</span>
          </>
        ) : (
          "El SEACE tiene la orden, pero sin número de expediente SIAF"
        )}
        {e.estado ? `, ${e.estado.toLocaleLowerCase("es")}` : ""}
        {e.compromiso ? ` (compromiso del ${fechaConAnio(e.compromiso)})` : ""}.
      </p>
    );
  }
  if (e.fase === "no_esta") {
    return (
      <p className="text-inkSoft">
        El SEACE no tiene esta orden entre las {e.total.toLocaleString("es-PE")} de la entidad en ese mes: puede estar registrada con otro número.
      </p>
    );
  }
  return (
    <div className="space-y-2" aria-live="polite">
      <button type="button" onClick={buscar} disabled={e.fase === "buscando"} className={claseAccion("secundario")}>
        <FileSearch className="size-4" aria-hidden />
        {e.fase === "buscando" ? "Buscando en el SEACE…" : "Buscar su expediente SIAF"}
      </button>
      {e.fase === "error" && <p className="text-meta text-inkSoft">El SEACE no respondió. Vuelve a intentarlo en un rato.</p>}
    </div>
  );
}
