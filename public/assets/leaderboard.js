const statusEl=document.querySelector('#leader-status');
const tableHost=document.querySelector('#leader-table-host');
const tabs=document.querySelectorAll('[data-metric]');
let snapshot=null;
const fmtHours=(m)=>`${(Number(m||0)/60).toLocaleString('zh-CN',{maximumFractionDigits:1})} 小时`;
const fmtDate=(s)=>s?new Date(Number(s)*1000).toLocaleString('zh-CN'):'—';
const cell=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el};
function entriesFor(metric){return snapshot?.metrics?.[metric]||[]}
function render(metric){
  tabs.forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.metric===metric)));
  const entries=entriesFor(metric);
  if(!entries.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='排行榜暂无数据。先在首页生成一次全景图，成功读取的账号会写入站点缓存。';tableHost.replaceChildren(empty);return}
  const wrap=document.createElement('div');wrap.className='table-wrap';const table=document.createElement('table');table.className='leader-table';
  const head=document.createElement('thead');const hr=document.createElement('tr');['排名','Steam 账号','游戏数量','总游玩时间','平均游戏时长','最常玩的游戏','数据更新时间'].forEach(t=>hr.append(cell('th',t)));head.append(hr);
  const body=document.createElement('tbody');entries.forEach((entry,index)=>{const row=document.createElement('tr');row.append(cell('td',String(index+1)));const id=cell('td','');const link=document.createElement('a');link.href=`/${encodeURIComponent(entry.steamId)}`;link.textContent=entry.steamId;id.append(link);row.append(id,cell('td',Number(entry.gameCount||0).toLocaleString('zh-CN')),cell('td',fmtHours(entry.totalMinutes)),cell('td',fmtHours(entry.averageMinutes)),cell('td',entry.topGame?.name?`${entry.topGame.name}（${fmtHours(entry.topGame.minutes)}）`:'—'),cell('td',fmtDate(entry.lastUpdated)));body.append(row)});
  table.append(head,body);wrap.append(table);tableHost.replaceChildren(wrap);
}
tabs.forEach(tab=>tab.addEventListener('click',()=>render(tab.dataset.metric)));
async function load(){try{const response=await fetch('/api/leaderboard',{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');snapshot=data;statusEl.hidden=true;document.querySelector('#cached-profiles').textContent=Number(data.playtimeCacheSize||0).toLocaleString('zh-CN');document.querySelector('#total-hours').textContent=fmtHours(data.summary?.totalMinutes);document.querySelector('#unique-games').textContent=Number(data.summary?.uniqueGameCount||0).toLocaleString('zh-CN');document.querySelector('#top-game').textContent=data.summary?.topGame?.name||'—';document.querySelector('#generated-at').textContent=fmtDate(data.generatedAt);render('byTotalPlaytime')}catch(error){statusEl.textContent=`排行榜读取失败：${error instanceof Error?error.message:'请稍后重试'}`;statusEl.hidden=false}}
load();
