// SnapFree Backend híbrido: yt-dlp (método 1) + Cobalt fallback (método 2)
// Gratis. Requiere: node + (opcional) yt-dlp instalado + ffmpeg para MP3.
// Instalar yt-dlp: pip install yt-dlp  |  winget install yt-dlp
const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const path = require('path');
const app = express();
app.use(cors()); app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'..','frontend')));
// SaaS: auth + cuotas + PayPal/MercadoPago
const saas = require('./saas').mount(app);
app.use('/api/', saas.authOptional);
const COBALT=['https://cobalt-api.kwiatekmiki.com','https://co.wukko.xyz','https://api.cobalt.tools'];
// evolving.projects: api.cobalt.tools exige clave (error.api.auth.jwt.missing).
// Si consigues una (gratis, pidiéndola al dueño de una instancia), ponla en COBALT_API_KEY
// y el respaldo Cobalt vuelve a funcionar. Sin clave, el método principal yt-dlp sigue activo.
const COBALT_KEY=process.env.COBALT_API_KEY||'';
const cobaltHeaders=()=>({Accept:'application/json','Content-Type':'application/json',...(COBALT_KEY?{Authorization:'Api-Key '+COBALT_KEY}:{})});
let fetchFn = global.fetch || ((...a)=>import('node-fetch').then(m=>m.default(...a)));
// fetch con timeout: ningún intento Cobalt puede colgar la petición.
async function fetchT(url,opts={},ms=15000){
 const c=new AbortController();
 const t=setTimeout(()=>c.abort(),ms);
 try{ return await fetchFn(url,{...opts,signal:c.signal}); }
 finally{ clearTimeout(t); }
}

function detect(url=''){url=url.toLowerCase();
 if(/youtu\.?be/.test(url))return'youtube'; if(/tiktok/.test(url))return'tiktok';
 if(/instagram/.test(url))return'instagram'; if(/facebook|fb\.watch|fb\.com/.test(url))return'facebook';
 if(/aliexpress\.|alibaba\.com/.test(url))return'aliexpress'; return'desconocida';}
function aliExtract(url){
 return new Promise((res,rej)=>{
  execFile('python3',['ali_extract.py',url],{timeout:30000,cwd:__dirname},(err,stdout)=>{
   if(err) return rej(err);
   try{res(JSON.parse(stdout.trim().split('\n').pop()));}catch(e){rej(e);}
  });
 });
}
function ytdlpJson(url){
 return new Promise((res,rej)=>{
  execFile('yt-dlp',['--dump-single-json','--no-playlist','--no-warnings',url],{timeout:25000,maxBuffer:20*1024*1024},(err,stdout)=>{
   if(err) return rej(err);
   try{res(JSON.parse(stdout));}catch(e){rej(e);}
  });
 });
}
function pickFormat(info,quality,origUrl){
 const fmts=(info.formats||[]).filter(f=>f.url);
 if(quality==='mp3') return {isAudio:true};
 const h=parseInt(quality)||720;
 const withVideo=fmts.filter(f=>f.vcodec!=='none'&&f.height);
 withVideo.sort((a,b)=>((a.height||0)-(b.height||0))||((b.tbr||0)-(a.tbr||0)));
 // 1) Progresivo (video+AUDIO juntos, ej. itag 18/22): descarga directa con sonido.
 //    Los DASH solo-video (itag 398/399) se verían MUDOS al descargar directo.
 const prog=withVideo.filter(f=>f.acodec&&f.acodec!=='none'&&(f.height||0)<=(h===99999?1e9:h));
 if(quality==='max'){
  const bestProg=withVideo.filter(f=>f.acodec&&f.acodec!=='none').pop();
  if(bestProg) return {isAudio:false,format:bestProg};
 } else if(prog.length) return {isAudio:false,format:prog[prog.length-1]};
 // 2) Sin progresivo a esa calidad (típico YouTube HD): mezclar en servidor con ffmpeg.
 //    Devuelve URL de nuestra API que une video+audio y fuerza attachment.
 return {isAudio:false,merge:true,downloadUrl:`/api/download?url=${encodeURIComponent(origUrl)}&quality=${quality}`};
}
async function cobaltDirect(url,quality){
 const isAudio=quality==='mp3';
 // alwaysProxy:true = Cobalt devuelve URL "tunnel" (descarga el archivo) en vez de
 // "redirect" (enlace CDN directo que el navegador ABRE en vez de descargar).
 const body={url,videoQuality:isAudio?'720':(quality==='max'?'max':quality),downloadMode:isAudio?'audio':'auto',filenameStyle:'pretty',alwaysProxy:true};
 for(const base of COBALT){
  for(const p of ['/','/api/get']){
   try{
    const r=await fetchT(base+p,{method:'POST',headers:cobaltHeaders(),body:JSON.stringify(body)},15000);
    if(!r.ok) continue; const j=await r.json();
    if((j.status==='tunnel'||j.status==='redirect')&&j.url)
     return {direct:j.url,filename:j.filename||'',tunneled:j.status==='tunnel'};
    if(j.status==='picker'&&Array.isArray(j.picker)){
     const v=j.picker.find(i=>i.type==='video')||j.picker[0];
     if(v&&v.url) return {direct:v.url,filename:'',tunneled:false};
    }
    const d=j.url||j.downloadUrl||j.response?.url;
    if(d) return {direct:d,filename:j.filename||'',tunneled:false};
   }catch{}
  }
 }
 throw new Error('cobalt-fallback-fallo');
}

