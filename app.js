import { createClient } from '@supabase/supabase-js';

const $=s=>document.querySelector(s);
const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10);
const today=()=>iso(new Date());
const ST={pending:'Pending',progress:'In Progress',done:'Completed'};
let tasks=[],goals=[],projects=[],currentUser=null,dataReady=false,loadingUserId='',authGeneration=0;
let page='dashboard',editId=null,editProjectId=null,selectedProjectId='',flt={q:'',status:'',cat:''};
const supabaseUrl=import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey=(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim();
const supabase=supabaseUrl&&supabaseKey?createClient(supabaseUrl,supabaseKey):null;
const vapidPublicKey=import.meta.env.VITE_SUPABASE_VAPID_PUBLIC_KEY?.trim();
const writeQueues={tasks:Promise.resolve(),goals:Promise.resolve(),projects:Promise.resolve()};
let remindersEnabled=false,reminderBusy=false;
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pct=(a,b)=>b?Math.round(a/b*100):0;
let toastTimer;
function notify(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),5000)}
function pushSupported(){return 'serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window}
function decodeVapidKey(key){const base64=key.replace(/-/g,'+').replace(/_/g,'/'),raw=atob(base64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes}
async function refreshReminderStatus(){
  remindersEnabled=false;
  if(!pushSupported()||!currentUser)return;
  const registration=await navigator.serviceWorker.getRegistration('/');
  const subscription=await registration?.pushManager.getSubscription();
  if(!subscription)return;
  const {data,error}=await supabase.from('push_subscriptions').select('endpoint').eq('user_id',currentUser.id).eq('endpoint',subscription.endpoint).maybeSingle();
  if(error)throw error;
  remindersEnabled=Boolean(data);
}
async function toggleReminders(){
  if(reminderBusy)return;
  if(!supabase||!currentUser){notify('Sign in to manage your reminders.');return}
  if(!pushSupported()){notify('Push reminders are not supported in this browser.');return}
  if(!vapidPublicKey){notify('Add VITE_SUPABASE_VAPID_PUBLIC_KEY to your Vercel environment variables and redeploy.');return}
  reminderBusy=true;
  const button=$('#reminder-toggle');if(button)button.disabled=true;
  try{
    const registration=await navigator.serviceWorker.register('/sw.js');
    let subscription=await registration.pushManager.getSubscription();
    if(remindersEnabled){
      if(subscription){const {error}=await supabase.from('push_subscriptions').delete().eq('user_id',currentUser.id).eq('endpoint',subscription.endpoint);if(error)throw error;
        remindersEnabled=false;const unsubscribed=await subscription.unsubscribe();if(!unsubscribed)throw new Error('The browser could not remove this push subscription.')}
      else remindersEnabled=false;
      notify('Hourly reminders are off for this browser.')
    }else{
      const permission=Notification.permission==='granted'? 'granted':await Notification.requestPermission();
      if(permission!=='granted')throw new Error(permission==='denied'?'Notifications are blocked in browser settings. Allow them for GoalFlow, then try again.':'Notification permission was not granted.');
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapidKey(vapidPublicKey)});
      const {error}=await supabase.from('push_subscriptions').upsert({user_id:currentUser.id,endpoint:subscription.endpoint,subscription:subscription.toJSON(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone},{onConflict:'endpoint'});
      if(error)throw error;
      remindersEnabled=true;notify('Hourly reminders enabled. They arrive from 8am to 10pm when tasks remain incomplete.')
    }
  }catch(error){console.error('GoalFlow reminder setup failed:',error);notify(error.message||'Could not update push reminders. Check browser permissions and Supabase setup.')}
  finally{reminderBusy=false;render()}
}
function showAuthMessage(message,isError=false){const el=$('#auth-message');el.textContent=message;el.classList.toggle('error',isError)}
function queueWrite(table,operation){
  const next=writeQueues[table].then(operation);
  writeQueues[table]=next.catch(error=>{console.error(`GoalFlow ${table} database operation failed:`,error);notify(`Could not save ${table}. ${error.message||'Check your connection and Supabase setup.'}`)});
  return next.then(()=>true).catch(()=>false)
}
function save(){if(!currentUser||!dataReady)return Promise.resolve(false);const userId=currentUser.id,snapshot=tasks.map(data=>({...data}));return queueWrite('tasks',async()=>{const records=snapshot.map(data=>({id:data.id,user_id:userId,data}));
  if(records.length){const {error}=await supabase.from('tasks').upsert(records);if(error)throw error}})}
function saveGoals(){if(!currentUser||!dataReady)return Promise.resolve(false);const userId=currentUser.id,snapshot=goals.map(data=>({...data}));return queueWrite('goals',async()=>{const records=snapshot.map(data=>({id:data.id,user_id:userId,data}));
  if(records.length){const {error}=await supabase.from('goals').upsert(records);if(error)throw error}})}
function saveProjects(){if(!currentUser||!dataReady)return Promise.resolve(false);const userId=currentUser.id,snapshot=projects.map(data=>({...data}));return queueWrite('projects',async()=>{const records=snapshot.map(data=>({id:data.id,user_id:userId,data}));
  if(records.length){const {error}=await supabase.from('projects').upsert(records);if(error)throw error}})}
function removeRecord(table,id){const userId=currentUser.id;return queueWrite(table,async()=>{const {error}=await supabase.from(table).delete().eq('id',id).eq('user_id',userId);if(error)throw error})}
function replaceCollection(table,items){const userId=currentUser.id,snapshot=items.map(data=>({...data}));return queueWrite(table,async()=>{const {error:deleteError}=await supabase.from(table).delete().eq('user_id',userId);if(deleteError)throw deleteError;
  const records=snapshot.map(data=>({id:data.id,user_id:userId,data}));if(records.length){const {error}=await supabase.from(table).upsert(records);if(error)throw error}})}

// theme
document.documentElement.dataset.theme=localStorage.getItem('gf_theme')||'dark';
function setTheme(t){document.documentElement.dataset.theme=t;localStorage.setItem('gf_theme',t)}
$('#theme').onclick=()=>{setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark')};

let authMode='signin';
function setAuthMode(mode){authMode=mode;const signup=mode==='signup';
  $('#auth-title').textContent=signup?'Create your account.':'Welcome back.';
  $('#auth-copy').textContent=signup?'Your goals, safely synced across your devices.':'Sign in to continue where your goals left off.';
  $('#auth-form button[type="submit"]').textContent=signup?'Create account':'Sign in';
  $('#auth-switch').textContent=signup?'Already have an account? Sign in':'New to GoalFlow? Create an account';
  $('#reset-password').hidden=signup;showAuthMessage('')}
$('#auth-switch').onclick=()=>setAuthMode(authMode==='signin'?'signup':'signin');
$('#auth-form').onsubmit=async e=>{e.preventDefault();if(!supabase){showAuthMessage('Add your Supabase URL and publishable/anon key to the Vercel environment variables first.',true);return}
  const form=new FormData(e.currentTarget),email=String(form.get('email')).trim(),password=String(form.get('password'));
  const button=$('#auth-form button[type="submit"]');button.disabled=true;showAuthMessage(authMode==='signup'?'Creating your account…':'Signing you in…');
  try{const result=authMode==='signup'?await supabase.auth.signUp({email,password}):await supabase.auth.signInWithPassword({email,password});
    if(result.error)throw result.error;
    if(authMode==='signup'&&!result.data.session)showAuthMessage('Account created. Check your email to confirm the account, then sign in.');
    else showAuthMessage(authMode==='signup'?'Account created. Loading your workspace…':'Signing in…');
  }catch(error){showAuthMessage(error.message||'Authentication failed. Please try again.',true)}
  finally{button.disabled=false}};
$('#reset-password').onclick=async()=>{if(!supabase){showAuthMessage('Supabase is not configured yet.',true);return}
  const email=$('#auth-form').elements.email.value.trim();if(!email){showAuthMessage('Enter your email address first.',true);$('#auth-form').elements.email.focus();return}
  try{const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin});if(error)throw error;
    showAuthMessage('If an account exists for this email, a password reset link has been sent.')}
  catch(error){showAuthMessage(error.message||'Could not send the reset email.',true)}};
