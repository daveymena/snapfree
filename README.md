# SnapFree Downloader — GRATIS · Web + Android (PWA)

Pega un enlace de Facebook / Instagram / TikTok / YouTube → vista previa → descarga en la calidad elegida o MP3.

## Métodos (todos incluidos, con fallback automático)
1. **Backend yt-dlp** — mejor calidad + MP3 real (requiere `yt-dlp` + `ffmpeg`).
2. **Cobalt API** — 3 instancias públicas, sin instalar nada (respaldo si yt-dlp falla o la red cambia).
3. **Descarga directa del navegador** — último recurso.

## Uso rápido (solo web, sin servidor)
Abre `frontend/index.html` en el navegador o sírvelo:
```
cd snapfree-app/frontend
npx serve .
```
Desactiva "Usar mi servidor" en la app → usa solo Cobalt (gratis, sin backend).

## Uso completo (recomendado)
```
# 1. Instala yt-dlp + ffmpeg (solo una vez, para máxima calidad)
pip install yt-dlp
winget install ffmpeg   # o descarga de ffmpeg.org

# 2. Backend
cd snapfree-app/backend
npm install
npm start   # http://localhost:3000 (ya sirve el frontend también)
```
En la app deja activado "Usar mi servidor". Si yt-dlp falla, cae solo a Cobalt.

## Instalar en Android (gratis, sin Play Store)
1. Sube `frontend/` a Netlify / Vercel / Cloudflare Pages (arrastra la carpeta).
2. Abre la URL en Chrome Android → ⋮ → **Añadir a pantalla de inicio / Instalar app**.
3. En `frontend/app.js` pon tu URL del backend en `localStorage`: `snapfree_backend = "https://tu-backend.onrender.com"`.

## APK para Play Store (TWA, gratis)
```
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://tu-sitio.com/manifest.json
bubblewrap build
```
Genera el AAB firmable.

## Despliegue gratis sugerido
- Frontend: Netlify / Vercel (gratis).
- Backend: Render.com Free (comando `node server.js`, con `pip install yt-dlp` en build) o Fly.io.

⚖️ Solo contenido propio / libre / con permiso. Videos privados o con DRM no descargarán (normal).
