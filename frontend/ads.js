// SnapFree Ads — gestor de monetización
// ESTRATEGIA (ver MONETIZACION.md):
//  - La página descargadora usa red alternativa (HilltopAds/Adsterra popunder en la
//    acción de descargar). AdSense en páginas descargadoras = riesgo de baneo.
//  - Las páginas guía (/guia-*.html) son contenido limpio apto para AdSense.
// Activa cada red pegando tu código donde se indica y poniendo true abajo.
const ADS_CONFIG = {
  hilltopPopunder: false,   // true + pega tu script de zona popunder en ads-popunder.js
  adsense: false,           // true + reemplaza ca-pub-XXXX en las páginas guía
  bannerAlt: false          // true + pega banner alternativo (Mondiad/Adsterra) abajo
};
(function(){
  // Popunder SOLO en la acción de descargar (recomendación HilltopAds para downloaders).
  // No molesta al navegar, solo monetiza la intención real de descarga.
  let lastPop = 0;
  window.SnapFreeAdOnDownload = function(){
    if(!ADS_CONFIG.hilltopPopunder) return;
    if(typeof window.hilltopPop === 'function' && Date.now()-lastPop > 60000){
      lastPop = Date.now();
      try{ window.hilltopPop(); }catch(e){}
    }
  };
  // Banners alternativos (display). Se ocultan solos si no hay código.
  document.addEventListener('DOMContentLoaded', ()=>{
    if(!ADS_CONFIG.bannerAlt) return;
    document.querySelectorAll('.ad-slot').forEach(s=>s.classList.remove('hidden'));
  });
})();
