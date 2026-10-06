#!/usr/bin/env python3
"""Extractor de videos de AliExpress para SnapFree (3 niveles).
Uso: python3 ali_extract.py "<url>"  -> imprime JSON {"title","thumbnail","direct"} o {"error":...}
Nivel 1: URL directa de video (*.mp4, video.aliexpress-media.com, cloud.video.taobao.com) -> se usa tal cual.
Nivel 2: pagina de producto -> busca mp4 / videoId embebidos (funciona si el HTML trae datos).
Nivel 3: si AliExpress devuelve el muro anti-bots (HTML vacio), error claro con guia.
"""
import urllib.request, urllib.parse, re, json, sys

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}

def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    return urllib.request.urlopen(req, timeout=25).read().decode("utf-8", "ignore")

def out(obj):
    print(json.dumps(obj))
    sys.exit(0)

def main():
    if len(sys.argv) < 2:
        out({"error": "falta URL"})
    url = sys.argv[1].strip()
    host = urllib.parse.urlparse(url).netloc.lower()

    # Nivel 1: enlace directo al archivo de video
    if re.search(r"\.mp4(\?|$)", url, re.I) or "aliexpress-media.com" in url and "video" in url.lower() \
       or "cloud.video.taobao.com" in url or ".m3u8" in url:
        title = urllib.parse.unquote(url.split("/")[-1].split("?")[0]) or "video_aliexpress.mp4"
        out({"title": title, "thumbnail": "", "direct": url})

    if "aliexpress." not in host and "alibaba.com" not in host:
        out({"error": "no es URL de AliExpress/Alibaba"})

    # Nivel 2: producto -> HTML
    try:
        html = fetch(url)
    except Exception as e:
        out({"error": f"no se pudo abrir la pagina: {str(e)[:100]}"})
    if len(html) < 50000 and "<title></title>" in html:
        out({"error": "ALI_BLOCK: AliExpress mostro el muro anti-bots. Abre el producto en tu navegador, reproduce el mini-video, copia la direccion del video (click derecho sobre el video > copiar URL) y pegala aqui. Esos enlaces directos si descargan."})
    mp4s = sorted(set(re.findall(r"https?://[^\s\"'<>\\]+\.mp4[^\s\"'<>\\]*", html)),
                  key=len, reverse=True)
    # filtrar iconos/ui: preferir dominios de video
    mp4s = [u for u in mp4s if any(d in u for d in ("aliexpress-media", "taobao", "vod", "video"))] or mp4s
    if mp4s:
        t = re.findall(r"<title>([^<]{5,150})</title>", html)
        title = (t[0].split("- AliExpress")[0].strip() if t else "video_aliexpress")
        th = re.findall(r"https?://[^\s\"'<>\\]*aliexpress-media\.com/kf/[^\s\"'<>\\]*?\.jpg", html)
        out({"title": title, "thumbnail": th[0] if th else "", "direct": mp4s[0]})
    out({"error": "ALI_NODATA: AliExpress bloqueó la lectura automática de este producto desde el servidor. Abre el producto en tu navegador, reproduce el mini-video, haz clic derecho en el video y elige Copiar dirección del video. Pega ese enlace directo en el mismo campo de SnapFree; los enlaces MP4 de AliExpress sí se aceptan."})

main()