async function loadUserData(user){
  const tables=['tasks','goals','projects'];
  const responses=await Promise.all(tables.map(table=>supabase.from(table).select('data').eq('user_id',user.id)));
  const failure=responses.find(result=>result.error);if(failure)throw failure.error;
  tasks=responses[0].data.map(row=>row.data);goals=responses[1].data.map(row=>row.data);projects=responses[2].data.map(row=>row.data);
  const legacy={tasks:readLegacy('gf_tasks'),goals:readLegacy('gf_goals'),projects:readLegacy('gf_projects')};
  const hasLegacy=Object.values(legacy).some(items=>items.length),isCloudEmpty=tasks.length+goals.length+projects.length===0;
  dataReady=true;
  if(hasLegacy&&isCloudEmpty&&confirm('Existing GoalFlow data was found in this browser. Copy it to your signed-in Supabase account?')){
    tasks=legacy.tasks;goals=legacy.goals;projects=legacy.projects;
    const results=await Promise.all([save(),saveGoals(),saveProjects()]);
    if(results.some(result=>!result))throw new Error('Some existing browser data could not be copied. Check the database error and try again.');
    notify('Your existing GoalFlow data has been copied to Supabase.')
  }
}
function readLegacy(key){const raw=localStorage.getItem(key);if(!raw)return[];
  try{const value=JSON.parse(raw);if(!Array.isArray(value))throw new Error('Expected a list of records.');return value}
  catch(error){notify(`Could not read existing browser data (${key}): ${error.message}`);return[]}}
