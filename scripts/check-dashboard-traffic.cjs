// Browser integration checks against local fixtures only; never connects to Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'myfailpro-traffic-'));
const browserPath = process.env.PED_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let role = 'agency';
let mode = 'normal';
let summaryRequests = 0;
let activityRequests = 0;
const summary = { total_logins: 12345, unique_users: 432, users_today: 28, users_last_7_days: 167,
  generated_at: '2026-11-15T16:30:00Z', timezone: 'Asia/Kuala_Lumpur' };
const allowed = new Set(['dashboard.html','assets/styles.css','assets/navigation.css','assets/dashboard-tables.css','assets/dashboard-traffic.css','assets/icons.css','assets/supabase-app.js','file.png','Gemini_Generated_Image_vvxauovvxauovvxa.jpeg',...fs.readdirSync(path.join(root,'assets/icons')).map(name=>'assets/icons/'+name)]);
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost');
  const file = url.pathname.slice(1);
  const json = (status, data) => { res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data)); };
  if (file==='assets/runtime-config.js') {
    res.setHeader('Content-Type','text/javascript');res.end(`globalThis.MYFAILPRO_CONFIG={url:'http://127.0.0.1:${server.address().port}',publishableKey:'preview'};`);return;
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table=url.pathname.split('/').pop();
    if(table==='login_traffic_summary') {
      assert.equal(req.method,'POST'); summaryRequests++;
      if(mode==='missing') { json(404,{message:'Could not find the function public.login_traffic_summary in the schema cache',code:'PGRST202'});return; }
      if(mode==='error') { json(503,{message:'Unavailable'});return; }
      const data=mode==='zero' ? {...summary,total_logins:0,unique_users:0,users_today:0,users_last_7_days:0}
        : mode==='invalid' ? {...summary,users_today:-1} : summary;
      setTimeout(()=>json(200,data),mode==='slow'?400:0);return;
    }
    if(table==='record_login_activity') { activityRequests++;json(200,{});return; }
    assert.equal(req.method,'GET','Dashboard must not write data');
    if(table==='profiles') { json(200,[{id:'preview-user',role,agency_id:role==='staff'?'preview-owner':null,name:'Akaun Pratonton',email:'preview@example.test',agency_type:'Pejabat'}]);return; }
    if(table==='agency_settings') { json(200,[{functions:[],activities:[],sub_activities:[],transactions:[],staff:[]}]);return; }
    json(200,[]);return;
  }
  if(!allowed.has(file)) { res.writeHead(404).end();return; }
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'image/png');
  res.end(fs.readFileSync(path.join(root,file)));
});
async function connect(url) {
  const ws=new WebSocket(url);const pending=new Map();const errors=[];let id=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
    if(!message.id)return;
    const task=pending.get(message.id);if(!task)return;
    pending.delete(message.id);clearTimeout(task.timer);
    message.error?task.reject(new Error(JSON.stringify(message.error))):task.resolve(message.result);
  });
  return {ws,errors,send(method,params={}) { return new Promise((resolve,reject)=>{
    const call=++id;const timer=setTimeout(()=>reject(new Error('CDP timeout: '+method)),15000);
    pending.set(call,{resolve,reject,timer});ws.send(JSON.stringify({id:call,method,params}));
  });}};
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const profile=path.join(output,'browser');
  browser=spawn(browserPath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','about:blank'],{windowsHide:true,stdio:'ignore'});
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;!fs.existsSync(portFile)&&i<150;i++)await wait(100);
  assert(fs.existsSync(portFile),'Browser debugging port unavailable');
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  const cdp=await connect(target.webSocketDebuggerUrl);
  const evaluate=async expression=>{
    const result=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;
  };
  const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await wait(50);}assert.fail('Timed out: '+expression);};
  const values=()=>evaluate(`Array.from(document.querySelectorAll('[data-traffic]')).map(n=>n.textContent)`);
  const ready=`document.querySelector('#loginTraffic')?.getAttribute('aria-busy')==='false' && document.body.classList.contains('auth-ready')`;
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
  await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'America/New_York'});
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem('myfailpro_supabase_session',JSON.stringify({access_token:'preview',user:{id:'preview-user'}}));`});
  const navigate=async()=>{await cdp.send('Page.navigate',{url:base+'/dashboard.html?test='+Math.random()});await until(ready);};
  for(role of ['admin','agency','staff']) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
    await navigate();
    assert.deepEqual(await values(),['12,345','432','28','167']);
    assert(await evaluate(`document.querySelector('#trafficUpdated').textContent.includes('16 Nov')`),'Timestamp must use Malaysia date even in another timezone');
    assert.equal(await evaluate(`document.querySelector('#trafficMessage').classList.contains('hidden')`),true);
  }
  // An unavailable or malformed response must not display a fabricated zero.
  for(mode of ['missing','error','invalid','zero']) {
    await navigate();
    assert.deepEqual(await values(),mode==='zero'?['0','0','0','0']:['—','—','—','—']);
    assert.equal(await evaluate(`document.querySelector('#emptyFiles').classList.contains('hidden')`),false,'File dashboard must remain usable');
  }
  mode='normal';await navigate();
  mode='error';await evaluate(`document.querySelector('#refreshTraffic').click()`);await until(ready);
  assert.deepEqual(await values(),['12,345','432','28','167']);
  assert(await evaluate(`document.querySelector('#trafficMessage').textContent.includes('Angka terakhir')`));
  mode='slow';const before=summaryRequests;
  await evaluate(`document.querySelector('#refreshTraffic').click();document.querySelector('#refreshTraffic').click()`);
  assert.equal(await evaluate(`document.querySelector('#refreshTraffic').disabled`),true);
  await until(ready);assert.equal(summaryRequests,before+1,'Duplicate refresh requests');
  mode='normal';
  for(const width of [1440,900,390,320]) {
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await navigate();
    await evaluate(`document.querySelector('#loginTraffic').scrollIntoView({block:'center',behavior:'instant'})`);
    await wait(400);
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),'Horizontal overflow at '+width);
    assert(await evaluate(`Array.from(document.querySelectorAll('.traffic-metric')).every(n=>n.scrollWidth<=n.clientWidth+1)`),'Clipped traffic metric at '+width);
    if(width===1440||width===390){const shot=await cdp.send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,`traffic-${width}.png`),Buffer.from(shot.data,'base64'));}
  }
  assert.equal(activityRequests,0,'Loading or refreshing dashboard must not add sign-ins');
  assert.equal(cdp.errors.length,0,cdp.errors.join('\n'));
  console.log('PASS: all roles, Malaysia timezone, zero/missing/error/invalid data, stale refresh, duplicate prevention, responsive layout, no extra sign-ins.');
  console.log('Screenshots: '+output);
  await cdp.send('Browser.close').catch(()=>{});cdp.ws.close();
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(browser)browser.kill();server.close();});
