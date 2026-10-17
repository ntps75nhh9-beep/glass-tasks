const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}});
const b64=s=>btoa(String.fromCharCode(...new Uint8Array(s))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const from64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const encoder=new TextEncoder();
async function sign(payload,secret){const body=b64(encoder.encode(JSON.stringify(payload)));const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return body+'.'+b64(await crypto.subtle.sign('HMAC',key,encoder.encode(body)))}
async function verify(token,secret){try{const [body,sig,extra]=token.split('.');if(!body||!sig||extra)return null;const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);if(!await crypto.subtle.verify('HMAC',key,from64(sig),encoder.encode(body)))return null;const p=JSON.parse(new TextDecoder().decode(from64(body)));return p.exp>Date.now()?p:null}catch{return null}}
function cookies(req){return Object.fromEntries((req.headers.get('cookie')||'').split(';').map(x=>x.trim().split('=').map(decodeURIComponent)).filter(x=>x.length===2))}
const authCookie=(name,value,maxAge)=>`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const validOrigin=(request,url)=>{const origin=request.headers.get('origin');return !origin||origin===url.origin};
const pathsafe=id=>/^[a-zA-Z0-9_-]{1,100}$/.test(id);
export default {async fetch(request,env){const url=new URL(request.url),path=url.pathname,method=request.method;
try{
 if(path==='/auth/google'&&method==='GET'){
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!env.SESSION_SECRET)return json({error:'OAuth environment is not configured'},503);
  const nonce=crypto.randomUUID(),redirect=url.origin+'/auth/callback';const auth=new URL('https://accounts.google.com/o/oauth2/v2/auth');auth.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:'openid email profile',state:nonce,prompt:'select_account'}).toString();return new Response(null,{status:302,headers:{location:auth.toString(),'set-cookie':authCookie('oauth_state',await sign({nonce,exp:Date.now()+600000},env.SESSION_SECRET),600)}})
 }
 if(path==='/auth/callback'&&method==='GET'){
  const state=await verify(cookies(request).oauth_state||'',env.SESSION_SECRET||'');if(!state||state.nonce!==url.searchParams.get('state')||!url.searchParams.get('code'))return json({error:'Invalid OAuth state'},400);
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:url.searchParams.get('code'),client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:url.origin+'/auth/callback',grant_type:'authorization_code'})});if(!tokenResponse.ok)return json({error:'Google token exchange failed'},401);
  const token=await tokenResponse.json();const userResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token}});if(!userResponse.ok)return json({error:'Google user validation failed'},401);
  const user=await userResponse.json();if(!user.sub||!user.email||!user.email_verified)return json({error:'Google email not verified'},401);
  await env.DB.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name').bind(user.sub,user.email,user.name||user.email,Date.now()).run();const session=await sign({sub:user.sub,exp:Date.now()+7*86400000},env.SESSION_SECRET);
  return new Response(null,{status:302,headers:{location:'/', 'set-cookie':authCookie('session',session,7*86400)}})
 }
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
 if(method!=='GET'&&!validOrigin(request,url))return json({error:'Forbidden origin'},403);
 if(path==='/api/logout'&&method==='POST')return json({ok:true},200,{'set-cookie':authCookie('session','',0)});
 const session=await verify(cookies(request).session||'',env.SESSION_SECRET||'');if(!session)return json({error:'Unauthorized'},401);
 const userId=session.sub;
 if(path==='/api/me'&&method==='GET'){const user=await env.DB.prepare('SELECT name,email FROM users WHERE id=?').bind(userId).first();if(!user)return json({error:'Unauthorized'},401);return json({user})}
 if(path==='/api/tasks'&&method==='GET'){const results=await env.DB.prepare('SELECT id,title,status,created_at FROM tasks WHERE user_id=? ORDER BY created_at DESC LIMIT 1000').bind(userId).all();return json({tasks:results.results})}
 if(path==='/api/tasks'&&method==='POST'){const x=await request.json();if(typeof x.title!=='string'||!x.title.trim()||x.title.length>240||!pathsafe(x.id)||x.status!=='todo')return json({error:'Invalid task'},400);await env.DB.prepare('INSERT INTO tasks (id,user_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(x.id,userId,x.title.trim(),'todo',Date.now(),Date.now()).run();return json({ok:true},201)}
 const match=path.match(/^\/api\/tasks\/([^/]+)$/);if(match){const id=decodeURIComponent(match[1]);if(!pathsafe(id))return json({error:'Invalid ID'},400);if(method==='PATCH'){const x=await request.json();if(!['todo','doing','done'].includes(x.status))return json({error:'Invalid status'},400);const r=await env.DB.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=? AND user_id=?').bind(x.status,Date.now(),id,userId).run();return r.meta.changes?json({ok:true}):json({error:'Not found'},404)}if(method==='DELETE'){const r=await env.DB.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').bind(id,userId).run();return r.meta.changes?json({ok:true}):json({error:'Not found'},404)}}
 if(path==='/api/ai/parse'&&method==='POST'){
  const data=await request.json();if(typeof data.text!=='string'||!data.text.trim()||data.text.length>2000)return json({error:'入力は1〜2000文字にしてください'},400);
  const output=await env.AI.run('@cf/meta/llama-3.1-8b-instruct',{messages:[{role:'system',content:'You turn Japanese notes into concrete, short, actionable to-do titles. Return ONLY a JSON array of Japanese strings, maximum 8 items. Do not include markdown, explanations, or personal data not supplied.'},{role:'user',content:data.text}],max_tokens:450,temperature:0.2});const raw=typeof output==='string'?output:output.response||'';const match=raw.match(/\[[\s\S]*?\]/);if(!match)return json({error:'AIの出力を読み取れませんでした'},502);let titles;try{titles=JSON.parse(match[0])}catch{return json({error:'AIの出力形式が不正です'},502)}if(!Array.isArray(titles))return json({error:'AIの出力形式が不正です'},502);titles=titles.filter(s=>typeof s==='string'&&s.trim()).slice(0,8).map(s=>s.trim().slice(0,240));return json({tasks:titles})
 }
 return json({error:'Not found'},404);
}catch(e){console.error('request error',e);return json({error:'リクエストを処理できませんでした'},500)}
}};
export {sign,verify,pathsafe};
