const CDN='https://cdn.steamstatic.com/steam/apps';
const grid=document.querySelector('#games');
const shell=document.querySelector('#mosaic-shell');
const overlay=document.querySelector('#loading-overlay');
const downloadButton=document.querySelector('#download-button');
const downloadMessage=document.querySelector('#download-message');
const accountHost=document.querySelector('#account-status');
const keyStorage='steam_api_key';
let payload=null;
let imageSettled=Promise.resolve();
let resizeFrame=0;

function getIdentifiers(){
  const path=window.location.pathname;
  const raw=path.startsWith('/profile/')?path.slice('/profile/'.length):path.replace(/^\//,'');
  try{return decodeURIComponent(raw)}catch{return raw}
}
const identifiers=getIdentifiers();
const getKey=()=>{try{return localStorage.getItem(keyStorage)||''}catch{return ''}};
const hours=m=>Number(m||0)/60;
const formatHours=m=>`${hours(m).toLocaleString('zh-CN',{maximumFractionDigits:1})} 小时`;
const escapeFile=value=>value.replace(/[^A-Za-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'');

function setLoading(message='正在读取 Steam 公开游戏数据…'){
  overlay.hidden=false;overlay.replaceChildren();const card=document.createElement('div');card.className='loader-card';const spinner=document.createElement('div');spinner.className='spinner';spinner.setAttribute('aria-hidden','true');const text=document.createElement('p');text.textContent=message;const s1=document.createElement('div');s1.className='skeleton';const s2=document.createElement('div');s2.className='skeleton';s2.style.width='68%';card.append(spinner,text,s1,s2);overlay.append(card);downloadButton.disabled=true;
}
function showError(message){
  overlay.hidden=false;overlay.replaceChildren();const box=document.createElement('div');box.className='error-box';const title=document.createElement('h2');title.textContent='无法生成全景图';const text=document.createElement('p');text.textContent=message;const actions=document.createElement('div');actions.className='result-actions';const retry=document.createElement('button');retry.type='button';retry.className='button';retry.textContent='重试';retry.addEventListener('click',load);const home=document.createElement('a');home.className='button secondary';home.href='/';home.textContent='返回首页检查输入';const guide=document.createElement('a');guide.className='button ghost';guide.href='/guide#errors';guide.textContent='查看排错教程';actions.append(retry,home,guide);box.append(title,text,actions);overlay.append(box);downloadButton.disabled=true;
}
function renderAccounts(accounts){
  const fragment=document.createDocumentFragment();
  for(const item of accounts?.successful||[]){const line=document.createElement('div');line.className='status-line success';line.textContent=`读取成功：${item.identifier}${item.identifier!==item.steamID?` → ${item.steamID}`:''}`;fragment.append(line)}
  for(const item of accounts?.failed||[]){const line=document.createElement('div');line.className='status-line error';line.textContent=`读取失败：${item.identifier||'未知账号'} — ${item.error||'未知错误'}`;fragment.append(line)}
  accountHost.replaceChildren(fragment);
}
function computeLayout(games){
  const width=Math.max(grid.clientWidth||window.innerWidth,320);const base=width<560?78:width<900?66:58;const columns=Math.max(4,Math.min(28,Math.floor(width/base)));const maxSpan=Math.max(2,Math.min(6,Math.floor(columns/3)));const max=Math.max(...games.map(g=>hours(g.playtime_forever)),1);const weights=games.map(g=>Math.pow(Math.log1p(hours(g.playtime_forever))/Math.log1p(max),.82));
  return {columns,rowSize:Math.max(35,(width-(columns-1)*3)/columns/2.14),spans:weights.map((weight,index)=>{let span=1+Math.round(weight*(maxSpan-1));if(index===0)span=Math.min(maxSpan,Math.max(3,span));return Math.max(1,Math.min(maxSpan,span))})};
}
function layoutGames(){if(!payload?.games?.length)return;const layout=computeLayout(payload.games);grid.style.setProperty('--columns',String(layout.columns));grid.style.setProperty('--row-size',`${layout.rowSize}px`);[...grid.children].forEach((card,index)=>{const span=layout.spans[index]||1;card.style.gridColumn=`span ${span}`;card.style.gridRow=`span ${span}`})}
function makeCard(game){
  const card=document.createElement('button');card.type='button';card.className='game-card';card.setAttribute('aria-label',`${game.name||`App ${game.appid}`}，${formatHours(game.playtime_forever)}`);const img=document.createElement('img');img.alt='';img.loading='eager';img.decoding='async';img.crossOrigin='anonymous';img.src=`${CDN}/${game.appid}/header.jpg`;const info=document.createElement('span');info.className='game-info';const name=document.createElement('span');name.className='game-name';name.textContent=game.name||`App ${game.appid}`;const time=document.createElement('span');time.className='game-hours';time.textContent=formatHours(game.playtime_forever);info.append(name,time);card.append(img,info);card.addEventListener('click',()=>{const active=!card.classList.contains('is-active');grid.querySelectorAll('.is-active').forEach(el=>el.classList.remove('is-active'));card.classList.toggle('is-active',active)});return {card,img};
}
function render(data){
  payload=data;const games=[...(data.games||[])].filter(g=>Number(g.appid)>0&&Number(g.playtime_forever)>0).sort((a,b)=>Number(b.playtime_forever)-Number(a.playtime_forever));if(!games.length){showError('没有找到任何已游玩的游戏。请确认 Steam 资料、游戏详情及总游戏时间已公开。');return}payload.games=games;
  document.querySelector('#result-title').textContent=data.merged?`${data.accounts.successful.length} 个账号的合并全景图`:'Steam 游玩时光全景图';document.querySelector('#result-subtitle').textContent=data.merged?`共请求 ${data.requestedCount} 个账号，成功 ${data.accounts.successful.length} 个，失败 ${data.accounts.failed.length} 个。`:`当前账号：${data.accounts.successful[0]?.steamID||identifiers}`;document.querySelector('#stat-accounts').textContent=String(data.accounts.successful.length);document.querySelector('#stat-games').textContent=games.length.toLocaleString('zh-CN');const total=games.reduce((sum,g)=>sum+Number(g.playtime_forever||0),0);document.querySelector('#stat-total').textContent=formatHours(total);document.querySelector('#stat-average').textContent=formatHours(total/games.length);document.querySelector('#stat-top').textContent=`${games[0].name||`App ${games[0].appid}`} · ${formatHours(games[0].playtime_forever)}`;renderAccounts(data.accounts);
  const fragment=document.createDocumentFragment();const waits=[];for(const game of games){const {card,img}=makeCard(game);fragment.append(card);waits.push(new Promise(resolve=>{if(img.complete){if(!img.naturalWidth)card.classList.add('image-failed');resolve();return}img.addEventListener('load',resolve,{once:true});img.addEventListener('error',()=>{card.classList.add('image-failed');resolve()},{once:true})}))}grid.replaceChildren(fragment);layoutGames();overlay.hidden=true;imageSettled=Promise.allSettled(waits);downloadButton.disabled=true;imageSettled.then(()=>{downloadButton.disabled=false;downloadButton.textContent='下载高清图片'});
}
async function load(){
  if(!identifiers){showError('没有收到 Steam 账号，请返回首页输入后再试。');return}setLoading();downloadMessage.textContent='';
  try{const key=getKey();const headers={'Content-Type':'application/json','Accept':'application/json'};if(key)headers['X-Steam-API-Key']=key;const response=await fetch('/api/playtime',{method:'POST',headers,body:JSON.stringify({identifiers})});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'本站服务返回了无法识别的错误。');render(data)}catch(error){showError(error instanceof Error?error.message:'暂时无法读取 Steam 数据，请稍后重试。')}
}
function drawFallback(ctx,x,y,w,h,name){ctx.fillStyle='#182632';ctx.fillRect(x,y,w,h);ctx.fillStyle='#9db2c0';ctx.font=`${Math.max(11,Math.min(22,w/14))}px system-ui`;ctx.textAlign='center';ctx.textBaseline='middle';const label=(name||'封面暂不可用').slice(0,22);ctx.fillText(label,x+w/2,y+h/2,Math.max(20,w-18))}
function drawCover(ctx,img,x,y,w,h){const sourceRatio=img.naturalWidth/img.naturalHeight;const targetRatio=w/h;let sx=0,sy=0,sw=img.naturalWidth,sh=img.naturalHeight;if(sourceRatio>targetRatio){sw=img.naturalHeight*targetRatio;sx=(img.naturalWidth-sw)/2}else{sh=img.naturalWidth/targetRatio;sy=(img.naturalHeight-sh)/2}ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h)}
async function exportImage(){
  await imageSettled;const cards=[...grid.querySelectorAll('.game-card')];if(!cards.length)throw new Error('拼图尚未准备完成。');const bounds=grid.getBoundingClientRect();const width=Math.ceil(bounds.width);const height=Math.ceil(bounds.height);const desired=Math.min(3,Math.max(2,window.devicePixelRatio||1));const maxDimension=8192;const maxPixels=48_000_000;const safe=Math.min(desired,maxDimension/width,maxDimension/height,Math.sqrt(maxPixels/(width*height)));const scale=Math.max(.2,safe);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(width*scale));canvas.height=Math.max(1,Math.floor(height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('当前浏览器不支持 Canvas 图片导出。');ctx.fillStyle='#091018';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(const card of cards){const rect=card.getBoundingClientRect();const x=(rect.left-bounds.left)*scale,y=(rect.top-bounds.top)*scale,w=rect.width*scale,h=rect.height*scale;const img=card.querySelector('img');if(img?.naturalWidth){try{drawCover(ctx,img,x,y,w,h)}catch{drawFallback(ctx,x,y,w,h,img.alt)}}else drawFallback(ctx,x,y,w,h,card.getAttribute('aria-label'))}
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('浏览器未能生成 PNG 文件。')),'image/png'));const success=payload.accounts.successful;const label=payload.merged?`merged-${success.length}-accounts`:escapeFile(success[0]?.steamID||identifiers)||'profile';const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`steam-playtime-${label}.png`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
downloadButton?.addEventListener('click',async()=>{downloadButton.disabled=true;downloadButton.textContent='正在生成图片…';downloadMessage.textContent='';try{await exportImage();downloadButton.textContent='下载高清图片'}catch(error){downloadMessage.textContent=`下载失败：${error instanceof Error?error.message:'请刷新页面后重试。'}`;downloadButton.textContent='重试下载'}finally{downloadButton.disabled=false}});
window.addEventListener('resize',()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(layoutGames)});
load();
