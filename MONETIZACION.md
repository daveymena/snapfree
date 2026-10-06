# SnapFree — Plan de competencia y monetización con anuncios

## 1. La competencia (lo que averiguamos)

| App | Puntos fuertes | Debilidades que explotamos |
|---|---|---|
| **SnapTube** | 100+ plataformas, 4K, MP3 320kbps, marca conocida | Solo Android APK fuera de Play Store (miedo a instalar, reportes de adware), con anuncios agresivos |
| **VidMate** | 1000+ sitios, HD, detector de portapapeles | Misma fricción de APK + reputación de malware en el pasado |
| **SaveFrom / SSYouTube** | Web, sin instalar | Llenos de popups engañosos, redirecciones, mala experiencia móvil |
| **Cobalt** | Limpio, open-source | Sin app, técnico, sin SEO en español, instancias públicas muriendo |

**Nuestra ventaja competitiva:** web + PWA instalable (cero fricción, nada de "fuentes desconocidas"), 100% en español, descarga forzada real (no abre pestañas como SaveFrom), y reputación limpia desde el día 1.

## 2. Estrategia de anuncios (importante: NO todo AdSense)

- **Página descargadora (`index.html`)**: AdSense la considera zona gris (herramienta que descarga contenido con copyright) y puede banear la cuenta. Aquí va **red alternativa**: HilltopAds/Adsterra/Mondiad **popunder SOLO en la acción Descargar** (ya cableado en `ads.js` → `SnapFreeAdOnDownload()`). No estorba al navegar.
- **Páginas guía (`guia.html`)**: contenido original paso-a-paso = aptas para **AdSense**. Estas páginas atraen el tráfico de Google ("cómo descargar tiktok sin marca de agua") y ahí sí monetizas con AdSense.
- **Regla de oro**: cuenta de AdSense solo en guías/blog. Nunca pegues AdSense en el descargador.

## 3. Activación (cuando tengas cuentas)

1. Regístrate en HilltopAds (publisher) → crea zona Popunder → pega el script en un archivo `ads-popunder.js` que defina `window.hilltopPop()` → pon `hilltopPopunder: true` en `ads.js`.
2. Regístrate en AdSense con el dominio final → pega tu `ca-pub-XXXX` en `guia.html` → pon `adsense: true`.
3. Banners display opcionales en `.ad-slot` (`bannerAlt: true`).

## 4. Lanzamiento (orden sugerido)

1. Dominio + hosting: frontend en Netlify/Vercel (gratis), backend en Render/Fly (plan barato con disco; el free se duerme).
2. Cambia `contacto@snapfree.app` por tu email real (privacidad + guías).
3. Publica 2-3 guías más (una por red) para SEO. Cada guía = puerta de entrada de Google.
4. Comparte en TikTok/Reels mostrando "cómo descargar sin apps raras" (tu propio producto como demo viral).
5. APK vía Bubblewrap TWA para quienes pidan "app", distribuida desde tu web (Play Store rechaza descargadores de YouTube: ni lo intentes por ahí).
6. Mide con Cloudflare Web Analytics (gratis, sin cookies) y ajusta.

## 5. Números realistas

Downloader web en español: RPM típico popunder $1–4. Con 1.000 descargas/día ≈ $30–120/mes. El SEO de guías + AdSense escala aparte. El costo: ~$5–7/mes de backend. Rentable desde el primer mes con tráfico medio.
