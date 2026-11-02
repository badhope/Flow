import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
const BASE='http://127.0.0.1:3400';
const OUT='docs/qa/screens';
await mkdir(OUT,{recursive:true});
const exe=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(c=>existsSync(c));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox'],defaultViewport:{width:1440,height:950}});
const p=await b.newPage();
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},credentials:'include',body:JSON.stringify({email:'buyer@example.com',password:'buyer123'})});});
const routes=[['buyer-home','/'],['buyer-list','/products'],['buyer-cart','/cart'],['buyer-checkout','/checkout'],['buyer-orders','/orders'],['buyer-favorites','/favorites'],['buyer-addresses','/addresses']];
for(const [n,r] of routes){
  await p.goto(BASE+r,{waitUntil:'networkidle2'});
  await new Promise(x=>setTimeout(x,1200));
  await p.evaluate(async()=>{const h=document.documentElement.scrollHeight;for(let y=0;y<h;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,40));}window.scrollTo(0,0);});
  await new Promise(x=>setTimeout(x,600));
  await p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});
  console.log('shot',n);
}
await b.close();