async function handleSession(session){
  if(!session){authGeneration++;currentUser=null;dataReady=false;tasks=[];goals=[];projects=[];$('#app-shell').hidden=true;$('#auth-screen').hidden=false;
    loadingUserId='';$('#auth-form').hidden=false;$('#auth-switch').hidden=!supabase;$('#reset-password').hidden=!supabase||authMode==='signup';$('#auth-retry').hidden=true;showAuthMessage('');return}
  if(currentUser?.id===session.user.id&&dataReady)return;
  if(loadingUserId===session.user.id)return;
  const generation=++authGeneration;loadingUserId=session.user.id;
  currentUser=session.user;dataReady=false;$('#app-shell').hidden=true;$('#auth-screen').hidden=false;$('#auth-form').hidden=true;$('#auth-switch').hidden=true;$('#reset-password').hidden=true;$('#auth-retry').hidden=true;showAuthMessage('Loading your private workspace…');
  try{await loadUserData(session.user);if(generation!==authGeneration)return;loadingUserId='';$('#user-email').textContent=session.user.email||'Signed in';$('#auth-screen').hidden=true;$('#app-shell').hidden=false;render()}
  catch(error){if(generation!==authGeneration)return;loadingUserId='';console.error('GoalFlow could not load cloud data:',error);showAuthMessage(`Could not load your cloud data. ${error.message||'Check your Supabase tables and internet connection.'}`,true);$('#auth-retry').hidden=false}
}
$('#logout').onclick=async()=>{await Promise.all(Object.values(writeQueues));const {error}=await supabase.auth.signOut();if(error)notify(`Could not sign out. ${error.message}`)};
$('#auth-retry').onclick=async()=>{const {data,error}=await supabase.auth.getSession();if(error)showAuthMessage(error.message,true);else await handleSession(data.session)};
if(!supabase){$('#auth-screen').hidden=false;showAuthMessage('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local for development and to Vercel Environment Variables for deployment.',true);$('#auth-form button[type="submit"]').disabled=true;$('#auth-switch').hidden=true;$('#reset-password').hidden=true}
else{
  supabase.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>handleSession(session),0)});
  supabase.auth.getSession().then(({data,error})=>{if(error)showAuthMessage(error.message,true);else handleSession(data.session)}).catch(error=>showAuthMessage(error.message||'Could not check your sign-in session.',true))
}

// nav
async function navigate(p){page=p;document.querySelectorAll('#nav button,[data-p="settings"]').forEach(b=>b.classList.toggle('on',b.dataset.p===p||(p==='project-detail'&&b.dataset.p==='projects')));
  if(p==='settings')try{await refreshReminderStatus()}catch(error){console.error('GoalFlow could not load reminder status:',error);notify(`Could not load reminder settings. ${error.message||'Check the push_subscriptions table.'}`)}
  render()}
$('#nav').onclick=e=>{const b=e.target.closest('button[data-p]');if(b)navigate(b.dataset.p)};
document.querySelector('[data-p="settings"]').onclick=()=>navigate('settings');

