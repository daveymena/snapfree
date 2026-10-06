const $=id=>document.getElementById(id);
const BACKEND=()=> (localStorage.getItem('snapfree_backend')||'').replace(/\/$/,'');
const COBALT=['https://cobalt-api.kwiatekmiki.com','https://co.wukko.xyz','https://api.cobalt.tools'];

function detect(url=''){url=url.toLowerCase();
 if(/youtu\.?be/.test(url))return'youtube'; if(/tiktok/.test(url))return'tiktok';
 if(/instagram/.test(url))return'instagram'; if(/facebook|fb\.watch|fb\.com/.test(url))return'facebook';
 if(/aliexpress(?:\.|-media\.)|alibaba\.com|cloud\.video\.taobao\.com/.test(url))return'aliexpress'; return'desconocida';}
function paintBadges(net){document.querySelectorAll('#badges .plat, #badges .badge').forEach(b=>b.classList.toggle('on',b.dataset.net===net));}
function setStatus(t){$('status').textContent=t;}
function saveHist(item){try{const h=JSON.parse(localStorage.getItem('snapfree_hist')||'[]');h.unshift({t:Date.now(),...item});localStorage.setItem('snapfree_hist',JSON.stringify(h.slice(0,50)));renderHist();}catch{}}
function renderHist(){const h=JSON.parse(localStorage.getItem('snapfree_hist')||'[]');$('history').innerHTML=h.length?h.map((x,i)=>`<li>🌐 <b>${x.net}</b> — ${esc(x.title||x.url)}<br><button class="text-cyan-300 underline" data-h="${i}">re-descargar</button> · <span class="text-slate-500">${new Date(x.t).toLocaleString()}</span></li>`).join(''):'<li class="text-slate-500">Sin descargas aún.</li>';
 document.querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>{const h2=JSON.parse(localStorage.getItem('snapfree_hist')||'[]');const it=h2[+b.dataset.h];if(it)forceDownload(it.direct,filenameFor(it,it.url));});}
