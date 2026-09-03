"use strict";

const KEYS={files:"sistemFail_senaraiFail",movements:"sistemFail_rekodPergerakan",settings:"sistemFail_tetapan",agencySettings:"sistemFail_tetapanAgensi",agencies:"sistemFail_agensi",user:"sistemFail_user"};
const defaults={fungsi:["400 Pengurusan Kewangan dan Perakaunan"],aktiviti:["400-1 Tadbir Urus Kewangan/Akaun"],subAktiviti:["400-1/1 Perwakilan Kewangan"],transaksi:["400-1/1/1"],pegawai:[{nama:"Ahmad Albab",sektor:"Unit Kewangan"}]};
const readJSON=(key,fallback)=>{try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{localStorage.removeItem(key);return fallback}};
const writeJSON=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const state={files:readJSON(KEYS.files,[]),movements:readJSON(KEYS.movements,[]),agencies:readJSON(KEYS.agencies,[]),settings:{...defaults,...readJSON(KEYS.settings,{})},agencySettings:readJSON(KEYS.agencySettings,{})};

function getUser(){try{return JSON.parse(sessionStorage.getItem(KEYS.user))}catch{return null}}
function saveAll(){writeJSON(KEYS.files,state.files);writeJSON(KEYS.movements,state.movements);writeJSON(KEYS.settings,state.settings);writeJSON(KEYS.agencySettings,state.agencySettings);writeJSON(KEYS.agencies,state.agencies)}
function cloneSettings(source){return{fungsi:[...(source.fungsi||[])],aktiviti:[...(source.aktiviti||[])],subAktiviti:[...(source.subAktiviti||[])],transaksi:[...(source.transaksi||[])],pegawai:(source.pegawai||[]).map(person=>({...person}))}}
function getActiveSettings(user=getUser()){
  if(!user||user.role==="admin")return state.settings;
  const key=user.email.toLowerCase();
  if(!state.agencySettings[key]){
    state.agencySettings[key]=cloneSettings(state.settings);
    writeJSON(KEYS.agencySettings,state.agencySettings);
  }
  return state.agencySettings[key];
}
function create(tag,options={},children=[]){const node=document.createElement(tag);Object.entries(options).forEach(([key,value])=>{if(key==="className")node.className=value;else if(key==="text")node.textContent=value;else if(key.startsWith("on")&&typeof value==="function")node.addEventListener(key.slice(2),value);else node.setAttribute(key,value)});(Array.isArray(children)?children:[children]).filter(Boolean).forEach(child=>node.append(child));return node}
function toast(title,message,type="success"){let region=document.querySelector(".toast-region");if(!region){region=create("div",{className:"toast-region","aria-live":"polite"});document.body.append(region)}const item=create("div",{className:`toast ${type}`},[create("strong",{text:title}),create("span",{text:message})]);region.append(item);setTimeout(()=>item.remove(),4200)}
function requireAuth(adminOnly=false){const user=getUser();if(!user||(adminOnly&&user.role!=="admin")){sessionStorage.removeItem(KEYS.user);location.replace("MyFailPro.html");return null}return user}
function initShell(adminOnly=false){const user=requireAuth(adminOnly);if(!user)return null;document.querySelectorAll("[data-admin]").forEach(el=>el.classList.toggle("hidden",user.role!=="admin"));const name=document.querySelector("[data-user-name]");const role=document.querySelector("[data-user-role]");if(name)name.textContent=user.role==="admin"?"Pentadbir":user.data?.nama||"Agensi";if(role)role.textContent=user.role==="admin"?"Admin PPD":user.data?.jenis||"Pengguna";const date=document.querySelector("[data-current-date]");if(date)date.textContent=new Intl.DateTimeFormat("ms-MY",{dateStyle:"full"}).format(new Date());document.querySelectorAll("[data-logout]").forEach(button=>button.addEventListener("click",()=>{sessionStorage.removeItem(KEYS.user);location.replace("MyFailPro.html")}));return user}
function fillSelect(select,values,prompt="Pilih parameter…"){select.replaceChildren(create("option",{value:"",text:prompt}));values.forEach(value=>select.append(create("option",{value,text:value})))}
function formatDate(value,withTime=false){if(!value)return"–";const date=new Date(value.length===10?`${value}T00:00:00`:value);if(Number.isNaN(date.getTime()))return"–";return new Intl.DateTimeFormat("ms-MY",withTime?{dateStyle:"medium",timeStyle:"short"}:{dateStyle:"medium"}).format(date)}
const validDateRange=(start,end)=>!start||!end||end>=start;