// task actions
function setStatus(id,s){const t=tasks.find(x=>x.id===id);if(!t)return;t.status=s;t.completedAt=s==='done'?(t.completedAt||today()):null;save();render()}
async function del(id){if(!confirm('Delete this task?'))return;const ok=await removeRecord('tasks',id);if(!ok)return;tasks=tasks.filter(x=>x.id!==id);render()}
function resched(id){const t=tasks.find(x=>x.id===id);const d=new Date(t.date);d.setDate(d.getDate()+(t.type==='weekly'?7:1));t.date=iso(d);t.rescheduled=(t.rescheduled||0)+1;save();render()}

// form
function openForm(id,goalId='',projectId=''){editId=id||null;const f=$('#form');f.reset();$('#dtitle').textContent=id?'Edit task':'New task';
  const t=id?tasks.find(x=>x.id===id):{date:today(),goalId,projectId};fillGoalOptions(t.goalId||goalId);fillProjectOptions(t.projectId||projectId);
  for(const k in t)if(f.elements[k]&&typeof t[k]!=='object')f.elements[k].value=t[k]??'';
  if(!id&&goalId)f.elements.goalId.value=goalId;$('#dlg').showModal()}
$('#add').onclick=()=>openForm();$('#cancel').onclick=()=>$('#dlg').close();
$('#form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData($('#form')));
  if(editId){const t=tasks.find(x=>x.id===editId);if(!t)return;Object.assign(t,d);t.completedAt=d.status==='done'?(t.completedAt||today()):null}
  else tasks.push({...d,id:Date.now()+'-'+Math.random().toString(36).slice(2),completedAt:d.status==='done'?today():null,created:today()});
  if(await save()){$('#dlg').close();render()}};
function fillProjectOptions(preferred=''){const select=$('#form').elements.projectId;
  select.innerHTML='<option value="">No project</option>'+projects.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if([...select.options].some(o=>o.value===preferred))select.value=preferred}
function fillGoalOptions(preferred=''){const select=$('#form').elements.goalId,selected=preferred||select.value,current=weekDates()[0];
  const options=goals.filter(g=>g.weekStart===current||g.id===selected);
  select.innerHTML='<option value="">No weekly goal</option>'+options.map(g=>`<option value="${esc(g.id)}">${esc(g.title)}${g.weekStart!==current?' (another week)':''}</option>`).join('');
  if([...select.options].some(o=>o.value===selected))select.value=selected}

let editGoalId=null;
function openGoalForm(id){editGoalId=id||null;const f=$('#goal-form');f.reset();$('#goal-dtitle').textContent=id?'Edit weekly goal':'New weekly goal';
  const g=id?goals.find(x=>x.id===id):{weekStart:weekDates()[0]};for(const k in g)if(f.elements[k])f.elements[k].value=g[k]??'';
  $('#goal-dlg').showModal()}
async function deleteGoal(id){if(!confirm('Delete this weekly goal? Its tasks will be kept without a goal.'))return;
  if(!await removeRecord('goals',id))return;goals=goals.filter(g=>g.id!==id);tasks.forEach(t=>{if(t.goalId===id)t.goalId=''});
  await save();render()}
$('#goal-cancel').onclick=()=>$('#goal-dlg').close();
$('#goal-form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData($('#goal-form')));
  if(editGoalId){const g=goals.find(x=>x.id===editGoalId);if(!g)return;Object.assign(g,d)}
  else goals.push({...d,id:Date.now()+'-'+Math.random().toString(36).slice(2),created:today()});
  if(await saveGoals()){$('#goal-dlg').close();render()}};

function openProjectForm(id){editProjectId=id||null;const f=$('#project-form');f.reset();$('#project-dtitle').textContent=id?'Edit project':'New project';
  const p=id?projects.find(x=>x.id===id):{color:'violet'};for(const k in p)if(f.elements[k])f.elements[k].value=p[k]??'';
  $('#project-dlg').showModal()}
async function deleteProject(id){if(!confirm('Delete this project? Its tasks will stay in your workspace without a project.'))return;
  if(!await removeRecord('projects',id))return;projects=projects.filter(p=>p.id!==id);tasks.forEach(t=>{if(t.projectId===id)t.projectId=''});
  await save();navigate('projects')}
function openProject(id){selectedProjectId=id;navigate('project-detail')}
$('#project-cancel').onclick=()=>$('#project-dlg').close();
$('#project-form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData($('#project-form')));
  if(editProjectId){const p=projects.find(x=>x.id===editProjectId);if(!p)return;Object.assign(p,d)}
  else projects.push({...d,id:Date.now()+'-'+Math.random().toString(36).slice(2),created:today()});
  if(await saveProjects()){$('#project-dlg').close();render()}};