function esc(s=''){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

// fetch con tiempo límite: ningún intento puede quedarse colgado para siempre.
async function fetchT(url,opts={},ms=20000,externalSignal){
 const c=new AbortController();
 const t=setTimeout(()=>c.abort(new DOMException('timeout','TimeoutError')),ms);
 if(externalSignal){
  if(externalSignal.aborted) c.abort(externalSignal.reason);
  else externalSignal.addEventListener('abort',()=>c.abort(externalSignal.reason),{once:true});
 }
 try{ return await fetch(url,{...opts,signal:c.signal}); }
 finally{ clearTimeout(t); }
}

// --- Método 1: backend propio yt-dlp ---
async function viaBackend(url,quality,signal){
 const base=BACKEND(); const endpoint=base? base+'/api/info' : '/api/info';
 const auth=(window.SnapAuth&&SnapAuth.h())||{};
 const r=await fetchT(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...auth},body:JSON.stringify({url,quality})},45000,signal);
  if(r.status===402){const j=await r.json().catch(()=>({}));const e=new Error('quota');e.quota=j;throw e;}
  if(!r.ok){const j=await r.json().catch(()=>({}));const e=new Error(j.error||'service');e.status=r.status;e.backend=j;throw e;}
 return r.json(); // {title,thumbnail,duration,uploader,direct,net}
}
// Refresca la píldora de cuota + botón de cuenta
async function refreshQuota(){
 try{
  const q=await (window.SnapAuth?SnapAuth.quota():{left:'…',limit:5,pro:false,login:false});
  const pill=$('quotaPill');
  if(pill){pill.textContent=q.pro?'⭐ PRO · ilimitado':`🎁 ${q.left}/${q.limit} gratis hoy`;pill.classList.toggle('on',!!q.pro);}
  const acc=$('btnAccount');
  if(acc){acc.textContent=q.login?('👤 '+(q.email||'Mi cuenta').split('@')[0]):'👤 Entrar';}
 }catch(e){}
}
function quotaError(){
 setStatus('⚠️ Llegaste a tus descargas gratis de hoy.');
 const s=$('status');
 if(s && !$('btnUpgrade')){
  const a=document.createElement('a');a.id='btnUpgrade';a.href='pricing.html';a.className='btn-primary';a.style.marginLeft='8px';a.textContent='⭐ Pasar a PRO ilimitado';
  s.after(a); setTimeout(()=>{const x=$('btnUpgrade');x&&x.remove();},15000);
 }
 refreshQuota();
}
// --- Método 2/3/4: Cobalt (3 instancias, api v7 y v10) ---
// alwaysProxy:true → Cobalt responde "tunnel" (archivo descargable) en vez de
// "redirect" (CDN directo que el navegador REPRODUCE en otra pestaña).
async function viaCobalt(url,quality,signal,onStep){
 const isAudio=quality==='mp3';
 const mkBody={url, videoQuality:isAudio?'720':(quality==='max'?'max':quality), downloadMode:isAudio?'audio':'auto', filenameStyle:'pretty', alwaysProxy:true};
 let lastErr=''; let n=0; const total=COBALT.length*2;
 for(const base of COBALT){
  for(const path of ['/','/api/get']){
   n++;
   if(signal&&signal.aborted) throw new DOMException('cancelled','AbortError');
   if(onStep) onStep(n,total);
   try{
    const r=await fetchT(base+path,{method:'POST',headers:{'Accept':'application/json','Content-Type':'application/json'},body:JSON.stringify(mkBody)},15000,signal);
    if(!r.ok){lastErr=r.status;continue;}
    const j=await r.json();
    if((j.status==='tunnel'||j.status==='redirect')&&j.url)
     return {direct:j.url, filename:j.filename||'', tunneled:j.status==='tunnel', picker:null};
    if(j.status==='picker'&&Array.isArray(j.picker)){
     const v=j.picker.find(i=>i.type==='video')||j.picker[0];
     if(v&&v.url) return {direct:v.url, filename:'', tunneled:false, picker:j.picker};
    }
    const direct=j.url||j.downloadUrl||j.response?.url;
    if(direct) return {direct, filename:j.filename||'', tunneled:false, picker:j.picker||null};
   }catch(e){lastErr=(e&&e.message)||'error'; console.warn('[interno] intento respaldo:',(e&&e.message)||e);}
  }
 }
 throw new Error('service');
}

async function resolve(url,quality,signal){
 const net=detect(url); paintBadges(net);
 // Intento principal (hasta 45s)
 if($('useBackend').checked){
  try{setStatus('🔎 Buscando tu video…');const b=await viaBackend(url,quality,signal);
   return {title:b.title||url, thumbnail:b.thumbnail||'', duration:b.duration||'', uploader:b.uploader||'', direct:b.direct, net:b.net||net};}
  catch(e){
   if(e&&(e.name==='AbortError')) throw e;
   if(e&&e.status===422&&net==='aliexpress') throw e;
   console.warn('[interno] principal fallo:',e); setStatus('⚠️ Reintentando por conexión alternativa…');
  }
 }
 // Conexión alternativa con progreso (intentos cortos)
 const c=await viaCobalt(url,quality,signal,(n,total)=>{
  setStatus(`🔎 Buscando tu video… intento ${n}/${total}`);
 });
 return {title:c.filename||url, thumbnail:'', duration:'', uploader:'', direct:c.direct, net, picker:c.picker};
}

let resolving=false, resolveAbort=null;
function showResolving(show){
 resolving=show;
 $('btnGo').disabled=show; $('btnGo').style.opacity=show?'.6':'1';
 $('btnGo').textContent=show?'⏳ Buscando…':'⬇ Obtener';
 let b=$('btnCancelSearch');
 if(show && !b){
  b=document.createElement('button'); b.id='btnCancelSearch'; b.className='btn-ghost';
  b.textContent='✖ Cancelar búsqueda'; b.style.marginLeft='8px';
  b.onclick=()=>{ try{resolveAbort&&resolveAbort.abort();}catch(e){} };
  $('status').after(b);
 } else if(!show && b){ b.remove(); }
}

