import fs from 'node:fs';

const htmlPath='app.html';
const cssPath='css/app-polish.css';
const jsPath='js/app-ui-sync.js';
const workflowPath='.github/workflows/patch-app-inline.yml';
const toolPath='tools/patch-app-inline.mjs';

let html=fs.readFileSync(htmlPath,'utf8');
let css=fs.readFileSync(cssPath,'utf8');

const styleMatch=html.match(/<style>([\s\S]*?)<\/style>/);
if(!styleMatch)throw new Error('Bloco de estilo inline do painel não encontrado.');
const inlineCss=styleMatch[1].trim();
html=html.replace(styleMatch[0],'');

const inlineScript=/<script>\(\(\)=>\{const button=document\.getElementById\('store-status-button'\)[\s\S]*?<\/script>/;
if(!inlineScript.test(html))throw new Error('Script inline operacional do painel não encontrado.');
html=html.replace(inlineScript,'<script src="js/app-ui-sync.js"></script>');

if(!css.includes('.nav-section-label{'))css+=`\n\n/* Navegação e menu móvel do painel */\n${inlineCss}\n`;

const module=`(()=>{\n  'use strict';\n  if(window.__fsAppUiSync)return;\n  window.__fsAppUiSync=true;\n\n  const cleanup=[];\n  const listen=(target,type,handler,options)=>{\n    target?.addEventListener(type,handler,options);\n    cleanup.push(()=>target?.removeEventListener(type,handler,options));\n  };\n\n  function syncStoreStatus(){\n    const button=document.getElementById('store-status-button');\n    const label=document.getElementById('store-status-label');\n    if(!button||!label)return;\n    label.textContent=button.classList.contains('pronto')?'Loja aberta':'Loja fechada';\n  }\n\n  function syncPreparing(){\n    const summary=document.getElementById('summary-preparing');\n    const home=document.getElementById('home-preparing');\n    if(summary&&home)home.textContent=summary.textContent;\n  }\n\n  function setupOrderTabs(){\n    const kanban=document.getElementById('orders-kanban');\n    const active=document.getElementById('active-orders-tab');\n    const history=document.getElementById('history-orders-tab');\n    if(!kanban||!active||!history)return;\n    const showActive=()=>{\n      kanban.classList.add('history-hidden');\n      [...kanban.children].forEach(column=>column.hidden=false);\n      active.classList.add('active');\n      history.classList.remove('active');\n    };\n    const showHistory=()=>{\n      kanban.classList.remove('history-hidden');\n      [...kanban.children].forEach((column,index)=>column.hidden=index!==3);\n      history.classList.add('active');\n      active.classList.remove('active');\n    };\n    listen(active,'click',showActive);\n    listen(history,'click',showHistory);\n  }\n\n  function setupMoreMenu(){\n    const button=document.getElementById('mobile-more-button');\n    const menu=document.getElementById('mobile-more-menu');\n    if(!button||!menu)return;\n    const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false')};\n    listen(button,'click',()=>{const open=menu.hidden;menu.hidden=!open;button.setAttribute('aria-expanded',String(open))});\n    menu.querySelectorAll('[data-mobile-page]').forEach(item=>listen(item,'click',()=>{document.querySelector(\`[data-page="\${item.dataset.mobilePage}"]\`)?.click();close()}));\n    listen(document,'click',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!button.contains(event.target))close()});\n    listen(document,'keydown',event=>{if(event.key==='Escape')close()});\n  }\n\n  function setupExplicitSync(){\n    syncStoreStatus();\n    syncPreparing();\n    listen(document,'fs:store-status-changed',syncStoreStatus);\n    listen(document,'fs:orders-updated',syncPreparing);\n    listen(document,'click',event=>{\n      if(event.target.closest?.('#store-status-button'))requestAnimationFrame(syncStoreStatus);\n    });\n  }\n\n  function start(){\n    setupExplicitSync();\n    setupOrderTabs();\n    setupMoreMenu();\n  }\n\n  if(document.readyState==='loading')listen(document,'DOMContentLoaded',start,{once:true});else start();\n  window.addEventListener('pagehide',()=>cleanup.splice(0).forEach(dispose=>dispose()),{once:true});\n})();\n`;

fs.writeFileSync(htmlPath,html);
fs.writeFileSync(cssPath,css);
fs.writeFileSync(jsPath,module);
fs.rmSync(workflowPath,{force:true});
fs.rmSync(toolPath,{force:true});