function exportData(){const data={format:'goalflow-backup',version:1,exportedAt:new Date().toISOString(),tasks,goals,projects};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`goalflow-backup-${today()}.json`;a.click();URL.revokeObjectURL(url)}
function importData(file){const reader=new FileReader();reader.onerror=()=>notify('Could not read the selected backup file.');
  reader.onload=async()=>{try{const data=JSON.parse(String(reader.result));
    if(data.format!=='goalflow-backup'||![data.tasks,data.goals,data.projects].every(Array.isArray)
      ||![...data.tasks,...data.goals,...data.projects].every(record=>record&&typeof record.id==='string'))
      throw new Error('This is not a valid GoalFlow backup.');
    if(!confirm('Import this backup and replace the current tasks, goals and projects in your Supabase account?'))return;
    const results=await Promise.all([replaceCollection('tasks',data.tasks),replaceCollection('goals',data.goals),replaceCollection('projects',data.projects)]);
    if(results.some(result=>!result))throw new Error('The backup could not be fully saved. Check the database error and retry.');
    tasks=data.tasks;goals=data.goals;projects=data.projects;render();notify('Backup imported successfully.')
  }catch(error){notify(error instanceof Error?error.message:'The backup file could not be imported.')}};reader.readAsText(file)}
$('#import-file').onchange=e=>{const file=e.target.files[0];if(file)importData(file);e.target.value=''};

// pieces
function row(t){const late=t.status!=='done'&&t.date<today(),goal=goals.find(g=>g.id===t.goalId),project=projects.find(p=>p.id===t.projectId);
  return `<div class="task ${t.status==='done'?'done':''}"><input type="checkbox" aria-label="Complete" ${t.status==='done'?'checked':''} onchange="setStatus('${t.id}',this.checked?'done':'pending')">
  <div class="t"><b>${esc(t.title)}</b><small>${esc(t.cat)} · ${t.type} · ${t.date}${goal?' · '+esc(goal.title):''}${project?' · '+esc(project.name):''}${t.est?' · '+t.est+' min':''}${late?' · overdue':''}</small></div>
  <span class="tag ${t.priority}">${t.priority}</span><span class="tag ${t.status}">${ST[t.status]}</span>
  ${t.status!=='done'?`<button class="ghost small" onclick="resched('${t.id}')">Reschedule</button>`:''}
  <button class="ghost small" onclick="openForm('${t.id}')">Edit</button><button class="ghost small" onclick="del('${t.id}')">Delete</button></div>`}
const list=a=>a.length?a.map(row).join(''):'<div class="empty">No tasks here yet. Use “+ Add task” to create one.</div>';
function weekDates(){const n=new Date(),m=new Date(n);m.setDate(n.getDate()-((n.getDay()+6)%7));return [...Array(7)].map((_,i)=>{const d=new Date(m);d.setDate(m.getDate()+i);return iso(d)})}
function streak(){let s=0;const d=new Date();for(;;){const k=iso(d);if(tasks.some(t=>t.completedAt===k))s++;else if(k!==today())break;d.setDate(d.getDate()-1)}return s}
function goalStats(goal){const linked=tasks.filter(t=>t.goalId===goal.id),done=linked.filter(t=>t.status==='done').length;
  return{total:linked.length,done,pct:pct(done,linked.length)}}
function weeklyProgress(){const start=weekDates()[0],currentGoals=goals.filter(g=>g.weekStart===start);
  const linkedIds=new Set(currentGoals.map(g=>g.id)),linked=tasks.filter(t=>linkedIds.has(t.goalId)),unlinked=tasks.filter(t=>t.type==='weekly'&&weekDates().includes(t.date)&&!linkedIds.has(t.goalId));
  const emptyGoals=currentGoals.filter(g=>!linked.some(t=>t.goalId===g.id)).length,total=linked.length+unlinked.length+emptyGoals;
  const done=linked.filter(t=>t.status==='done').length+unlinked.filter(t=>t.status==='done').length;
  return{done,total,pct:pct(done,total)}}

