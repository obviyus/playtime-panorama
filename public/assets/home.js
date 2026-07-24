const form=document.querySelector('#steam-form');
const accountInput=document.querySelector('#steam-accounts');
const keyInput=document.querySelector('#api-key');
const errorEl=document.querySelector('#form-error');
const toggleKey=document.querySelector('#toggle-key');
const clearKey=document.querySelector('#clear-key');
const STORAGE_KEY='steam_api_key';

function normalizeToken(value){
  const token=value.trim();
  if(!token)return '';
  if(/steamcommunity\.com/i.test(token)){
    try{
      const url=new URL(/^https?:\/\//i.test(token)?token:`https://${token}`);
      if(!/(^|\.)steamcommunity\.com$/i.test(url.hostname))return '';
      const parts=url.pathname.split('/').filter(Boolean);
      if(['id','profiles'].includes((parts[0]||'').toLowerCase())&&parts[1])return decodeURIComponent(parts[1]);
      return '';
    }catch{return ''}
  }
  return token.replace(/^\/+|\/+$/g,'');
}

function parseAccounts(raw){
  const unique=new Map();
  for(const part of raw.split(/[\s,，;；]+/u)){
    const value=normalizeToken(part);
    if(value)unique.set(value.toLowerCase(),value);
  }
  return [...unique.values()];
}

try{const saved=localStorage.getItem(STORAGE_KEY);if(saved&&keyInput){keyInput.value=saved;document.querySelector('.api-details').open=true}}catch{}
toggleKey?.addEventListener('click',()=>{if(!keyInput)return;const visible=keyInput.type==='text';keyInput.type=visible?'password':'text';toggleKey.textContent=visible?'显示':'隐藏';keyInput.focus()});
clearKey?.addEventListener('click',()=>{try{localStorage.removeItem(STORAGE_KEY)}catch{};if(keyInput)keyInput.value='';clearKey.textContent='已清除';setTimeout(()=>clearKey.textContent='清除',1200)});
accountInput?.addEventListener('input',()=>{if(errorEl)errorEl.textContent='';accountInput.removeAttribute('aria-invalid')});
form?.addEventListener('submit',(event)=>{
  event.preventDefault();
  const accounts=parseAccounts(accountInput?.value||'');
  let message='';
  if(!accounts.length)message='请输入至少一个 Steam 账号、SteamID64 或个人资料网址。';
  else if(accounts.length>10)message='一次最多合并 10 个账号，请减少后重试。';
  else if(accounts.some(v=>!/^\d{17}$/.test(v)&&!/^[A-Za-z0-9_-]{2,64}$/.test(v)))message='存在格式明显无效的账号。SteamID64 通常是 17 位数字，自定义用户名只能包含字母、数字、下划线或连字符。';
  if(message){if(errorEl)errorEl.textContent=message;accountInput?.setAttribute('aria-invalid','true');accountInput?.focus();return}
  const key=keyInput?.value.trim()||'';
  try{if(key)localStorage.setItem(STORAGE_KEY,key);else localStorage.removeItem(STORAGE_KEY)}catch{}
  window.location.assign(`/${encodeURIComponent(accounts.join(','))}`);
});