function initLogin(){if(getUser()){location.replace("dashboard.html");return}document.querySelector("#formLogin").addEventListener("submit",event=>{event.preventDefault();const email=document.querySelector("#loginEmail").value.trim().toLowerCase();const password=document.querySelector("#loginPassword").value;let user=null;if(email==="admin@moe.gov.my"&&["ppdlimbang","ppdl@y050"].includes(password))user={email,role:"admin"};else{const agency=state.agencies.find(item=>item.emel.toLowerCase()===email);if(agency&&password===(agency.password||"agensi123"))user={email,role:"agensi",data:agency}}if(!user){toast("Log masuk gagal","Emel atau katalaluan salah.","error");return}sessionStorage.setItem(KEYS.user,JSON.stringify(user));location.assign("dashboard.html")})}

function initDashboard(){
  if(!initShell())return;
  const settings=getActiveSettings();
  const body=document.querySelector("#fileRows");
  const search=document.querySelector("#searchFile");
  const filter=document.querySelector("#filterFungsi");
  fillSelect(filter,settings.fungsi,"Semua fungsi");
  const updateStats=()=>{
    document.querySelector("#statTotal").textContent=state.files.length;
    document.querySelector("#statArchive").textContent=state.files.filter(f=>(f.pemegangTerkini||f.status)==="Bilik Fail").length;
    document.querySelector("#statMoving").textContent=state.files.filter(f=>(f.pemegangTerkini||f.status)!=="Bilik Fail").length;
  };
  const render=()=>{
    updateStats();
    const term=search.value.trim().toLowerCase();
    const selected=filter.value;
    const files=state.files.filter(file=>{
      const haystack=[file.transaksi,file.noFail,file.subAktiviti,file.pemegangTerkini].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(term)&&(!selected||file.fungsi===selected);
    }).sort((a,b)=>String(a.transaksi||a.noFail||"").localeCompare(String(b.transaksi||b.noFail||""),undefined,{numeric:true}));
    body.replaceChildren();
    document.querySelector("#emptyFiles").classList.toggle("hidden",files.length>0);
    files.forEach(file=>{
      const holder=file.pemegangTerkini||"Bilik Fail";
      const archive=holder.toLowerCase()==="bilik fail";
      const buttons=create("div",{className:"actions"},[
        create("button",{className:"button small",type:"button",text:"Pindah",onclick:()=>openMovement(file,render)}),
        create("button",{className:"button secondary small",type:"button",text:"Edit",onclick:()=>openEdit(file,render)}),
        create("button",{className:"button secondary small",type:"button",text:"Log",onclick:()=>openHistory(file)})
      ]);
      body.append(create("tr",{},[
        create("td",{},[create("div",{className:"record-title",text:file.transaksi||file.noFail||"Tiada nombor"}),create("div",{className:"record-meta",text:`Jilid ${file.jilid||1} · ${file.subAktiviti||"Tiada tajuk"}`})]),
        create("td",{text:`${formatDate(file.tarikhBuka||file.tarikhDaftar)} — ${file.tarikhTutup?formatDate(file.tarikhTutup):"Aktif"}`}),
        create("td",{},create("span",{className:`badge ${archive?"archive":"moving"}`,text:holder})),create("td",{},buttons)
      ]));
    });
  };
  search.addEventListener("input",render);filter.addEventListener("change",render);render();
}