// views
const V={
dashboard(){const td=tasks.filter(t=>t.date===today()),dn=td.filter(t=>t.status==='done').length,wp=weeklyProgress();
  return `<div class="grid">
  <div class="card"><h3>Today's tasks</h3><div class="big">${td.length}</div>planned</div>
  <div class="card"><h3>Completed</h3><div class="big">${dn}/${td.length}</div>${td.length-dn} remaining</div>
  <div class="card"><h3>Daily progress</h3><div class="big">${pct(dn,td.length)}%</div><div class="bar"><i style="width:${pct(dn,td.length)}%"></i></div></div>
  <div class="card"><h3>Weekly progress</h3><div class="big">${wp.pct}%</div>${wp.done}/${wp.total} steps completed<div class="bar"><i style="width:${wp.pct}%"></i></div></div>
  <div class="card"><h3>Streak</h3><div class="big">${streak()}</div>days in a row</div></div>
  <h3>Today's focus</h3>${list(td)}
  <h3>Overdue</h3>${list(tasks.filter(t=>t.status!=='done'&&t.date<today()))}`},
tasks(){let a=tasks.filter(t=>(!flt.q||t.title.toLowerCase().includes(flt.q.toLowerCase()))&&(!flt.status||t.status===flt.status)&&(!flt.cat||t.cat===flt.cat));
  const cats=[...new Set(tasks.map(t=>t.cat))];
  return `<div class="filters"><input id="fq" placeholder="Search tasks" value="${esc(flt.q)}"><select id="fs"><option value="">All statuses</option>${Object.entries(ST).map(([k,v])=>`<option value="${k}" ${flt.status===k?'selected':''}>${v}</option>`).join('')}</select>
  <select id="fc"><option value="">All categories</option>${cats.map(c=>`<option ${flt.cat===c?'selected':''}>${esc(c)}</option>`).join('')}</select></div>${list(a)}`},
board(){return `<div class="cols">${Object.entries(ST).map(([k,v])=>`<div class="col"><h3>${v}</h3>${tasks.filter(t=>t.status===k).map(t=>`<div class="task"><b>${esc(t.title)}</b><small>${esc(t.cat)} · ${t.date}</small><div class="acts">${Object.entries(ST).filter(([s])=>s!==k).map(([s,l])=>`<button class="ghost small" onclick="setStatus('${t.id}','${s}')">→ ${l}</button>`).join('')}</div></div>`).join('')||'<div class="empty">Empty</div>'}</div>`).join('')}</div>`},
week(){const N=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],start=weekDates()[0],currentGoals=goals.filter(g=>g.weekStart===start);
  return `<div class="section-head"><div><h3>This week's goals</h3><p>Break a weekly target into smaller tasks and track each step.</p></div><button class="primary" onclick="openGoalForm()">+ Add weekly goal</button></div>
  ${currentGoals.length?`<div class="goal-grid">${currentGoals.map(g=>{const s=goalStats(g);return `<article class="card goal-card"><div class="goal-top"><div><h3>${esc(g.title)}</h3><p>${esc(g.description||'Weekly target')}</p></div><div class="goal-actions"><button class="ghost small" onclick="openGoalForm('${g.id}')">Edit</button><button class="ghost small" onclick="deleteGoal('${g.id}')">Delete</button></div></div>
  <div class="goal-progress"><span>${s.done}/${s.total} steps</span><strong>${s.pct}%</strong></div><div class="bar"><i style="width:${s.pct}%"></i></div>
  <button class="ghost small add-step" onclick="openForm(null,'${g.id}')">+ Add a step</button>
  ${tasks.filter(t=>t.goalId===g.id).map(t=>`<div class="goal-step ${t.status==='done'?'done':''}"><input type="checkbox" aria-label="Complete ${esc(t.title)}" ${t.status==='done'?'checked':''} onchange="setStatus('${t.id}',this.checked?'done':'pending')"><span>${esc(t.title)}<small>${t.date}</small></span></div>`).join('')||'<p class="goal-empty">No steps yet. Add a task to make progress.</p>'}</article>`}).join('')}</div>`:'<div class="empty">No weekly goals yet. Add a target and break it into manageable steps.</div>'}
  <div class="section-head calendar-head"><div><h3>Weekly calendar</h3><p>Tasks scheduled for this week</p></div></div>
  <div class="week-wrap"><div class="week">${weekDates().map((d,i)=>`<div class="day ${d===today()?'today':''}"><h4>${N[i]} ${d.slice(5)}</h4>${tasks.filter(t=>t.date===d).map(t=>`<div class="${t.status==='done'?'done':''}">${t.type==='weekly'?'★ ':''}${esc(t.title)}</div>`).join('')}</div>`).join('')}</div></div>`},
