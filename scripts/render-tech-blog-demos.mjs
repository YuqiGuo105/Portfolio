import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createCanvas, loadImage } = require(path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const lucide = require('lucide-react');
const ffmpeg = path.resolve(root, '../.media-tools/runtime/bin/ffmpeg');
const out = path.join(root, 'public/demos');
const canvas = createCanvas(1280, 720); const c = canvas.getContext('2d');
const ink = '#22313b', muted = '#647781', teal = '#118675', blue = '#327dcc', red = '#d56751';
const icons = {};
for (const name of ['Package', 'Container', 'Server', 'Boxes', 'GitPullRequest', 'GitMerge', 'ShieldCheck', 'CircleCheck', 'Database', 'Radio', 'Monitor', 'RefreshCcw', 'Check', 'X']) {
  icons[name] = await loadImage(Buffer.from(renderToStaticMarkup(React.createElement(lucide[name], { size: 80, color: ink, strokeWidth: 1.6 }))));
}
const ease = n => { n = Math.max(0, Math.min(1, n)); return n * n * (3 - 2 * n); };
function text(s,x,y,size=22,color=ink,weight=500) { c.font=`${weight} ${size}px Arial`; c.fillStyle=color; c.fillText(s,x,y); }
function box(x,y,w,h,color='#fff',line='#cedce2',radius=8) { c.beginPath(); c.roundRect(x,y,w,h,radius); c.fillStyle=color; c.fill(); if(line){c.strokeStyle=line;c.lineWidth=2;c.stroke();} }
function icon(name,x,y,size=40) { c.drawImage(icons[name],x,y,size,size); }
function wire(points,color='#b8cbd5',width=3) { c.beginPath(); points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke(); }
function packet(points,t,color=blue) { wire(points);const p=(t%2)/2;const a=points[0],b=points.at(-1);box(a[0]+(b[0]-a[0])*p-8,a[1]+(b[1]-a[1])*p-6,16,12,color,null,3); }
function check(x,y,ready){box(x,y,30,30,ready?'#d9f0e8':'#e8eef2',null,15);if(ready)icon('Check',x+5,y+5,20);}
function base(title,subtitle){c.fillStyle='#f3f7fa';c.fillRect(0,0,1280,720);text('TECH NOTES / YUQI GUO',40,37,13,muted,600);text(title,40,87,32,ink,700);text(subtitle,40,121,18,muted);}
function footer(t,chapters){chapters.forEach((s,i)=>{const x=40+i*304;box(x,635,288,3,'#d7e3e9',null,1);box(x,635,288*Math.max(0,Math.min(1,t/6-i)),3,teal,null,1);text(s,x,663,15,Math.floor(t/6)===i?ink:muted);});text('Article concept animation / illustrative system states',40,701,12,muted);}
function pod(x,y,alpha=1){c.save();c.globalAlpha=alpha;box(x,y,78,70,'#deedf9',blue);icon('Container',x+19,y+13,40);c.restore();}
function docker(t){
  base('Docker + Kubernetes','Build an image. Run a container. Reconcile a cluster.');
  box(40,176,330,400);text('BUILD + PACKAGE',65,211,14,blue,600);
  for(let i=0;i<3;i++){const dy=ease((t-i*.5)/1.6)*24;box(100+i*13,353-i*49-dy,172,65,['#d9e8ed','#b9dbec','#83bfe6'][i],blue);}
  icon('Package',162,224,62);text('Application image',92,451,23);text('Code + runtime dependencies',69,488,17,muted);text('One immutable digest',94,529,16,teal);
  box(420,176,260,400);text('DISTRIBUTE',446,211,14,blue,600);icon('Boxes',505,266,88);text('Image registry',467,422,23);text('sha256:7f2e...',477,461,18,muted);
  if(t>3)packet([[370,357],[420,357]],t); if(t>6)packet([[680,357],[738,357]],t,teal);
  box(738,176,502,400);text(t<6?'RUN A CONTAINER':'KUBERNETES / DESIRED REPLICAS: 3',758,211,14,teal,600);
  [760,916,1072].forEach((x,i)=>{box(x,270,144,240,'#edf4f6');icon('Server',x+53,460,35);text(`Node ${i+1}`,x+39,546,16,muted);});
  const failed=t>13&&t<16;
  if(t>4)pod(791,306,failed?.18:ease(t-4)); if(t>8)pod(949,306,ease(t-8)); if(t>10)pod(1103,306,ease(t-10));
  if(failed){icon('X',812,324,35);text('Replacing failed pod',795,242,16,red);}
  else if(t>=16){icon('RefreshCcw',765,225,24);text('Desired state restored',800,244,16,teal);}
  if(t>18){box(744,588,485,28,'#e4f0e9',null);text('Choose orchestration only when you need it.',758,609,17,teal);}
  footer(t,['Core terms','Build + run','Cluster reconciliation','Choose the smallest platform']);
}
function github(t){
  base('GitHub operations','A reviewed change, a verified release, a recovery path.');
  text('main',60,216,17,teal);wire([[60,254],[1200,254]],'#9cc7bc',4);
  wire([[180,254],[260,355],[500,355],[600,254]],blue,4);text('feature branch',275,397,18,blue);
  for(const [i,x,y] of [[0,180,254],[1,280,355],[2,390,355],[3,500,355],[4,600,254],[5,1000,254]]){box(x-11,y-11,22,22,t>i*1.8?(i<4?blue:teal):'#e5eef2','#fff',11);}
  if(t<12){const p=ease(t/12);box(178+820*p,244,19,19,teal,'#fff',10);}
  box(58,442,346,154);icon('GitPullRequest',78,466,44);text('Pull request',140,494,22);text('Focused commits + independent review',80,548,16,muted);
  box(438,442,346,154);icon('ShieldCheck',458,466,44);text('Required checks',518,494,22);
  ['Build','Test','Review'].forEach((s,i)=>{check(462+i*102,532,t>5+i*2);text(s,463+i*102,581,15,muted);});
  box(818,442,404,154);icon(t>18?'RefreshCcw':'GitMerge',840,466,44);text(t>18?'Rollback to v1.8':'Deploy v1.9',902,494,22);
  text(t>18?'Restore the known-good artifact':t>14?'Verify health before completing release':'Approval before promotion',840,548,16,t>14&&t<18?red:muted);
  if(t>13){wire([[1000,254],[1000,388],[1080,388]],t>18?teal:red);icon(t>18?'CircleCheck':'Monitor',1065,332,44);text(t>18?'Healthy again':'Health signal',1050,315,16,t>18?teal:red);}
  footer(t,['Branch + PR','Checks + review','Deploy + verify','Recover safely']);
}
function e2e(t){
  base('End-to-end testing','Follow a user action through to the durable outcome.');
  box(42,175,466,430);box(42,175,466,42,'#e8f0f5');text('Checkout / isolated test fixture',65,202,16,muted);
  text('Order #test-042',76,270,25);text('Example item',77,325,19);text('$12.00',371,325,19);wire([[76,350],[474,350]]);
  box(76,386,398,64,t<4?blue:t<14?'#718a97':teal,null);text(t<4?'Pay now':t<14?'Processing...':'Payment confirmed',t<4?225:167,427,22,'#fff');
  if(t>16){icon('CircleCheck',78,495,38);text('Receipt ready',132,524,23,teal);text('Assert UI + persisted state',78,565,17,muted);}
  const services=[{x:560,y:187,n:'API',i:'Monitor',at:4},{x:810,y:187,n:'Database',i:'Database',at:7},{x:560,y:392,n:'Queue',i:'Radio',at:9},{x:810,y:392,n:'Worker',i:'Server',at:12}];
  services.forEach(s=>{box(s.x,s.y,200,151,'#fff',t>s.at?teal:'#cedce2');icon(s.i,s.x+76,s.y+23,48);text(s.n,s.x+52,s.y+116,22);if(t>s.at)check(s.x+151,s.y+10,true);});
  if(t>4&&t<15)packet([[508,280],[560,280]],t);
  if(t>6&&t<15)packet([[760,260],[810,260]],t);
  if(t>10&&t<16)packet([[760,467],[810,467]],t,teal);
  box(1046,187,192,356,'#eaf3f0');text('EVIDENCE',1066,226,15,teal,600);
  ['UI result','Stored status','Async receipt','Trace ID'].forEach((s,i)=>{check(1065,257+i*62,t>13+i*2);text(s,1104,278+i*62,16);});
  footer(t,['Seed + trigger','Cross boundaries','Await the outcome','Assert + clean up']);
}
const stories=[
  {id:'blog-github-operations',contentId:'blog:df9bed8e-163b-41bb-82be-7f970eb7875d',title:'GitHub Operations',summary:'Article animation: PR review, required checks, release verification and rollback.',draw:github,chapters:['Branch + PR','Checks + review','Deploy + verify','Recover safely']},
  {id:'blog-docker-kubernetes',contentId:'blog:0d83bfe7-f639-47af-a613-50add642c293',title:'Docker and Kubernetes',summary:'Article animation: image packaging, registry delivery and cluster reconciliation.',draw:docker,chapters:['Core terms','Docker workflow','Kubernetes','Platform choice']},
  {id:'blog-e2e-testing',contentId:'blog:9b4fdb28-9305-4f16-95f5-1a76dad6b039',title:'End-to-End Testing',summary:'Article animation: a test journey across browser, API, persistence and asynchronous work.',draw:e2e,chapters:['Trigger','Boundaries','Outcome','Evidence']},
];
const enc=['-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-an'];
function run(args){const p=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});if(p.status!==0)throw Error('ffmpeg failed');}
const catalog=[];
for(const story of stories){
  const proc=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','24','-c:v','png','-i','-',...enc,path.join(out,`${story.id}.mp4`)],{stdio:['pipe','inherit','inherit']});const done=once(proc,'close');
  for(let frame=0;frame<24*24;frame++){story.draw(frame/24);if(!proc.stdin.write(await canvas.encode('png')))await once(proc.stdin,'drain');}proc.stdin.end();if((await done)[0]!==0)throw Error('render failed');
  run(['-ss','9','-i',path.join(out,`${story.id}.mp4`),'-t','6','-vf','scale=960:540',...enc,path.join(out,`${story.id}-hover.mp4`)]);
  run(['-ss','17','-i',path.join(out,`${story.id}.mp4`),'-frames:v','1','-c:v','libwebp','-quality','90',path.join(out,`${story.id}.webp`)]);
  const qualities=[];
  for(const height of [720,480,360]){const file=`${story.id}${height===720?'':`-${height}`}.mp4`;if(height!==720)run(['-i',path.join(out,`${story.id}.mp4`),'-vf',`scale=-2:${height}`,...enc,path.join(out,file)]);qualities.push({height,src:`/demos/${file}`,bytes:(await fs.stat(path.join(out,file))).size});}
  const {draw,...data}=story;catalog.push({...data,href:`/blog-single/${story.contentId.split(':')[1]}`,seconds:24,width:1280,height:720,src:qualities[0].src,bytes:qualities[0].bytes,preview:`/demos/${story.id}-hover.mp4`,poster:`/demos/${story.id}.webp`,qualities,chapters:story.chapters.map((title,i)=>({seconds:i*6,title}))});console.log(`Rendered ${story.title}`);
}
await fs.writeFile(path.join(root,'src/lib/media/local-blog-demos.mjs'),'// Generated by scripts/render-tech-blog-demos.mjs.\nexport default '+JSON.stringify(catalog,null,2)+';\n');