function showResult(info,origUrl){
 $('result').classList.remove('hidden');
 $('thumb').src=info.thumbnail||'icons/icon-512.png';
 $('title').textContent=info.title||origUrl;
 $('meta').textContent=[info.net,info.uploader,info.duration].filter(Boolean).join(' · ');
 $('netTag').textContent=info.net;
 // Al pulsar se prepara el enlace más reciente y se descarga directo. Nada de pestañas.
 const fname=filenameFor(info,origUrl);
 $('btnDownload').removeAttribute('href'); $('btnDownload').removeAttribute('target');
 $('btnDownload').onclick=async()=>{
  if(resolving) return;
  setStatus('🔄 Preparando tu descarga…');
  resolveAbort=new AbortController(); showResolving(true);
  try{ const fresh=await resolve(origUrl,$('quality').value,resolveAbort.signal); await forceDownload(fresh.direct, filenameFor(fresh,origUrl)); }
  catch(e){ if(!(e&&(e.name==='AbortError'))) await forceDownload(info.direct,fname); }
  finally{ showResolving(false); resolveAbort=null; }
 };
 $('btnCopy').onclick=()=>{navigator.clipboard.writeText(info.direct);setStatus('✅ Enlace copiado.');};
 saveHist({url:origUrl,title:info.title,net:info.net,direct:info.direct});
 setStatus('✅ Listo. Toca Descargar ahora.');
 $('result').scrollIntoView({behavior:'smooth'});
}
function addQueueItem(url,info){const q=$('queueList');if(!q)return;const li=document.createElement('li');li.innerHTML=`${info?`✅ <b>${esc(info.net)}</b> — `:''}${esc(url)} ${info?`<button class="text-cyan-300 underline btn-dl" data-url="${esc(info.direct)}" data-fname="${esc(filenameFor(info,url))}">descargar</button>`:''}`;q.prepend(li);li.querySelector('.btn-dl')?.addEventListener('click',e=>forceDownload(e.target.dataset.url,e.target.dataset.fname));}