projects(){return `<div class="section-head"><div><h3>Your projects</h3><p>A home for the work and goals you care about.</p></div><button class="primary" onclick="openProjectForm()">＋ New project</button></div>
  ${projects.length?`<div class="project-grid">${projects.map(p=>{const a=tasks.filter(t=>t.projectId===p.id),done=a.filter(t=>t.status==='done').length,progress=pct(done,a.length);
    return `<article class="card project-card project-color-${esc(p.color||'violet')}"><div class="project-accent"></div><div class="project-inner"><div class="project-top"><div><h3>${esc(p.name)}</h3><p>${esc(p.description||'A space for focused progress.')}</p></div><span class="project-glyph">◇</span></div>
    <div class="project-meta"><span>${a.length} ${a.length===1?'task':'tasks'}</span><span>${done} completed</span></div><div class="project-progress"><div class="bar"><i style="width:${progress}%"></i></div></div>
    <div class="goal-actions project-actions"><button class="ghost small project-open" onclick="openProject('${p.id}')">Open project →</button><button class="ghost small" onclick="openProjectForm('${p.id}')">Edit</button><button class="ghost small" onclick="deleteProject('${p.id}')">Delete</button></div></div></article>`}).join('')}</div>`:'<div class="empty">Your project space is ready. Create a project to bring related tasks together.</div>'}
  ${tasks.some(t=>!t.projectId)?`<div class="section-head calendar-head"><div><h3>Independent tasks</h3><p>Tasks that are not linked to a project.</p></div></div>${list(tasks.filter(t=>!t.projectId))}`:''}`},
projectDetail(){const p=projects.find(x=>x.id===selectedProjectId);if(!p)return `<div class="empty">This project is no longer available. <button class="ghost small" onclick="navigate('projects')">Back to projects</button></div>`;
  const a=tasks.filter(t=>t.projectId===p.id),done=a.filter(t=>t.status==='done').length;
  return `<button class="ghost small back-link" onclick="navigate('projects')">← All projects</button><div class="project-hero project-color-${esc(p.color||'violet')}"><span class="eyebrow">PROJECT SPACE</span><h2>${esc(p.name)}</h2><p>${esc(p.description||'A space for focused progress.')}</p><div class="project-hero-meta"><span>${done} of ${a.length} tasks complete</span><strong>${pct(done,a.length)}%</strong></div><div class="bar"><i style="width:${pct(done,a.length)}%"></i></div></div>
  <div class="section-head"><div><h3>Project tasks</h3><p>Keep momentum, one step at a time.</p></div><button class="primary" onclick="openForm(null,'','${p.id}')">＋ Add task</button></div>${list(a)}`},
focus(){return `<div class="card timer"><div class="big" id="tm">25:00</div><p>Stay on one task. Work for 25 minutes, then rest.</p>
  <button class="primary" id="tgo">Start</button> <button class="ghost" id="trs">Reset</button></div>`},
settings(){const available=pushSupported()&&Boolean(vapidPublicKey);
  return `<div class="settings-grid"><article class="card settings-card"><h3>Hourly reminders</h3><p>Get a browser notification each hour while any task is unfinished. Quiet hours are 10pm–8am in your local timezone.</p>
  <div class="settings-actions"><button id="reminder-toggle" class="${remindersEnabled?'ghost':'primary'}" onclick="toggleReminders()" ${(!available&&!remindersEnabled)||reminderBusy?'disabled':''}>${reminderBusy?'Updating…':remindersEnabled?'Turn reminders off':'Enable hourly reminders'}</button></div>
  <small>${!pushSupported()?'This browser does not support push notifications.':!vapidPublicKey?'Configure the VAPID public key and redeploy to enable push.':remindersEnabled?'Enabled for this browser. Background delivery also needs the Supabase reminder scheduler configured.':'Permission is requested only after you enable reminders.'}</small></article>
  <article class="card settings-card"><h3>Appearance</h3><p>Choose the look that feels right for your workspace. Your preference is saved on this device.</p><div class="settings-actions"><button class="ghost" onclick="setTheme('dark')">Midnight</button><button class="ghost" onclick="setTheme('light')">Daylight</button></div></article>
  <article class="card settings-card"><h3>Your data</h3><p>Your work is stored in your Supabase account. Export a backup before moving to another account.</p><div class="settings-actions"><button class="primary" onclick="exportData()">Export backup</button><button class="ghost" onclick="document.querySelector('#import-file').click()">Import backup</button></div></article>
  <article class="card settings-card"><h3>Workspace at a glance</h3><p>${tasks.length} tasks · ${goals.length} weekly goals · ${projects.length} projects</p><small>Your planning data is synced securely to your Supabase account.</small></article></div>`},
