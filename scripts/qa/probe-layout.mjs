import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const BASE='http://127.0.0.1:3400';
const exe=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(c=>existsSync(c));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox'],defaultViewport:{width:1440,height:950}});
const p=await b.newPage();
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},credentials:'include',body:JSON.stringify({email:'seller@example.com',password:'seller123'})});});
for(const r of ['/seller/ai-center','/seller/products','/seller/dashboard']){
  await p.goto(BASE+r,{waitUntil:'networkidle2'});
  await new Promise(x=>setTimeout(x,1500));
  const info=await p.evaluate(()=>{
    const de=document.documentElement;
    const scrollers=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);return (s.overflowY==='auto'||s.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+10;}).map(e=>({tag:e.tagName,cls:(e.className||'').toString().slice(0,60),sh:e.scrollHeight,ch:e.clientHeight}));
    return {docH:de.scrollHeight,winH:window.innerHeight,bodyH:document.body.scrollHeight,scrollers:scrollers.slice(0,5)};
  });
  console.log(r,JSON.stringify(info));
}
await b.close();