app.get('/api/health',(req,res)=>res.json({ok:true, ytdlp:'optional'}));

app.post('/api/info',async(req,res)=>{
 const {url,quality='720'}=req.body||{};
 if(!url||!/^https?:\/\//.test(url)) return res.status(400).json({error:'URL inválida'});
 const net=detect(url);
 // Restricción gratis: 1080p/máxima solo PRO (al resto se le da 720p).
 let proUser=false;
 if(req.user){ try{ const db0=saas.load(); proUser=saas.isPro(saas.getUser(db0,req.user.email)); }catch(e){} }
 if(!proUser && (quality==='max'||quality==='1080')) quality='720';
 // Reloj global: la respuesta nunca tarda más de 75s (yt-dlp 25s + cobalt 6×15s máx).
 const timeout=setTimeout(()=>{ if(!res.headersSent) res.status(504).json({error:'Tiempo agotado resolviendo el video. Intenta de nuevo.'}); },75000);
 const done=(code,obj)=>{ clearTimeout(timeout); if(!res.headersSent) res.status(code).json(obj); };
 // Método 0: AliExpress (extractor Python propio; yt-dlp no soporta paginas de producto)
 if(net==='aliexpress'){
  try{
   const a=await aliExtract(url);
   if(a.error) return done(422,{error:a.error});
   return done(200,{title:a.title,uploader:'AliExpress',thumbnail:a.thumbnail||'',duration:'',net,direct:a.direct,via:'aliexpress-py'});
  }catch(e){ return done(502,{error:'No se pudo leer el producto de AliExpress.',detail:String(e.message||e).slice(0,200)}); }
 }
 // Método 1: yt-dlp
 try{
  const info=await ytdlpJson(url);
  const pick=pickFormat(info,quality,url);
  let direct;
  if(pick.isAudio){
   direct=`/api/download?url=${encodeURIComponent(url)}&quality=mp3`;
  } else if(pick.merge){
   direct=pick.downloadUrl; // YouTube HD: el servidor une video+audio con ffmpeg
  } else {
   direct=pick.format?.url || info.webpage_url;
  }
  return done(200,{title:info.title,uploader:info.uploader||info.channel,thumbnail:info.thumbnail,duration:info.duration_string||info.duration,net,direct,via:'yt-dlp'});
 }catch(e){ console.warn('yt-dlp fallo, usando cobalt:',e.message?.slice(0,200)); }
 // Método 2: cobalt (siempre con tunnel = descarga, nunca redirect = reproduce)
 try{
  const c=await cobaltDirect(url,quality);
  // Si es tunnel, lo pasamos por nuestro proxy para forzar attachment + nombre bonito.
  const direct=c.tunneled
   ? `/api/dl?url=${encodeURIComponent(c.direct)}&filename=${encodeURIComponent(c.filename||('snapfree-'+net+'.mp4'))}`
   : c.direct;
  return done(200,{title:url,uploader:'',thumbnail:'',duration:'',net,direct,via:'cobalt-tunnel'});
 }catch(e){ return done(502,{error:'No se pudo resolver. Verifica que el video sea público.',detail:String(e.message||e)}); }
});

app.get('/api/download', saas.quota, (req,res)=>{
 const url=req.query.url, quality=req.query.quality||'720';
 if(!url) return res.status(400).send('falta url');
  const isAudio=quality==='mp3';
  const q=parseInt(quality)||720;
  // yt-dlp stream con ffmpeg: une video+audio y fuerza mp4/mp3 con sonido.
  const args=isAudio
   ? ['-f','bestaudio','--extract-audio','--audio-format','mp3','-o','-','--no-playlist','--no-warnings',url]
   : ['-f',`bv*[height<=${q}]+ba/b[height<=${q}]/b`,`--merge-output-format`,`mp4`,'-o','-','--no-playlist','--no-warnings',url];
  res.setHeader('Content-Type',isAudio?'audio/mpeg':'video/mp4');
  res.setHeader('Content-Disposition',`attachment; filename="snapfree-${Date.now()}.${isAudio?'mp3':'mp4'}"`);
 const p=spawn('yt-dlp',args);
 p.stdout.pipe(res);
 p.stderr.on('data',d=>process.stderr.write(d));
 p.on('error',()=>res.redirect(302,url)); // si no hay yt-dlp, redirige
});

// NUEVO: proxy de descarga forzada — evita que el video se abra en otra pestaña.
// El frontend siempre descarga vía /api/dl?url=... que responde `attachment`.
app.get('/api/dl', saas.quota, async (req,res)=>{
 const remote=req.query.url;
 const filename=(req.query.filename||`snapfree-${Date.now()}.mp4`).replace(/[^\w\-. áéíóúñ]+/gi,'_').slice(0,120);
 if(!remote||!/^https?:\/\//.test(remote)) return res.status(400).send('url inválida');
 try{
  const r=await fetchFn(remote,{headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok) return res.redirect(302,remote);
  const ct=r.headers.get('content-type')||'video/mp4';
  res.setHeader('Content-Type',ct);
  res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
  const len=r.headers.get('content-length'); if(len) res.setHeader('Content-Length',len);
  if(r.body && r.body.pipe) r.body.pipe(res);
  else { const buf=Buffer.from(await r.arrayBuffer()); res.end(buf); }
 }catch(e){ res.redirect(302,remote); }
});

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('SnapFree backend en http://localhost:'+PORT));
