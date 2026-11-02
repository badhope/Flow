import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const BASE='http://127.0.0.1:3400';
const OUT='docs/qa/screens';
await mkdir(OUT,{recursive:true});
const cands=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'];
const exe=cands.find(c=>existsSync(c));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox'],defaultViewport:{width:1440,height:950}});
const p=await b.newPage();
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
const st=await p.evaluate(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},credentials:'include',body:JSON.stringify({email:'seller@example.com',password:'seller123'})});return r.status;});
console.log('seller login',st);
const routes=[['products','/seller/products'],['orders','/seller/orders'],['refunds','/seller/refunds'],['inquiries','/seller/inquiries'],['copilot','/seller/copilot'],['ai','/seller/ai-center'],['coupons','/seller/coupons'],['shipping','/seller/shipping-templates'],['collections','/seller/collections'],['cms','/seller/cms-pages'],['audit','/seller/audit-logs'],['dashboard','/seller/dashboard']];
for(const [name,r] of routes){
  await p.goto(BASE+r,{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1200));
  await p.evaluate(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,50));}window.scrollTo(0,0);});
  await new Promise(r=>setTimeout(r,700));
  await p.screenshot({path:`${OUT}/${name}.png`,fullPage:true});
  console.log('shot',name);
}
await b.close();
