import { notFound } from "next/navigation";
import { ContratoEnVivo } from "@/components/auditoria/ContratoEnVivo";
import { ESTADO_PROC, getProcesamiento } from "@/lib/auditoria";

export const revalidate = 3;

export async function generateMetadata({ params }: { params: { ocid: string } }) {
  const ocid = decodeURIComponent(params.ocid);
  const p = await getProcesamiento(ocid);
  if (!p) return { title: `Contrato ${ocid} — Auditoría en vivo de Vigía Perú` };
  const titulo = p.titulo ?? ocid;
  return {
    title: `${titulo} — Auditoría en vivo de Vigía Perú`,
    description: `${ESTADO_PROC[p.estado].label}. ${p.entidad ?? "Entidad no identificada"}, ${p.zona}. Auditoría financiada por ${p.financiador}.`,
  };
}

export default async function ContratoEnVivoPage({ params }: { params: { ocid: string } }) {
  const ocid = decodeURIComponent(params.ocid);
  const data = await getProcesamiento(ocid);
  if (!data) notFound();
  return (
    <div className="container-page py-8">
      <div className="mx-auto max-w-5xl">
        <ContratoEnVivo ocid={ocid} initial={{ ...data, eventos: Array.isArray(data.eventos) ? data.eventos : [] }} />
      </div>
    </div>
  );
}
