"""Escanea lo que se publicaría en GitHub: las líneas AGREGADAS en un rango de commits (git log -p). Reporta archivo, tipo y
commit, nunca el valor. Uso: python escanear_publicacion.py <repo> <desde> <hasta> [ruta excluida ...]"""
import collections
import re
import subprocess
import sys

repo, desde, hasta = sys.argv[1], sys.argv[2], sys.argv[3]
excluidas = sys.argv[4:]

PATRONES = {
    "token Cloudflare cfa": re.compile(r"\bcfa[A-Za-z0-9_-]{30,}"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "clave privada PEM": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "token GitHub": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"),
    "token GitLab": re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}"),
    "token Slack": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    "clave sk-": re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}"),
    "clave Google AIza": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "contraseña en URL": re.compile(r"\b(?:postgres(?:ql)?|mysql|redis|amqp|mongodb(?:\+srv)?)://[^:\s/'\"]+:[^@\s'\"$<{]+@"),
    "secreto asignado": re.compile(r"(?i)\b(?:ADMIN_TOKEN|PRIVACIDAD_CLAVE|TURNSTILE_SECRET_KEY|BUILD_TOKEN|DISPATCHER_TOKEN|SCRAPERS_TOKEN|VIGIA_DL_TOKEN|PGPASSWORD|API_KEY|SECRET_KEY|password)\s*[:=]\s*[\"']?[A-Za-z0-9_+/=.-]{16,}"),
    "DNI en campo": re.compile(r"(?i)[\"']?(?:dni|doc|documento|numero_documento|nro_documento|pariente_doc|num_doc)[\"']?\s*[:=,]\s*[\"']?\d{8}\b"),
    "RUC 10": re.compile(r"\b10\d{9}\b"),
}
# Valores de ejemplo conocidos que no son secretos ni personas (tests y docs usan 0000…, 1234…, 4396…).
FALSOS = re.compile(r"\b(?:0{8}|12345678|87654321|10000000000|10123456789|10\d{0,1}0{8,9})\b")

out = subprocess.run(["git", "-C", repo, "log", "-p", "--no-color", "--format=COMMIT %h", f"{desde}..{hasta}"],
                     capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
hallazgos = collections.Counter()
ejemplos = {}
commit = archivo = ""
for linea in out.splitlines():
    if linea.startswith("COMMIT "):
        commit = linea[7:]
        continue
    if linea.startswith("+++ b/"):
        archivo = linea[6:]
        continue
    if not linea.startswith("+") or linea.startswith("+++"):
        continue
    if any(archivo.startswith(x) for x in excluidas):
        continue
    texto = linea[1:]
    for nombre, pat in PATRONES.items():
        for m in pat.finditer(texto):
            if nombre in ("DNI en campo", "RUC 10") and FALSOS.search(m.group(0)):
                continue
            # Una RUC 10 en código o docs puede ser un ejemplo: sólo cuenta en archivos de datos.
            if nombre == "RUC 10" and not re.search(r"\.(csv|tsv|json|jsonl|txt|sql)$", archivo):
                continue
            hallazgos[(nombre, archivo)] += 1
            ejemplos.setdefault((nombre, archivo), commit)

if not hallazgos:
    print("sin hallazgos")
for (nombre, archivo), n in sorted(hallazgos.items(), key=lambda x: (x[0][0], -x[1])):
    print(f"{nombre:22s} {n:6d}  {archivo}  (p. ej. {ejemplos[(nombre, archivo)]})")