// --- Descarga forzada: proxy del backend (attachment) + blob, jamás window.open ---
function apiBase(){return (localStorage.getItem('snapfree_backend')||'').replace(/\/$/,'');}
function filenameFor(info,origUrl){
 const q=$('quality').value; const ext=q==='mp3'?'mp3':'mp4';
 const base=(info.title||info.net||'video').replace(/[^\w\-. áéíóúñ]+/gi,'_').slice(0,60)||'video';
 return `${base}_${info.net||detect(origUrl)}.${ext}`;
}
let downloading=false, dlAbort=null, dlPaused=false;
function fmtMB(b){return (b/1048576).toFixed(1)+' MB';}
function dlUI(show){$('dlProgress').classList.toggle('hidden',!show);}
function dlSet(pct,label,detail){
 $('dlBar').style.width=Math.min(100,Math.max(0,pct))+'%';
 $('dlPct').textContent=Math.round(pct)+'%';
 if(label)$('dlLabel').textContent=label;
 if(detail)$('dlDetail').textContent=detail;
}
function lockDl(lock){
 downloading=lock;
 const b=$('btnDownload');
 b.disabled=lock; b.style.opacity=lock?'.6':'1';
 b.textContent=lock?'⏳ Descargando… no toques nada':'⬇ Descargar ahora';
}
async function forceDownload(direct,fname){
 if(downloading){setStatus('⏳ Ya hay una descarga en curso, espera a que termine.');return;}
 lockDl(true); dlUI(true); dlSet(0,'⬇ Conectando…','conectando…');
 const t0=Date.now();
 try{
  setStatus('⬇ Descargando… no cierres la app.');
  if(typeof window.SnapFreeAdOnDownload==='function') window.SnapFreeAdOnDownload();
  // 1) Intento vía proxy del backend (misma-origen → respeta attachment, sin pestaña nueva)
  const prox=apiBase()+`/api/dl?url=${encodeURIComponent(direct)}&filename=${encodeURIComponent(fname)}`;
  // OJO: si "direct" ya es de nuestra API (/api/download o /api/dl), se descarga tal cual,
  // sin re-proxear (evita doble salto y permite streaming con progreso).
  const target=direct.startsWith('/api/') ? (apiBase()+direct) : prox;
  const sameOrigin=target.startsWith('/api/');
  const authH=(sameOrigin&&window.SnapAuth&&SnapAuth.h())||{};
  dlAbort=new AbortController(); dlPaused=false;
  $('btnPause').textContent='⏸ Pausar';
  let r=await fetch(target,{signal:dlAbort.signal,...(sameOrigin?{headers:authH}:{})});
  // 2) Si el backend no existe (frontend estático), directo con blob
  if(!r.ok && !direct.startsWith('/api/')) r=await fetch(direct);
  if(r.status===402){quotaError();dlSet(0,'⛔ Límite gratis alcanzado','pásate a PRO para seguir');setTimeout(()=>{dlUI(false);},4000);lockDl(false);dlAbort=null;return;}
  if(!r.ok) throw new Error('HTTP '+r.status);
  const total=+(r.headers.get('content-length')||0);
  const reader=r.body.getReader();
  const chunks=[]; let got=0;
  dlSet(total?1:3,'⬇ Descargando…', total?('0 / '+fmtMB(total)) : 'preparando video largo…');
  for(;;){
   // Pausa: dejamos de leer (la red se frena sola por contrapresión, la conexión sigue abierta)
   while(dlPaused){
    dlSet(got&&total?got/total*100:3,'⏸ En pausa','descarga detenida — toca Reanudar para seguir');
    await new Promise(res=>setTimeout(res,400));
    if(dlAbort===null) throw new DOMException('cancelled','AbortError');
   }
   const {done,value}=await reader.read();
   if(done)break;
   chunks.push(value); got+=value.length;
   const secs=Math.max(1,(Date.now()-t0)/1000);
   const speed=fmtMB(got/secs)+'/s';
   if(total) dlSet(got/total*100,'⬇ Descargando…',`${fmtMB(got)} / ${fmtMB(total)} · ${speed}`);
   else dlSet(Math.min(95,3+got/500000),'⬇ Descargando…',`${fmtMB(got)} recibidos · ${speed} · el % exacto se sabe al final`);
  }
  dlSet(100,'✅ Guardando archivo…','preparando '+fname);
  const blob=new Blob(chunks);
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=fname; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},4000);
  setStatus('✅ Descargado: '+fname+' ('+fmtMB(blob.size)+' · revisa tu carpeta Descargas).');
  dlSet(100,'✅ ¡Listo!','archivo guardado en Descargas');
  if(typeof refreshQuota==='function') refreshQuota();
  setTimeout(()=>{dlUI(false);},4000);
 }catch(e){
  if(e && e.name==='AbortError'){
   setStatus('✖ Descarga cancelada. Puedes intentarlo de nuevo cuando quieras.');
   dlSet(0,'✖ Cancelada','descarga detenida por ti');
   setTimeout(()=>{dlUI(false);},2500);
   return;
  }
  // 3) Último recurso: enlace con atributo download
  setStatus('⚠️ No pudimos traerlo por la vía rápida, probando de otra forma…');
  console.warn('[interno] fallo descarga:',e);
  dlSet(0,'⚠️ Probando otra forma','intento directo…');
  const a=document.createElement('a'); a.href=direct; a.download=fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>{dlUI(false);},3000);
 }finally{ lockDl(false); dlAbort=null; }
}

