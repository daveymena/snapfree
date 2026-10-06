// SnapFree Auth + cuota (frontend)
window.SnapAuth = (()=>{
 const K='snapfree_token';
 const token=()=>localStorage.getItem(K)||'';
 const h=()=>token()?{Authorization:'Bearer '+token()}:{};
 async function quota(){
  try{const r=await fetch('/api/quota',{headers:h()});return await r.json();}
  catch{return {login:!!token(),left:5,limit:5,pro:false};}
 }
 async function register(email,password){
  const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const j=await r.json(); if(!r.ok) throw new Error(j.message||'error');
  localStorage.setItem(K,j.token); return j;
 }
 async function login(email,password){
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  const j=await r.json(); if(!r.ok) throw new Error(j.message||'error');
  localStorage.setItem(K,j.token); return j;
 }
 function logout(){localStorage.removeItem(K);}
 return {token,h,quota,register,login,logout};
})();