function showModal(id){document.querySelector(id).classList.remove("hidden");document.body.style.overflow="hidden"}
function closeModal(modal){modal.classList.add("hidden");document.body.style.overflow=""}
function wireModal(modal){modal.querySelectorAll("[data-close]").forEach(el=>el.addEventListener("click",()=>closeModal(modal)));modal.addEventListener("click",event=>{if(event.target===modal)closeModal(modal)})}
function openMovement(file,refresh){const modal=document.querySelector("#movementModal");const settings=getActiveSettings();modal.querySelector("[data-file-reference]").textContent=`${file.transaksi||file.noFail} (Jilid ${file.jilid||1})`;const recipient=modal.querySelector("#recipient");fillSelect(recipient,[...new Set(["Bilik Fail",...settings.pegawai.map(p=>p.nama),...state.agencies.map(a=>a.nama)])],"Pilih keberadaan…");recipient.value=file.pemegangTerkini||"Bilik Fail";modal.querySelector("#movementDate").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);modal.querySelector("#movementNote").value="";modal.onsubmit=event=>{event.preventDefault();const to=recipient.value;const date=modal.querySelector("#movementDate").value;const note=modal.querySelector("#movementNote").value.trim();if(!to||!date)return;const from=file.pemegangTerkini||"Bilik Fail";if(from===to&&!note){toast("Tiada perubahan","Pilih penerima baharu atau masukkan catatan.","error");return}file.pemegangTerkini=to;file.status=to==="Bilik Fail"?"Bilik Fail":"Sedang Beredar";state.movements.push({idFail:file.id,tarikh:date,dari:from,kepada:to,catatan:note});saveAll();closeModal(modal);refresh();toast("Berjaya",`Fail kini bersama ${to}.`)};showModal("#movementModal");recipient.focus()}
function openEdit(file,refresh){const modal=document.querySelector("#editModal");modal.querySelector("[data-file-reference]").textContent=`${file.transaksi||file.noFail} (Jilid ${file.jilid||1})`;const start=modal.querySelector("#editOpenDate");const end=modal.querySelector("#editCloseDate");start.value=file.tarikhBuka||"";end.value=file.tarikhTutup||"";modal.onsubmit=event=>{event.preventDefault();if(!validDateRange(start.value,end.value)){toast("Tarikh tidak sah","Tarikh tutup tidak boleh mendahului tarikh buka.","error");return}file.tarikhBuka=start.value;file.tarikhTutup=end.value;saveAll();closeModal(modal);refresh();toast("Berjaya","Tarikh fail dikemaskini.")};showModal("#editModal");start.focus()}
function openHistory(file){const modal=document.querySelector("#historyModal");const list=modal.querySelector("#historyList");list.replaceChildren();modal.querySelector("[data-file-reference]").textContent=`${file.transaksi||file.noFail} (Jilid ${file.jilid||1})`;const records=state.movements.filter(item=>item.idFail===file.id).sort((a,b)=>new Date(b.tarikh)-new Date(a.tarikh));if(!records.length)list.append(create("li",{text:"Tiada rekod pergerakan."}));records.forEach(record=>list.append(create("li",{},[create("strong",{text:`${record.dari} → ${record.kepada}`}),record.catatan?create("div",{text:record.catatan}):null,create("time",{text:formatDate(record.tarikh,true)})])));showModal("#historyModal")}

function initRegister(){
  const user=initShell();
  if(!user)return;
  const settings=getActiveSettings(user);
  const form=document.querySelector("#registerFile");
  const ids=["fungsi","aktiviti","subAktiviti","transaksi"];
  ids.forEach(id=>fillSelect(form.elements[id],settings[id]||[]));
  form.elements.fungsi.addEventListener("change",()=>fillSelect(form.elements.aktiviti,settings.aktiviti.filter(v=>v.startsWith(form.elements.fungsi.value.split(" ")[0]))));
  form.elements.aktiviti.addEventListener("change",()=>fillSelect(form.elements.subAktiviti,settings.subAktiviti.filter(v=>v.startsWith(form.elements.aktiviti.value.split(" ")[0]))));
  form.elements.subAktiviti.addEventListener("change",()=>fillSelect(form.elements.transaksi,settings.transaksi.filter(v=>v.startsWith(form.elements.subAktiviti.value.split(" ")[0]))));
  form.addEventListener("reset",()=>setTimeout(()=>{ids.forEach(id=>fillSelect(form.elements[id],id==="fungsi"?settings.fungsi:[]));form.elements.jilid.value=1},0));
  form.addEventListener("submit",event=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    if(!validDateRange(data.tarikhBuka,data.tarikhTutup)){toast("Tarikh tidak sah","Tarikh tutup tidak boleh mendahului tarikh buka.","error");return}
    if(state.files.some(f=>(f.transaksi||f.noFail)===data.transaksi&&Number(f.jilid||1)===Number(data.jilid))){toast("Rekod telah wujud",`Fail ${data.transaksi}, Jilid ${data.jilid} telah didaftarkan.`,"error");return}
    const id=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const file={...data,id,jilid:Number(data.jilid),tarikhDaftar:new Date().toISOString(),status:"Bilik Fail",pemegangTerkini:"Bilik Fail",didaftarOleh:user.email};
    state.files.push(file);state.movements.push({idFail:id,tarikh:file.tarikhDaftar,dari:"Sistem Pendaftaran",kepada:"Bilik Fail",catatan:"Rekod asal dicipta"});saveAll();form.reset();toast("Pendaftaran berjaya","Fail baharu telah disimpan.");
  });
}

