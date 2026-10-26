import sys, csv, re, unicodedata, difflib
sys.path.insert(0, r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\infrastructure\aws")
from tunel_rds import conexion
OUT = r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\backend\scrapers-worker\dji_targets\targets_dji.csv"
INC = (r"GERENT|DIRECTOR|JEFE|JEFA|ALCALDE|GOBERNAD|REGIDOR|CONSEJER|PRESIDENT|TITULAR|"
       r"COMIT[EÉ]|LOGISTIC|ABASTECIMIENT|ADQUISICION|CONTRATACION|PLANEAMIENT|PRESUPUEST|"
       r"ADMINISTRAD|ADMINISTRACI[OÓ]N|SECRETARI[OA] GENERAL|TESORER|CAJA CHICA|PROCURADOR|"
       r"SUPERVISOR|RESIDENTE DE OBRA|COORDINADOR|ASESOR|ARBITR|SUBDIRECTOR|SUB ?GERENT|"
       r"CONSEJO DIRECTIVO|CONTADOR|CAJERO")
EXC = (r"LOCADOR|LOCACI[OÓ]N|ASISTENTE|AUXILIAR|FISCAL|JUEZ|JUZGADO|POSTULANTE|SERVICIO EXTERNO|"
       r"REGISTRADOR|PRACTICANTE|CHOFER|VIGILANTE|LIMPIEZA|CONSERJE|APOYO ADMINISTRATIVO|"
       r"DOCENTE|PROFESOR|ENFERMER|M[EÉ]DICO|T[EÉ]CNICO")
PARAR={"MUNICIPALIDAD","DISTRITAL","PROVINCIAL","DE","DEL","LA","EL","LOS","LAS","GOBIERNO","REGIONAL","SEDE","CENTRAL","Y","UNIDAD","EJECUTORA"}
def norm(s):
    s=unicodedata.normalize("NFD",(s or "")).encode("ascii","ignore").decode()
    return re.sub(r"\s+"," ",re.sub(r"[^A-Z0-9 ]"," ",s.upper())).strip()
def clave(s): return " ".join(sorted(w for w in norm(s).split() if w not in PARAR and len(w)>2))
with conexion("prod") as c:
    cur=c.cursor()
    cur.execute("SELECT ruc, nombre FROM entidades WHERE ruc ~ '^20'"); ents=cur.fetchall()
    cur.execute("SELECT DISTINCT entidad, apellido_paterno, apellido_materno, nombres FROM dji_funcionarios WHERE cargo ~* %s AND cargo !~* %s AND apellido_paterno IS NOT NULL AND nombres IS NOT NULL",(INC,EXC))
    deci=cur.fetchall()
por_norm={}; por_clave={}
for ruc,nom in ents: por_norm.setdefault(norm(nom),ruc); por_clave.setdefault(clave(nom),ruc)
claves=list(por_clave.keys()); mapa={}
for de in {d[0] for d in deci}:
    if norm(de) in por_norm: mapa[de]=por_norm[norm(de)]
    elif clave(de) in por_clave: mapa[de]=por_clave[clave(de)]
    else:
        m=difflib.get_close_matches(clave(de),claves,n=1,cutoff=0.86)
        if m: mapa[de]=por_clave[m[0]]
n=0; vistos=set()
with open(OUT,"w",newline="",encoding="utf-8") as f:
    w=csv.writer(f); w.writerow(["ruc","apellidos","nombres"])
    for ent,ap1,ap2,nom in deci:
        ruc=mapa.get(ent)
        if not ruc: continue
        ape=" ".join(x for x in (ap1,ap2) if x).strip()
        if not ape or not (nom or "").strip(): continue
        key=(ruc,ape.upper(),nom.upper())
        if key in vistos: continue
        vistos.add(key); w.writerow([ruc,ape,nom.strip()]); n+=1
print(f"targets comprensivos: {n} -> {OUT}")