stats(){const wd=weekDates(),N=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],c=wd.map(d=>tasks.filter(t=>t.completedAt===d).length),mx=Math.max(1,...c),best=c.indexOf(Math.max(...c));
  const prev=wd.map(d=>{const x=new Date(d);x.setDate(x.getDate()-7);return iso(x)}),pc=prev.reduce((s,d)=>s+tasks.filter(t=>t.completedAt===d).length,0),tc=c.reduce((a,b)=>a+b,0);
  return `<div class="grid"><div class="card"><h3>Total completed</h3><div class="big">${tasks.filter(t=>t.status==='done').length}</div></div>
  <div class="card"><h3>Streak</h3><div class="big">${streak()}</div>days</div>
  <div class="card"><h3>Best day this week</h3><div class="big">${tc?N[best]:'–'}</div></div>
  <div class="card"><h3>This week vs last</h3><div class="big">${tc} / ${pc}</div>completed</div></div>
  <div class="card"><h3>Completed per day (this week)</h3><div class="bars">${c.map((v,i)=>`<div><i style="height:${v/mx*100}%"></i>${v}<br>${N[i]}</div>`).join('')}</div></div>`}};

// focus timer
let tmr=null,left=1500;
function bindFocus(){const show=()=>$('#tm').textContent=String(Math.floor(left/60)).padStart(2,'0')+':'+String(left%60).padStart(2,'0');show();
  $('#tgo').onclick=e=>{if(tmr){clearInterval(tmr);tmr=null;e.target.textContent='Resume'}else{e.target.textContent='Pause';tmr=setInterval(()=>{left--;show();if(left<=0){clearInterval(tmr);tmr=null;alert('Session complete. Take a break.')}},1000)}};
  $('#trs').onclick=()=>{clearInterval(tmr);tmr=null;left=1500;show();$('#tgo').textContent='Start'}}

function render(){
  const titles={dashboard:['Good to see you again.','Here is your focus for today.'],tasks:['My Tasks','Everything on your plate, in one place.'],board:['Task Board','Move each task forward, at your own pace.'],week:['Weekly Planner','Make space for the work that matters.'],projects:['Projects','Your work, thoughtfully organized.'], 'project-detail':['Project overview','A focused view of your project.'],focus:['Focus Timer','Make room for deep, uninterrupted work.'],stats:['Your progress','Consistency is built one day at a time.'],settings:['Settings','Make GoalFlow feel like yours.']};
  const h=new Date().getHours(),heading=titles[page]||titles.dashboard;
  $('#hello').innerHTML=`<h2>${page==='dashboard'?(h<12?'Good morning.':h<18?'Good afternoon.':'Good evening.'):heading[0]}</h2><p>${page==='dashboard'?heading[1]:heading[1]}</p>`;
  $('#date-chip').textContent=new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'}).format(new Date());
  $('#add').hidden=page==='settings'||page==='project-detail';
  $('#add').onclick=()=>openForm(null,'',page==='project-detail'?selectedProjectId:'');
  document.querySelectorAll('#nav button,[data-p="settings"]').forEach(b=>b.classList.toggle('on',b.dataset.p===page||(page==='project-detail'&&b.dataset.p==='projects')));
  if(page!=='focus'&&tmr){clearInterval(tmr);tmr=null}
  $('#view').innerHTML=(page==='project-detail'?V.projectDetail:V[page]||V.dashboard)();
  if(page==='focus')bindFocus();
  if(page==='tasks'){const r=()=>{flt.q=$('#fq').value;flt.status=$('#fs').value;flt.cat=$('#fc').value;const p=$('#fq').selectionStart;render();$('#fq').focus();$('#fq').setSelectionRange(p,p)};$('#fq').oninput=r;$('#fs').onchange=r;$('#fc').onchange=r}
}
Object.assign(window,{navigate,setTheme,setStatus,del,resched,openForm,openGoalForm,deleteGoal,openProjectForm,deleteProject,openProject,exportData,toggleReminders});
render();
