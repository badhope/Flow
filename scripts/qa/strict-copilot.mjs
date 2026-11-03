import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const BASE='http://127.0.0.1:3400';
const exe=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(c=>existsSync(c));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox'],defaultViewport:{width:1440,height:950}});
for (let i=0;i<3;i++){
  const p=await b.newPage();
  const errs=[];
  p.on('response',r=>{ if(r.status()>=400) errs.push(`${r.status()} ${r.request().method()} ${r.url().slice(0,90)}`); });
  await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  const st=await p.evaluate(async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},credentials:'include',body:JSON.stringify({email:'seller@example.com',password:'seller123'})});return r.status;});
  await p.goto(BASE+'/seller/copilot',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,2500));
  console.log(`run${i} login=${st} errors=${JSON.stringify(errs)}`);
  await p.close();
}
await b.close();
