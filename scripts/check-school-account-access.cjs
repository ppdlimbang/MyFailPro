// Local browser fixtures only; no production accounts or data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'myfailpro-school-access-'));
const browserPath=process.env.PED_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe';
let role='admin', agencyType='Pejabat', accountQueries=[], profileRequests=0, missingSchoolRpc=false, nameQueries=0;
const allowed=new Set(['tetapan.html','ped.html','assets/ped.css','assets/styles.css','assets/navigation.css','assets/icons.css','assets/supabase-app.js','file.png','Gemini_Generated_Image_vvxauovvxauovvxa.jpeg',...fs.readdirSync(path.join(root,'assets/icons')).map(n=>'assets/icons/'+n)]);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'), file=url.pathname.slice(1);
 const json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
 if(file==='assets/runtime-config.js'){res.setHeader('Content-Type','text/javascript');res.end('globalThis.MYFAILPRO_CONFIG={url:"http://127.0.0.1:'+server.address().port+'",publishableKey:"preview"};');return;}
 if(url.pathname.startsWith('/rest/v1/')){
  const table=url.pathname.split('/').pop();
  if(table==='can_access_ped'){json(true);return;}
  if(table==='ped_workspace_profile'){json({id:'office-owner',name:'Pejabat Ujian',agency_type:'Pejabat'});return;}
  if(table==='ped_assigned_schools'){
   if(missingSchoolRpc){res.statusCode=404;json({message:'Could not find the function public.ped_assigned_schools in the schema cache'});return;}
   json([{id:'school-1',name:'SK Ujian'}]);return;
  }
  assert.equal(req.method,'GET','Settings should not write on load or fetch staff workspace');
  if(table==='profiles'){
   if(url.searchParams.get('ped_office_id')==='eq.office-owner'&&url.searchParams.get('select')==='id,name'){
    nameQueries++;json([{id:'school-1',name:'SK Ujian'}]);return;
   }
   if(url.searchParams.get('agency_type')==='ilike.sekolah'){
    accountQueries.push(url.searchParams);
    json([{id:'school-1',name:'SK Ujian',email:'school@example.test',login_count:5}]);return;
   }
   if(url.searchParams.get('id')==='eq.preview-user'){
    profileRequests++;json([{id:'preview-user',role,agency_type:agencyType,agency_id:role==='staff'?'office-owner':null,name:'Pengguna Ujian',email:'user@example.test'}]);return;
   }
  }
  if(table==='agency_settings'){json([{functions:[],activities:[],sub_activities:[],transactions:[],staff:[]}]);return;}
  json([]);return;
 }
 if(!allowed.has(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'image/png');
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
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs',{urls:['https://*']});
  // Deliberately stale elevated cache: the server role must win on every load.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source: `sessionStorage.setItem('myfailpro_supabase_session',JSON.stringify({access_token:'preview',user:{id:'preview-user'}}));sessionStorage.setItem('myfailpro_profile',JSON.stringify({id:'preview-user',ownerId:'preview-user',role:'admin',data:{nama:'Old admin',jenis:'Pejabat'}}));`});
  for(const scenario of [['admin','Pejabat',true],['agency','Pejabat',true],['staff','Pejabat',false],['staff','Sekolah',false],['agency','Sekolah',false],['agency','Agensi',false]]){
   [role,agencyType]=scenario;
   for(const width of [1440,390]){
    accountQueries=[];profileRequests=0;
    await cdp.send('Emulation.setDeviceMetricsOverride',{width,height:1100,deviceScaleFactor:1,mobile:false});
    await cdp.send('Page.navigate',{url:base+'/tetapan.html?case='+role+agencyType+width});
    await until(`document.body.classList.contains('auth-ready')`);
    assert(profileRequests>0,'Must refresh role from server');
    const visible=await evaluate(`document.querySelector('#officeSchoolAccountsPanel').offsetParent!==null`);
    assert.equal(visible,scenario[2],role+' '+agencyType+' '+width);
    assert.equal(accountQueries.length,scenario[2]?1:0,'Unauthorized users must not fetch account details');
    assert.equal(await evaluate(`document.querySelectorAll('#officeSchoolAccountRows tr').length`),scenario[2]?1:0);
    if(scenario[2]){
     assert.equal(accountQueries[0].get('ped_office_id'),role==='admin'?null:'eq.preview-user');
     await evaluate(`document.querySelector('#officeSchoolAccountRows button').click()`);
     assert.equal(await evaluate(`document.querySelector('#officeSchoolAccountEditModal').classList.contains('hidden')`),false);
    }
   }
  }
  role='staff';agencyType='Pejabat';accountQueries=[];
  await cdp.send('Page.navigate',{url:base+'/ped.html?case=office-staff'});
  await until(`(document.querySelector('#pedViewTabSchools')?.click(), Boolean(document.querySelector('#pedSchoolGrid .ped-school-card')))`);
  assert.equal(await evaluate(`document.querySelector('#pedSchoolGrid .ped-school-card strong').textContent`),'SK Ujian');
  assert.equal(accountQueries.length,0,'PeD staff must use names-only RPC');
  assert.equal(await evaluate(`document.querySelector('[data-add-ped="school_in"]').disabled`),false,'Staff correspondence must remain enabled');
  missingSchoolRpc=true;
  await cdp.send('Page.navigate',{url:base+'/ped.html?case=before-migration'});
  await until(`(document.querySelector('#pedViewTabSchools')?.click(), Boolean(document.querySelector('#pedSchoolGrid .ped-school-card')))`);
  assert.equal(nameQueries,1,'Missing migration fallback must fetch names only');
  assert.equal(accountQueries.length,0);
  assert.deepEqual(cdp.errors,[]);
  console.log('PASS: 12 role/viewport cases; stale admin cache; no unauthorized account requests; agency scope; edit modal; staff PeD school directory.');
  await cdp.send('Browser.close').catch(()=>{});cdp.ws.close();
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(browser)browser.kill();server.close();});
