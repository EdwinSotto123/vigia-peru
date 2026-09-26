"use client";

import { useEffect, useState } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";

/**
 * La geometría del coroplético. Los 25 departamentos (146 KB) se piden al montar; las
 * provincias (846 KB) sólo cuando se abre un departamento: la vista del país no las dibuja
 * y antes se bajaban en cada visita al mapa, también en el celular.
 *
 * Una vez pedidas quedan en memoria del módulo (y en la caché del navegador, `immutable`):
 * volver al país y abrir otro departamento no las vuelve a pedir.
 */

export interface DepartmentProps {
  name: string;
  id: string;
  code?: string;
}

export interface ProvinceProps {
  name: string;
  departamento: string;
  regionId: string;
  id: string;
  code?: string;
}

export type DeptFeature = Feature<Geometry, DepartmentProps>;
export type ProvFeature = Feature<Geometry, ProvinceProps>;
export type DeptGeo = FeatureCollection<Geometry, DepartmentProps>;
export type ProvGeo = FeatureCollection<Geometry, ProvinceProps>;

export type EstadoGeo = "loading" | "ready" | "missing" | "error";

/** Una sola descarga de provincias por carga de página, la pida quien la pida. */
let provinciasEnVuelo: Promise<ProvGeo | null> | null = null;

function pedirProvincias(): Promise<ProvGeo | null> {
  provinciasEnVuelo ??= fetch("/peru-provinces.json")
    .then((r) => (r.ok ? (r.json() as Promise<ProvGeo>) : null))
    .catch(() => null)
    .then((d) => {
      // Si falló, la próxima apertura lo vuelve a intentar.
      if (!d) provinciasEnVuelo = null;
      return d;
    });
  return provinciasEnVuelo;
}

/**
 * `conProvincias`: hay un departamento abierto. Las provincias se piden la primera vez que
 * es `true` y se conservan después (sirven también para anclar puntos en la vista del país).
 */
export function useGeoPeru(conProvincias: boolean): { deptData: DeptGeo | null; provData: ProvGeo | null; status: EstadoGeo } {
  const [deptData, setDeptData] = useState<DeptGeo | null>(null);
  const [provData, setProvData] = useState<ProvGeo | null>(null);
  const [status, setStatus] = useState<EstadoGeo>("loading");

  useEffect(() => {
    let alive = true;
    fetch("/peru-departments.json")
      .then((r) => {
        if (r.status === 404) throw new Error("missing");
        if (!r.ok) throw new Error("error");
        return r.json();
      })
      .then((data: DeptGeo) => {
        if (!alive) return;
        setDeptData(data);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setStatus(err.message === "missing" ? "missing" : "error");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!conProvincias || provData) return;
    let alive = true;
    // Sin las provincias el departamento abierto se ve igual, sólo sin su división interna.
    void pedirProvincias().then((d) => {
      if (alive && d) setProvData(d);
    });
    return () => {
      alive = false;
    };
  }, [conProvincias, provData]);

  return { deptData, provData, status };
}