const labels={fungsi:"Fungsi",aktiviti:"Aktiviti",subAktiviti:"Sub-Aktiviti",transaksi:"Transaksi Fail"};
function initSettings(){
  const user=initShell();
  if(!user)return;
  const settings=getActiveSettings(user);
  const isAgency=user.role==="agensi";
  if(isAgency){
    document.querySelector("#settingsTitle").textContent="Tetapan Agensi";
    document.querySelector("#settingsSubtitle").textContent=`Konfigurasi khusus untuk ${user.data?.nama||user.email}`;
    document.querySelector("#settingsScope").textContent="Semua perubahan di halaman ini hanya digunakan oleh agensi anda dan tidak mengubah tetapan agensi lain.";
  }else{
    document.querySelector("#settingsScope").textContent="Tetapan global pentadbir digunakan sebagai asas apabila agensi baharu membuka halaman Tetapan buat kali pertama.";
  }
  const grid=document.querySelector("#settingsGrid");
  const render=()=>{
    grid.replaceChildren();
    Object.keys(labels).forEach(category=>{
      const input=create("input",{className:"input",placeholder:"Tambah pilihan…","aria-label":`Tambah ${labels[category]}`});
      const add=create("button",{className:"button",type:"submit",text:"Tambah"});
      const form=create("form",{className:"inline-form"},[input,add]);
      form.addEventListener("submit",event=>{
        event.preventDefault();
        const value=input.value.trim();
        if(!value||settings[category].includes(value))return;
        settings[category].push(value);saveAll();render();
      });
      const list=create("ul",{className:"item-list"});
      settings[category].forEach((value,index)=>{
        const remove=create("button",{type:"button",text:"Padam","aria-label":`Padam ${value}`,onclick:()=>{
          settings[category].splice(index,1);saveAll();render();
        }});
        list.append(create("li",{className:"item"},[create("span",{text:value}),remove]));
      });
      grid.append(create("section",{className:"panel panel-body"},[create("h2",{text:labels[category]}),form,list]));
    });
  };
  const staffForm=document.querySelector("#staffForm");
  const staffList=document.querySelector("#staffList");
  const renderStaff=()=>{
    staffList.replaceChildren();
    settings.pegawai.forEach((person,index)=>{
      const remove=create("button",{type:"button",text:"Padam",onclick:()=>{
        settings.pegawai.splice(index,1);saveAll();renderStaff();
      }});
      staffList.append(create("li",{className:"item"},[create("span",{text:`${person.nama} — ${person.sektor}`}),remove]));
    });
  };
  staffForm.addEventListener("submit",event=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(staffForm));
    settings.pegawai.push({nama:data.nama.trim(),sektor:data.sektor.trim()});
    saveAll();staffForm.reset();renderStaff();
  });
  render();renderStaff();
}

function initAdmin(){
  if(!initShell(true))return;
  const form=document.querySelector("#agencyForm");
  const body=document.querySelector("#agencyRows");
  const render=()=>{
    body.replaceChildren();
    state.agencies.forEach((agency,index)=>{
      const remove=create("button",{className:"button danger small",type:"button",text:"Padam",onclick:()=>{
        if(confirm(`Padam ${agency.nama}?`)){
          delete state.agencySettings[agency.emel.toLowerCase()];
          state.agencies.splice(index,1);saveAll();render();
        }
      }});
      body.append(create("tr",{},[
        create("td",{text:agency.emel}),create("td",{text:agency.jenis}),create("td",{text:agency.nama}),
        create("td",{text:"••••••••"}),create("td",{},remove)
      ]));
    });
  };
  form.addEventListener("submit",event=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    data.emel=data.emel.trim().toLowerCase();data.nama=data.nama.trim();
    if(state.agencies.some(a=>a.emel.toLowerCase()===data.emel)){toast("Emel telah digunakan","Gunakan emel agensi yang lain.","error");return}
    state.agencies.push(data);saveAll();form.reset();render();toast("Berjaya","Pengguna agensi telah ditambah.");
  });
  render();
}

document.addEventListener("DOMContentLoaded",()=>{document.querySelectorAll(".modal").forEach(wireModal);const page=document.body.dataset.page;({login:initLogin,dashboard:initDashboard,register:initRegister,settings:initSettings,admin:initAdmin}[page]||(()=>{}))()});