// Controles de pausa / cancelar (vivos solo durante una descarga)
$('btnPause').onclick=()=>{
 if(!downloading||!dlAbort) return;
 dlPaused=!dlPaused;
 $('btnPause').textContent=dlPaused?'▶ Reanudar':'⏸ Pausar';
 setStatus(dlPaused?'⏸ Descarga en pausa. Toca Reanudar para seguir.':'▶ Descarga reanudada…');
};
$('btnCancel').onclick=()=>{
 if(!downloading) return;
 const c=dlAbort; dlAbort=null; dlPaused=false; // null despierta el bucle de pausa
 try{ c && c.abort(); }catch(e){}
};

async function handleOne(url,quality){url=url.trim();if(!url)return null;
 if(resolving){setStatus('⏳ Ya hay una búsqueda en curso. Cancélala si se trabó.');return null;}
 resolveAbort=new AbortController(); showResolving(true);
 try{const info=await resolve(url,quality,resolveAbort.signal);showResult(info,url);return info;}
  catch(e){
    if(e&&(e.name==='AbortError'||e.name==='TimeoutError')){
     setStatus('✖ Búsqueda cancelada o agotó el tiempo. Revisa el enlace e intenta de nuevo.');
    } else if(e&&e.message==='quota'){
     quotaError();
    } else if(e&&e.status===422&&detect(url)==='aliexpress'){
     setStatus('AliExpress bloqueó la lectura automática de este producto. Abre el mini-video, haz clic derecho → “Copiar dirección del video” y pega ese enlace directo en este mismo campo.');
    } else {
    console.warn('[interno] búsqueda fallo:',e);
    setStatus('❌ No encontramos ese video. Verifica que el enlace esté completo, que el video sea público e intenta de nuevo.');
   }
   return null;
  }
 finally{ showResolving(false); resolveAbort=null; }
}

$('btnGo').onclick=()=>handleOne($('urlInput').value.trim(),$('quality').value);
$('urlInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('btnGo').click();});
$('urlInput').addEventListener('input',e=>paintBadges(detect(e.target.value)));
$('btnPaste').onclick=async()=>{try{const t=await navigator.clipboard.readText();if(t){$('urlInput').value=t.trim();paintBadges(detect(t));setStatus('📋 Pegado. Toca Obtener.');}}catch{setStatus('⚠️ Permiso denegado: pega manualmente (mantén presionado el campo).');}};
if($('btnQueueAll'))$('btnQueueAll').onclick=async()=>{
 const lines=$('queueInput').value.split('\n').map(s=>s.trim()).filter(Boolean);
 const more=$('urlInput').value.trim()?[$('urlInput').value.trim()]:[];
 const all=[...more,...lines]; if(!all.length){setStatus('Pega al menos un enlace.');return;}
 setStatus(`⏳ Procesando ${all.length} enlaces…`);
 for(const u of all){await handleOne(u,$('quality').value);}
 setStatus('✅ Cola terminada.');
};
if($('btnZipNote'))$('btnZipNote').onclick=()=>setStatus('💡 Cada video se descarga por separado. Toca descargar en cada item de la cola.');
if($('btnClearQ'))$('btnClearQ').onclick=()=>$('queueList').innerHTML='';
if($('btnClearH'))$('btnClearH').onclick=()=>{localStorage.removeItem('snapfree_hist');renderHist();};
if($('tabQueue'))$('tabQueue').onclick=e=>{e.preventDefault();$('queueInput').focus();window.scrollTo({top:$('queueInput').offsetTop-80,behavior:'smooth'});};
$('tabHist').onclick=e=>{e.preventDefault();window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});};

// PWA install
let deferred=null;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('btnInstall').classList.remove('hidden');});
if($('btnInstall'))$('btnInstall').onclick=async()=>{if(deferred){deferred.prompt();await deferred.userChoice;deferred=null;}};
// Cuenta: usar la página completa y profesional de acceso/registro.
if($('btnAccount'))$('btnAccount').onclick=()=>{ location.href='cuenta.html'; };
renderHist();paintBadges('desconocida');refreshQuota();
