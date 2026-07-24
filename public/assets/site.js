const toggle=document.querySelector('[data-nav-toggle]');
const links=document.querySelector('[data-nav-links]');
toggle?.addEventListener('click',()=>{const open=links?.classList.toggle('open')??false;toggle.setAttribute('aria-expanded',String(open))});
links?.addEventListener('click',()=>{links.classList.remove('open');toggle?.setAttribute('aria-expanded','false')});
