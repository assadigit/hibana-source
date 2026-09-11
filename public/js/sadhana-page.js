
/* ══ HIBANA STATE ══════════════════════════════ */
/* Board data arrives from GET /api/sadhana (JSON) — the page is a standalone client.
   Task shape mirrors that endpoint: {id(uuid str), emoji, title, fuzzy, date, time,
   tags[], done, pinned, pos, progress, note, recur, recur_type, recur_config, updates[]}. */
let tasks = { 1: [], 2: [], 3: [], 4: [] }
let QUADS = [] // built from the server payload (custom names/subtitles + order)
let USERNAME = ''

/* ══ PREFERENCES ═══════════════════════════════ */
const PREFS={
  get lang(){return localStorage.getItem('s-lang')||'en'},
  set lang(v){localStorage.setItem('s-lang',v)},
  /* Hibana: the app-wide theme key — pre-painted in <head>, shared with every page. */
  get theme(){const v=localStorage.getItem('hibana-theme');if(v&&v!=='system')return v;return window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'},
  set theme(v){try{localStorage.setItem('hibana-theme',v)}catch(e){}},
};

/* ══ STATE ═════════════════════════════════════ */
let dragId=null,dragFrom=null,dragOverCard=null;
let formTags={1:[],2:[],3:[],4:[],m:[]};
let epTgt=null,activeFilter='all';
let lang=PREFS.lang,cal='g'; /* cal is DERIVED from lang (fa→j, en→g) — no manual toggle (2026-08-29) */
let zenQ=null;

/* deadline state per slot */
let dlState={1:{type:'none',val:''},2:{type:'none',val:''},3:{type:'none',val:''},4:{type:'none',val:''},m:{type:'none',val:''},z1:{type:'none',val:''},z2:{type:'none',val:''},z3:{type:'none',val:''},z4:{type:'none',val:''}};
let dlpSlot=null; /* which slot is popup open for */
/* step picker state */
let spStep=1,spYear=null,spMonth=null,spDay=null,spTime='';

/* undo stack */
let undoStack=[];
const { g2j, j2g, jalaliLeap, jMonthDays2, nowJalali, jalaliWeekNum, J_MONTHS, J_MONTHS_EN, J_DAYS_FA, WEEKDAY_FA, WEEKDAY_EN, toFa } = window.__hibJalali
function buildHeaderDate(){
  const el=document.getElementById('hdrDate');if(!el)return;
  const now=new Date();
  const dow=now.getDay(); /* 0=Sun … 6=Sat */
  if(lang==='fa'){
    /* Shamsi date in Persian, format: پنجشنبه ، ۷ اسفند ، ۱۴۰۴ */
    const[jy,jm,jd]=g2j(now.getFullYear(),now.getMonth()+1,now.getDate());
    const sep=`<span class="hdr-date-sep">،</span>`;
    el.innerHTML=`${WEEKDAY_FA[dow]}${sep}${toFa(jd)} ${J_MONTHS[jm-1]}${sep}${toFa(jy)}`;
    el.setAttribute('dir','rtl');
  } else {
    /* Shamsi date in English when cal=j, Gregorian when cal=g */
    if(cal==='j'){
      const[jy,jm,jd]=g2j(now.getFullYear(),now.getMonth()+1,now.getDate());
      const sep=`<span class="hdr-date-sep">·</span>`;
      el.innerHTML=`${WEEKDAY_EN[dow]}${sep}${J_MONTHS_EN[jm-1]} ${jd}${sep}${jy}`;
    } else {
      const sep=`<span class="hdr-date-sep">·</span>`;
      const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      el.innerHTML=`${WEEKDAY_EN[dow]}${sep}${months[now.getMonth()]} ${now.getDate()}${sep}${now.getFullYear()}`;
    }
    el.setAttribute('dir','ltr');
  }
}

/* ══ DEFINITIONS ═══════════════════════════════ */
/*
  GRID ORDER (LTR):  Q1 top-left  | Q3 top-right
                     Q2 bot-left  | Q4 bot-right
  RTL flips columns: Q1 top-right | Q3 top-left
                     Q2 bot-right | Q4 bot-left
  This matches the user's wireframe exactly.
*/
/* Focus 3.1: TAGS + FUZZY extracted to sadhana-data.js (loaded before this file). */
const { TAGS, FUZZY } = window.__hibanaSadhanaData

/* ══ TRANSLATIONS ══════════════════════════════ */
const T={
  en:{addTask:'＋ Add Task',signOut:'Sign out',allTasks:'All tasks',
      fuzzyTab:'Quick pick',stepTab:'📅 Pick date',
      addTaskBtn:'Add task',cancel:'Cancel',add:'Add',
      tags:'Tags',quadrant:'Quadrant',deadline:'Deadline',
      task:'Task',quickAdd:'Quick Add Task',
      noTasks:'No tasks yet',completed:'completed',
      tapEmoji:'Tap to pick emoji',clearDL:'Clear',done:'Done',
      saveEdit:'Save',cancelEdit:'Cancel',moreTasks:'↓ more',
      undoMsg:'Task deleted',undo:'↩ Undo',
      selectYear:'Select year',selectMonth:'Select month',selectDay:'Select day',
      noDeadline:'Set deadline…',
      moreOptions:'▸ Tags · Deadline · Recurring',lessOptions:'▴ Less options',
      untouched:'Untouched',inProgress:'In Progress',onHold:'On Hold',
      recurring:'Recurring',recurOff:'Does not repeat',
      daily:'Daily',weekly:'Weekly',ndays:'Every N days',monthly:'Monthly',
      daysLabel:'days',dayOfMonth:'Day of month',selectDays:'Select days',
      recurLbl:'Recurring',
      addUpdate:'Add update',updatePlaceholder:'Log a note or update…',noUpdates:'No updates yet',
      delFromArchive:'Delete forever',delFromArchiveConfirm:'This task is deleted permanently — no undo. Sure?',
  },
  fa:{addTask:'＋ افزودن وظیفه',signOut:'خروج',allTasks:'همه وظایف',
      fuzzyTab:'انتخاب سریع',stepTab:'📅 انتخاب تاریخ',
      addTaskBtn:'افزودن وظیفه',cancel:'لغو',add:'افزودن',
      tags:'برچسب‌ها',quadrant:'بخش',deadline:'مهلت',
      task:'وظیفه',quickAdd:'افزودن سریع وظیفه',
      noTasks:'وظیفه‌ای ندارید',completed:'انجام‌شده',
      tapEmoji:'برای انتخاب لمس کنید',clearDL:'پاک کردن',done:'تایید',
      saveEdit:'ذخیره',cancelEdit:'لغو',moreTasks:'↓ بیشتر',
      undoMsg:'وظیفه حذف شد',undo:'↩ بازگردانی',
      selectYear:'انتخاب سال',selectMonth:'انتخاب ماه',selectDay:'انتخاب روز',
      noDeadline:'تنظیم مهلت…',
      moreOptions:'▸ برچسب · مهلت · تکرار',lessOptions:'▴ کمتر',
      untouched:'شروع نشده',inProgress:'در حال انجام',onHold:'معلق',
      recurring:'تکرارشونده',recurOff:'تکرار نمی‌شود',
      daily:'روزانه',weekly:'هفتگی',ndays:'هر N روز',monthly:'ماهانه',
      daysLabel:'روز',dayOfMonth:'روز ماه',selectDays:'انتخاب روزها',
      recurLbl:'تکرار',
      addUpdate:'افزودن یادداشت',updatePlaceholder:'ثبت یادداشت یا پیشرفت…',noUpdates:'هنوز یادداشتی نیست',
      delFromArchive:'حذف برای همیشه',delFromArchiveConfirm:'این وظیفه برای همیشه حذف می‌شود — بازگشتی ندارد. مطمئنید؟',
  }
};
const tr=(k)=>T[lang][k]||k;

/* ══ API ═══════════════════════════════════════ */
function api(url, body, method) {
  const m = method || (body ? 'POST' : 'GET')
  const opts = { method: m, headers: {} }
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  return fetch(url, opts).then((r) => r.json()).catch(() => {})
}

/* ══ BUILD GRID ════════════════════════════════ */
function buildGrid(){
  const g=document.getElementById('matGrid');
  g.innerHTML=QUADS.map(q=>`
    <div class="quadrant q${q.id}" id="Q${q.id}"
      ondragover="onDO(event,${q.id})" ondrop="onDrop(event,${q.id})" ondragleave="onDL()">
      <div class="q-hero">
        <div class="q-big">${quadSym(q)}</div>
        <div class="q-hero-txt">
          <div class="q-title-row">
            <div class="q-title">${esc(q[lang].title)}</div>
            <button type="button" class="q-pen" onclick="openQEdit(${q.id},this)" title="${lang==='fa'?'تغییر نام و نماد':'Rename & symbol'}" aria-label="${lang==='fa'?'تغییر نام و نماد بخش':'Rename quadrant'}">
              <svg class="q-pen-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4.5-1L19.5 8a2 2 0 0 0-2.8-2.8L6.5 15.5 4 20Z"/><path d="M13.5 6.5l3.5 3.5"/></svg>
            </button>
          </div>
          <div class="q-sub">${esc(q[lang].sub)}</div>
        </div>
        <div class="q-hero-right">
          <button class="zen-btn" onclick="openZen(${q.id})" title="Focus">🎯</button>
          <div class="q-cnt" id="cnt-${q.id}">0</div>
        </div>
      </div>
      <div class="q-body-wrap">
        <div class="q-body" id="tb-${q.id}" onscroll="checkMore(${q.id})"></div>
        <div class="more-indicator" id="mi-${q.id}">
          <div class="more-badge" onclick="scrollMore(${q.id})">${tr('moreTasks')}</div>
        </div>
      </div>
      <div class="q-foot" id="qf-${q.id}">
        <button type="button" class="q-fab" onclick="showForm(${q.id})" id="ab-${q.id}" aria-label="${tr('addTaskBtn')}" title="${tr('addTaskBtn')}">＋</button>
        <div class="add-form" id="af-${q.id}">
          <div class="emo-row">
            <span class="ch-emo" id="ce-${q.id}" onclick="openEP('form',${q.id})">📌</span>
            <textarea class="ai" id="ti-${q.id}" rows="2" placeholder="${tr('addTaskBtn')}…" onkeydown="fKey(event,${q.id})" style="flex:1"></textarea>
          </div>
          <!-- Phase 6 item 13: labels/tags are settable right in the quick form (used to
               require More → full modal). The 🏷 button reveals the same tag picker. -->
          <div class="ftp-row" id="ftp-${q.id}" hidden></div>
          <div class="form-acts">
            <button class="btn" style="font-size:11px;padding:4px 9px;color:var(--text-dim)" onclick="togFormTags(${q.id})" id="ftb-${q.id}" title="${lang==='fa'?'برچسب‌گذاری کار':'Label the task'}" aria-expanded="false">🏷 ${lang==='fa'?'برچسب':'Label'}</button>
            <button class="btn" style="font-size:11px;padding:4px 9px;color:var(--text-dim)" onclick="openQA(${q.id})" title="${lang==='fa'?'گزینه‌های بیشتر':'More options'}">⚙️ ${lang==='fa'?'بیشتر':'More'}</button>
            <span style="flex:1"></span>
            <button class="btn" style="font-size:11.5px;padding:5px 10px" onclick="hideForm(${q.id})">${tr('cancel')}</button>
            <button class="btn btn-primary" style="font-size:11.5px;padding:5px 10px" onclick="addTask(${q.id})">${tr('add')}</button>
          </div>
        </div>
      </div>
    </div>`).join('');
  renderAll();
}

/* ══ SCROLL / MORE INDICATOR ═══════════════════ */
function checkMore(q){
  const body=document.getElementById(`tb-${q}`);
  const mi=document.getElementById(`mi-${q}`);
  if(!body||!mi)return;
  const hasMore=body.scrollHeight>body.clientHeight+10&&body.scrollTop+body.clientHeight<body.scrollHeight-10;
  mi.classList.toggle('show',hasMore);
}
function scrollMore(q){
  const body=document.getElementById(`tb-${q}`);
  if(body)body.scrollBy({top:120,behavior:'smooth'});
}
function checkAllMore(){[1,2,3,4].forEach(q=>checkMore(q));}

/* ══ DEADLINE POPUP ════════════════════════════ */
function openDLP(slot,triggerEl){
  dlpSlot=slot;
  /* Position popup near trigger */
  const popup=document.getElementById('dlPopup');
  const ov=document.getElementById('dlpOv');
  const rect=triggerEl.getBoundingClientRect();
  let top=rect.bottom+6;
  let left=rect.left;
  if(top+420>window.innerHeight)top=rect.top-430;
  if(left+320>window.innerWidth)left=window.innerWidth-330;
  popup.style.top=Math.max(8,top)+'px';
  popup.style.left=Math.max(8,left)+'px';
  /* Translate tabs */
  document.getElementById('dlTabFuz').textContent=tr('fuzzyTab');
  document.getElementById('dlTabStep').textContent=tr('stepTab');
  document.getElementById('dlClearBtn').textContent=tr('clearDL');
  /* Show fuzzy tab by default */
  spTime='';
  dlpTab('fuz');
  popup.classList.add('open');
  ov.classList.add('open');
}
function closeDLP(){
  document.getElementById('dlPopup').classList.remove('open');
  document.getElementById('dlpOv').classList.remove('open');
  dlpSlot=null;
}
function clearDL(){
  if(dlpSlot===null)return;
  dlState[dlpSlot]={type:'none',val:''};
  updateDLTrigger(dlpSlot);
  closeDLP();
}
function dlpTab(which){
  document.getElementById('dlTabFuz').classList.toggle('active',which==='fuz');
  document.getElementById('dlTabStep').classList.toggle('active',which==='step');
  document.getElementById('dlpFuzContent').style.display=which==='fuz'?'':'none';
  document.getElementById('dlpStepContent').style.display=which==='step'?'':'none';
  if(which==='fuz')buildFuzGrid();
  else{spStep=1;spYear=null;spMonth=null;spDay=null;buildStepPicker();}
}
function buildFuzGrid(){
  const cur=dlpSlot&&dlState[dlpSlot]?dlState[dlpSlot]:{};
  document.getElementById('dlpFuzGrid').innerHTML=FUZZY.map(f=>`
    <button class="fuz-opt${cur.type==='fuzzy'&&cur.val===f.k?' sel':''}" onclick="pickFuzzy('${f.k}')">
      <span class="fuz-ico">${f.ico}</span>${lang==='fa'?f.fa:f.en}
    </button>`).join('');
}
function pickFuzzy(k){
  if(dlpSlot===null)return;
  dlState[dlpSlot]={type:'fuzzy',val:k};
  updateDLTrigger(dlpSlot);
  buildFuzGrid();
  setTimeout(closeDLP,300);
}
function updateDLTrigger(slot){
  const s=dlState[slot];
  /* find trigger elements */
  const labelId=slot==='m'?'mDLLabel':`dltl-${slot}`;
  const btnId=slot==='m'?'mDLTrigger':`dlt-${slot}`;
  const lbl=document.getElementById(labelId);
  const btn=document.getElementById(btnId);
  if(!lbl)return;
  if(s.type==='none'){lbl.textContent=tr('noDeadline');btn&&btn.classList.remove('has-val');}
  else if(s.type==='fuzzy'){
    const f=FUZZY.find(x=>x.k===s.val);
    lbl.textContent=f?(lang==='fa'?f.fa:f.en):s.val;
    btn&&btn.classList.add('has-val');
  }
  else if(s.type==='exact'){
    let display=formatStoredDate(s.val);
    if(s.time)display+=' 🕐 '+s.time;
    lbl.textContent=display;
    btn&&btn.classList.add('has-val');
  }
}

/* ══ STEP DATE PICKER ══════════════════════════ */
function buildStepPicker(){
  const container=document.getElementById('dlpStepPicker');
  const nowG=new Date();
  const nowJ=g2j(nowG.getFullYear(),nowG.getMonth()+1,nowG.getDate());
  const isShamsi=cal==='j';

  /* Step nav */
  let navHTML=`<div class="step-nav">
    <div class="step-pill${spStep===1?' active':spYear?' done':''}" onclick="spGoStep(1)">
      ${spYear?(isShamsi?toFa(spYear):spYear):(isShamsi?tr('selectYear'):'Year')}
    </div>
    ${spYear?`<span class="step-arrow">›</span>
    <div class="step-pill${spStep===2?' active':spMonth?' done':''}" onclick="spGoStep(2)">
      ${spMonth?(isShamsi?J_MONTHS[spMonth-1]:(new Date(0,spMonth-1).toLocaleString('en',{month:'short'}))):(isShamsi?tr('selectMonth'):'Month')}
    </div>`:''}
    ${spMonth?`<span class="step-arrow">›</span>
    <div class="step-pill${spStep===3?' active':''}" onclick="spGoStep(3)">
      ${spDay?(isShamsi?toFa(spDay):spDay):(isShamsi?tr('selectDay'):'Day')}
    </div>`:''}
  </div>`;

  let contentHTML='';

  if(spStep===1){
    /* Year selection: current year + next year */
    const cy=isShamsi?nowJ[0]:nowG.getFullYear();
    const years=[cy,cy+1];
    contentHTML=`<div class="year-grid">
      ${years.map(y=>`<button class="pick-btn${spYear===y?' sel':''}" onclick="spPickYear(${y})">${isShamsi?toFa(y):y}</button>`).join('')}
    </div>`;
  }
  else if(spStep===2){
    /* Month grid */
    const months=isShamsi?J_MONTHS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    contentHTML=`<div class="month-grid">
      ${months.map((m,i)=>`<button class="pick-btn${spMonth===i+1?' sel':''}" onclick="spPickMonth(${i+1})">${m}</button>`).join('')}
    </div>`;
  }
  else if(spStep===3){
    /* Day grid */
    let maxDay=31;
    if(isShamsi&&spYear&&spMonth)maxDay=jMonthDays2(spYear,spMonth);
    else if(!isShamsi&&spYear&&spMonth){
      maxDay=new Date(spYear,spMonth,0).getDate();
    }
    /* Day headers */
    const headers=isShamsi?J_DAYS_FA:['Su','Mo','Tu','We','Th','Fr','Sa'];
    contentHTML=`
      <div class="day-grid">${headers.map(h=>`<div class="day-header">${h}</div>`).join('')}</div>
      <div class="day-grid">
        ${Array.from({length:maxDay},(_,i)=>i+1).map(d=>{
          /* highlight today */
          let isToday=false;
          if(isShamsi){isToday=d===nowJ[2]&&spMonth===nowJ[1]&&spYear===nowJ[0];}
          else{isToday=d===nowG.getDate()&&spMonth===nowG.getMonth()+1&&spYear===nowG.getFullYear();}
          return`<button class="pick-btn${spDay===d?' sel':''}${isToday&&spDay!==d?' today-marker':''}" onclick="spPickDay(${d})">${isShamsi?toFa(d):d}</button>`;
        }).join('')}
      </div>`;
  }

  /* ── Step 4: Time picker ── */
  if(spStep===4){
    const isFA=lang==='fa';
    const dateLabel=dlState[dlpSlot]?formatStoredDate(dlState[dlpSlot].val):'';
    navHTML=`<div class="step-nav">
      <div class="step-pill done" onclick="spGoStep(1)">${isShamsi?toFa(spYear):spYear}</div>
      <span class="step-arrow">›</span>
      <div class="step-pill done" onclick="spGoStep(2)">${isShamsi?J_MONTHS[spMonth-1]:(new Date(0,spMonth-1).toLocaleString('en',{month:'short'}))}</div>
      <span class="step-arrow">›</span>
      <div class="step-pill done" onclick="spGoStep(3)">${isShamsi?toFa(spDay):spDay}</div>
      <span class="step-arrow">›</span>
      <div class="step-pill active">${isFA?'ساعت':'Time'}</div>
    </div>`;
    contentHTML=`
      <div style="padding:14px 4px 6px;text-align:center">
        <div style="font-size:11px;color:var(--text-dim);margin-bottom:10px">${isFA?'ساعت قرار (اختیاری):':'Appointment time (optional):'}</div>
        <input id="spTimeInp" type="time" value="${spTime||''}"
          style="font-size:22px;font-weight:600;color:var(--accent);background:var(--surface2);
                 border:1.5px solid var(--accent);border-radius:10px;padding:8px 16px;
                 outline:none;text-align:center;width:160px;cursor:pointer"
          onchange="spTime=this.value">
        <div style="display:flex;gap:8px;justify-content:center;margin-top:14px">
          <button class="btn" style="font-size:11.5px;padding:5px 14px" onclick="spSkipTime()">
            ${isFA?'بدون ساعت':'No time'}
          </button>
          <button class="btn btn-primary" style="font-size:11.5px;padding:5px 14px" onclick="spConfirmTime()">
            ${isFA?'تأیید':'Confirm'}
          </button>
        </div>
      </div>`;
  }

  container.innerHTML=navHTML+contentHTML;
}
function spGoStep(s){if(s<=spStep||(s===2&&spYear)||(s===3&&spMonth)){spStep=s;buildStepPicker();}}
function spPickYear(y){spYear=y;spStep=2;buildStepPicker();}
function spPickMonth(m){spMonth=m;spStep=3;buildStepPicker();}
function spPickDay(d){
  spDay=d;
  if(dlpSlot===null)return;
  let gy,gm,gd;
  if(cal==='j'){[gy,gm,gd]=j2g(spYear,spMonth,d);}
  else{gy=spYear;gm=spMonth;gd=d;}
  const val=`${gy}-${String(gm).padStart(2,'0')}-${String(gd).padStart(2,'0')}`;
  dlState[dlpSlot]={type:'exact',val,time:''};
  updateDLTrigger(dlpSlot);
  spStep=4; /* advance to time picker step */
  buildStepPicker();
}
function spConfirmTime(){
  const inp=document.getElementById('spTimeInp');
  spTime=inp?inp.value:'';
  if(dlState[dlpSlot])dlState[dlpSlot].time=spTime;
  updateDLTrigger(dlpSlot);
  closeDLP();
}
function spSkipTime(){
  spTime='';
  if(dlState[dlpSlot])dlState[dlpSlot].time='';
  updateDLTrigger(dlpSlot);
  closeDLP();
}
function formatStoredDate(isoStr){
  if(!isoStr)return'';
  const[gy,gm,gd]=isoStr.split('-').map(Number);
  if(cal==='j'){
    const[jy,jm,jd]=g2j(gy,gm,gd);
    return`${lang==='fa'?J_MONTHS[jm-1]:J_MONTHS_EN[jm-1]} ${lang==='fa'?toFa(jd):jd}، ${lang==='fa'?toFa(jy):jy}`;
  }
  const dt=new Date(gy,gm-1,gd);
  return dt.toLocaleDateString('en-GB',{month:'short',day:'numeric',year:'numeric'});
}

/* ══ FILTER BAR ════════════════════════════════ */
function buildFilterBar(){
  const ct=document.getElementById('filterTags');
  ct.innerHTML=`<button class="ftag all${activeFilter==='all'?' active':''}" onclick="setFilter('all')">${tr('allTasks')}</button>`+
    TAGS.map(tg=>`<button class="ftag ftag-${tg.cls}${activeFilter===tg.id?' active':''}" onclick="setFilter('${tg.id}')">${tg.ico} ${lang==='fa'?tg.fa:tg.en}</button>`).join('');
  updateFilterCount();
}
function setFilter(tagId){activeFilter=tagId;buildFilterBar();renderAll();}

/* ══ SWIPEABLE QUADRANT CAROUSEL (session 9, user request) ══════
   Replaces the 2026-08-29 mobile quadrant-focus view (two half-width columns
   side by side — cramped, caused UI problems). ≤740px: #matGrid is a scroll-snap
   carousel, ONE quadrant per slide; thumb-swipe or dot-tap moves between them.
   Guidance: the dot row (#quadDots, active dot synced to the visible slide) + a
   one-time pulsing swipe hint (#swipeHint) that dies on first swipe or after 4s.
   Desktop is untouched — the CSS gates everything to the phone width. */
const isPhone=()=>window.matchMedia('(max-width:740px)').matches
function buildQuadDots(){
  const wrap=document.getElementById('quadDots');if(!wrap)return;
  wrap.innerHTML=QUADS.map(q=>
    `<button type="button" class="quad-dot" id="qd-${q.id}" role="tab" onclick="goToQuad(${q.id})" aria-label="${esc(q[lang].title)}" title="${esc(q[lang].title)}"></button>`
  ).join('');
  syncQuadDots();
  wireSwipeHint();
}
/* RTL note: modern browsers report NEGATIVE scrollLeft while scrolling an RTL
   container (slide 2+ lives to the LEFT of slide 1 for fa). |scrollLeft| / width
   gives the slide index in both directions; the sign flips only when WE scroll. */
function quadIndex(){
  const g=document.getElementById('matGrid');if(!g)return 0;
  return Math.max(0,Math.min(QUADS.length-1,Math.round(Math.abs(g.scrollLeft)/Math.max(1,g.clientWidth))))
}
function syncQuadDots(){
  const i=quadIndex();
  document.querySelectorAll('.quad-dot').forEach((d,k)=>{
    d.classList.toggle('active',k===i);
    d.setAttribute('aria-selected',k===i?'true':'false');
  });
}
function goToQuad(q){
  const g=document.getElementById('matGrid');if(!g)return;
  /* NOTE: QUADS is ordered [1,3,2,4] (Today, Urgent, Strategic, Personal — the two
     action quadrants first); slide i = QUADS[i], NOT quadrant id i. RTL verified:
     modern Chrome reports NEGATIVE scrollLeft (slide 2+ sits left of slide 1). */
  const i=QUADS.findIndex(x=>x.id===q);if(i<0)return;
  const sign=getComputedStyle(g).direction==='rtl'?-1:1;
  g.scrollTo({left:sign*i*g.clientWidth,behavior:'smooth'});
  hideSwipeHint();
}
/* A task added to a quadrant on another slide would land off-screen — advance the
   carousel so the new card is always visible (replaces the old revealIfHidden). */
function revealIfHidden(q){
  if(!isPhone())return;
  if(quadIndex()!==QUADS.findIndex(x=>x.id===q))goToQuad(q);
}
/* Swipe hint: pulse until the user first swipes (or 4s); one session per load. */
let swipeHintHidden=false
function wireSwipeHint(){
  const h=document.getElementById('swipeHint'),g=document.getElementById('matGrid');
  if(!h||!g)return;
  const txt=document.getElementById('swipeHintTxt');
  if(txt)txt.textContent=lang==='fa'?'برای بخش‌های دیگر بکشید':'Swipe for more';
  h.querySelector('span:last-child').textContent=lang==='fa'?'‹':'›';
  if(swipeHintHidden||!isPhone()){h.classList.add('hide');return}
  h.classList.remove('hide');
  setTimeout(hideSwipeHint,4000);
}
function hideSwipeHint(){
  swipeHintHidden=true;
  document.getElementById('swipeHint')?.classList.add('hide');
}
(function(){
  const g=document.getElementById('matGrid');if(!g)return;
  let raf=0;
  g.addEventListener('scroll',()=>{
    if(!isPhone())return;
    hideSwipeHint();
    if(raf)return;
    raf=requestAnimationFrame(()=>{raf=0;syncQuadDots()})
  },{passive:true});
  g.addEventListener('scrollend',syncQuadDots);
  /* Grid rebuilt (buildGrid replaces children) → re-wire dots + re-measure. */
  const mo=new MutationObserver(()=>{if(isPhone())syncQuadDots()});
  mo.observe(g,{childList:true});
  window.addEventListener('resize',()=>{buildQuadDots()});
})();
function updateFilterCount(){
  const fc=document.getElementById('filterCount');if(!fc)return;
  if(activeFilter==='all'){fc.textContent='';return;}
  const tg=TAGS.find(x=>x.id===activeFilter);
  const n=[1,2,3,4].reduce((a,q)=>a+tasks[q].filter(x=>!x.deleted&&x.tags&&x.tags.includes(activeFilter)).length,0);
  fc.textContent=lang==='fa'?`${toFa(n)} وظیفه با برچسب "${tg.fa}"`:`${n} task${n!==1?'s':''} tagged "${tg.en}"`;
}
function buildTagPicker(cid,slot){
  const el=document.getElementById(cid);if(!el)return;
  el.innerHTML=TAGS.map(tg=>`<button class="tp-tag ${tg.cls}${formTags[slot].includes(tg.id)?' sel':''}" onclick="togFT('${slot}','${tg.id}',this)">${tg.ico} ${lang==='fa'?tg.fa:tg.en}</button>`).join('');
}
function togFT(slot,tagId,btn){const arr=formTags[slot];const i=arr.indexOf(tagId);if(i>-1){arr.splice(i,1);btn.classList.remove('sel');}else{arr.push(tagId);btn.classList.add('sel');}}

/* ══ RENDER ════════════════════════════════════ */
function renderAll(){[1,2,3,4].forEach(q=>renderQ(q));updateFilterCount();setTimeout(checkAllMore,50);}
function taskVisible(t){return activeFilter==='all'||(t.tags&&t.tags.includes(activeFilter));}

function renderQ(q,targetBody){
  const body=targetBody||document.getElementById(`tb-${q}`);if(!body)return;
  const all=tasks[q].filter(x=>!x.deleted);
  // Sort: pinned first (by pos), then unpinned (by pos)
  const sortFn=(a,b)=>{
    if(a.pinned&&!b.pinned)return -1;
    if(!a.pinned&&b.pinned)return 1;
    return (a.pos||0)-(b.pos||0);
  };
  const active=all.filter(x=>!x.done).sort(sortFn);
  const done=all.filter(x=>x.done);
  const n=active.length;
  const cntEl=document.getElementById(`cnt-${q}`);
  if(cntEl){
    const total=all.length;
    if(lang==='fa') cntEl.textContent=toFa(n)+' / '+toFa(total);
    else cntEl.textContent=n+' / '+total;
  }
  if(!all.length){body.innerHTML=`<div class="empty"><div class="ei" aria-hidden="true"><svg class="icon" viewBox="0 0 24 24" style="width:22px;height:22px"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4.2 12.6c.9.7 1.2 1.6 1.2 2.4h6c0-.8.3-1.7 1.2-2.4A7 7 0 0 0 12 2Z"/></svg></div><div class="et">${tr('noTasks')}<br><span class="et-hint">${lang==='fa'?'یکی را در پایین هر کارت اضافه کن':'Add one below each card'}</span></div></div>`;return;}
  let h=active.map(x=>`<div style="${!taskVisible(x)?'display:none':''}">${tcHTML(x,q)}</div>`).join('');
  if(done.length){
    const sfx=targetBody?'z':'';
    const vd=done.filter(x=>taskVisible(x));
    h+=`<div class="done-div" onclick="togDS(${q},'${sfx}')"><div class="done-line"></div><span class="done-arrow" id="da-${q}${sfx}">›</span><span>${vd.length} ${tr('completed')}</span><div class="done-line"></div></div>
    <div id="ds-${q}${sfx}" style="display:none;flex-direction:column;gap:5px">${done.map(x=>`<div style="${!taskVisible(x)?'display:none':''}">${tcHTML(x,q)}</div>`).join('')}</div>`;
  }
  body.innerHTML=h;
  if(!targetBody)setTimeout(()=>checkMore(q),30);
}
/* note row template — shared by the renderer, addUpdate and the inline editor
   (top-level so every handler can reach it) */
function updRowInner(u,taskId,q){return `<span class="upd-ts">${(u.ts||'').slice(0,10)}</span><span class="upd-text">${esc(u.text)}</span><button class="upd-edit" onclick="startUpdEdit('${u.id}','${taskId}',${q})" title="${lang==='fa'?'ویرایش یادداشت':'Edit note'}">✏️</button><button class="upd-del" onclick="delUpdate('${u.id}','${taskId}',${q})" title="${lang==='fa'?'حذف':'Delete'}">×</button>`}
function tcHTML(task,q){
  const fObj=task.fuzzy?FUZZY.find(f=>f.k===task.fuzzy):null;
  const dlLbl=fObj?(lang==='fa'?fObj.fa:fObj.en):null;
  const dlDate=!task.fuzzy&&task.date?formatStoredDate(task.date):null;
  const ov=!task.done&&!task.fuzzy&&task.date&&new Date(task.date)<new Date(new Date().toDateString());
  const tagChips=(task.tags||[]).map(tid=>{const tg=TAGS.find(x=>x.id===tid);return tg?`<span class="task-tag" title="${lang==='fa'?tg.fa:tg.en}">${tg.ico}</span>`:''}).join('');
  const prog=task.progress||'untouched';
  const progLabels={untouched:lang==='fa'?'شروع نشده':'Not started',in_progress:lang==='fa'?'در حال انجام':'In Progress',on_hold:lang==='fa'?'معلق':'On Hold'};
  const progStateClass=prog==='in_progress'?'st-inprog':prog==='on_hold'?'st-hold':'st-untouched'; /* untouched = muted grey (2026-09 user request) */
  const cardStatusClass=task.done?'':progStateClass; /* card carries the state tint (2026-08-29) */
  /* 3-dot progress track — always visible */
  const progTrack=!task.done?`<div class="prog-track ${progStateClass}">
    <div class="prog-dot p-untouched${prog==='untouched'?' p-active':''}" onclick="setProgress(event,'${task.id}',${q},'untouched')" title="${progLabels.untouched}"></div>
    <div class="prog-dot p-inprog${prog==='in_progress'?' p-active':''}" onclick="setProgress(event,'${task.id}',${q},'in_progress')" title="${progLabels.in_progress}"></div>
    <div class="prog-dot p-hold${prog==='on_hold'?' p-active':''}" onclick="setProgress(event,'${task.id}',${q},'on_hold')" title="${progLabels.on_hold}"></div>
    <span class="prog-lbl">${progLabels[prog]}</span>
  </div>`:'';
  const notePreview=!task.done&&task.note?`<div class="task-note-preview" onclick="startEdit('${task.id}',${q})" title="${esc(task.note)}">📝 ${esc(task.note.split('\n')[0].slice(0,60))}${task.note.length>60?'…':''}</div>`:'';
  const recurBadge=task.recur&&!task.done?`<span class="recur-badge">${recurLabel(task)}</span>`:'';
  /* updates toggle */
  const updCount=(task.updates||[]).length;
  const updToggle=!task.done?`<button class="upd-toggle${updCount?' has-notes':''}" onclick="toggleUpdates(event,'${task.id}')" title="${tr('addUpdate')}"><span class="upd-ico">📋</span>${updCount||'+'}</button>`:'';
  /* updates panel — notes are addable, deletable AND editable in place (2026-09-02) */
  const updRows=(task.updates||[]).map(u=>`<div class="upd-row" id="upd-${u.id}">${updRowInner(u,task.id,q)}</div>`).join('');
  const updPanel=!task.done?`<div class="upd-panel" id="upd-panel-${task.id}">
    <div class="upd-list">${updRows||`<div class="upd-empty">${tr('noUpdates')}</div>`}</div>
    <div class="upd-add-row">
      <input class="upd-inp" id="upd-inp-${task.id}" placeholder="${tr('updatePlaceholder')}" maxlength="500" onkeydown="if(event.key==='Enter'){event.preventDefault();addUpdate('${task.id}',${q});}">
      <button class="upd-add-btn" onclick="addUpdate('${task.id}',${q})" title="${tr('addUpdate')}">+</button>
    </div>
  </div>`:'';
  /* deadline display in edit form */
  const editDlSlot=`e${task.id}`;
  const editDlDisplay=task.fuzzy?(()=>{const f=FUZZY.find(x=>x.k===task.fuzzy);return f?(lang==='fa'?f.fa:f.en):task.fuzzy;})()
    :task.date?formatStoredDate(task.date):tr('noDeadline');
  const editDlHasVal=!!(task.fuzzy||task.date);
  return`<div class="task-card${task.done?' done':''}${ov?' overdue-dl':''}${task.pinned?' is-pinned':''}${cardStatusClass?' '+cardStatusClass:''}" id="tc-${task.id}"
    draggable="${!task.done}"
    onclick="cardTap(event,'${task.id}',${q})"
    ondragstart="onDS(event,'${task.id}',${q})"
    ondragend="onDE()"
    ondragover="onDOCard(event,'${task.id}')"
    ondrop="onDropCard(event,'${task.id}',${q})"
    ondragleave="onDLCard(event,'${task.id}')">
    <span class="t-emoji" onclick="openEP('task',${q},'${task.id}')">${task.emoji}</span>
    <div class="t-check${task.done?' chk':''}" onclick="togDone('${task.id}',${q})">${task.done?'✓':''}</div>
    <div class="t-content">
      <div class="task-title-row">
        <span class="task-txt" id="tt-${task.id}">${esc(task.title)}${task.pinned?'<span class="pin-badge">📌</span>':''}</span>
        ${tagChips?`<span class="task-tags">${tagChips}</span>`:''}
      </div>
      ${dlLbl?`<div class="t-meta"><span class="tdl fuzzy">${fObj.ico} ${dlLbl}</span></div>`:''}
      ${dlDate?`<div class="t-meta"><span class="tdl${ov?' overdue':''}">📅 ${dlDate}${task.time?' 🕐 '+task.time:''}${ov?' ⚠️':''}</span></div>`:''}
      ${progTrack}
      ${recurBadge}
      ${notePreview}
      ${updToggle}
      ${updPanel}
    </div>
    <div class="t-actions">
      <button class="t-act pin${task.pinned?' pinned':''}" onclick="togglePin(event,'${task.id}',${q})" title="${lang==='fa'?'سنجاق کردن':'Pin to top'}">📌</button>
      <button class="t-act edt" onclick="startEdit('${task.id}',${q})">✏️</button>
      <button class="t-act del" onclick="softDel('${task.id}',${q})">🗑</button>
      ${task.done?`<button class="t-act undo" onclick="togDone('${task.id}',${q})">↩</button>`:''}
    </div>
  </div>
  <div class="task-edit-form" id="ef-${task.id}">
    <textarea class="edit-input" id="ei-${task.id}" rows="2">${esc(task.title)}</textarea>
    <textarea class="edit-input" id="en-${task.id}" rows="2" placeholder="${lang==='fa'?'یادداشت…':'Note…'}" style="font-size:11.5px;color:var(--text-muted)">${esc(task.note||'')}</textarea>
    <div>
      <label class="form-lbl">${tr('deadline')}</label>
      <button class="dl-trigger${editDlHasVal?' has-val':''}" id="dlt-${editDlSlot}" onclick="openDLP('${editDlSlot}',this)">
        <span class="dl-trigger-ico">📅</span>
        <span id="dltl-${editDlSlot}">${editDlDisplay}</span>
        ${editDlHasVal?`<span class="dl-trigger-clr" onclick="event.stopPropagation();clearEditDL('${editDlSlot}')">✕</span>`:''}
      </button>
    </div>
    <div id="eRecurUI-${task.id}"></div>
    <div class="edit-acts">
      <button class="btn" style="font-size:11px;padding:4px 9px;color:var(--err)" onclick="softDel('${task.id}',${q})" title="${lang==='fa'?'حذف':'Delete'}">🗑</button> <!-- Session 20: theme-aware red (dark #f06161) — was fixed #c0392b (2.8:1 dark) -->
      <span style="flex:1"></span>
      <button class="btn" style="font-size:11px;padding:4px 9px" onclick="cancelEdit('${task.id}')">${tr('cancelEdit')}</button>
      <button class="btn btn-primary" style="font-size:11px;padding:4px 9px" onclick="saveEdit('${task.id}',${q})">${tr('saveEdit')}</button>
    </div>
  </div>`;
}
/* ══ CARD TAP → EDIT (mobile focus view) ═══════════ */
/* In the two-column focus view the vertical action column (pin/edit/delete) is
   hidden to keep half-width cards readable (user request 2026-08-29). Tapping a
   card's neutral area opens the edit form instead; interactive children that
   already own their tap behavior (checkbox, emoji, progress dots, updates
   toggle, note preview, buttons/inputs) are excluded so their actions win.
   Board cards only — the zen overlay keeps its own inline action buttons. */
function cardTap(ev,id,q){
  if(!isPhone())return;
  if(!ev.target.closest('#matGrid'))return;
  if(ev.target.closest('.t-check,.t-emoji,.upd-toggle,.upd-panel,.t-act,.task-tag,.prog-dot,.task-note-preview,button,input,textarea,select,a'))return;
  startEdit(id,q);
}
function togDS(q,sfx){
  const s=document.getElementById(`ds-${q}${sfx}`),a=document.getElementById(`da-${q}${sfx}`);
  if(!s)return;const op=s.style.display==='flex';
  s.style.display=op?'none':'flex';a.classList.toggle('open',!op);
}
// L6 fix (2026-09-10): escape single quotes too — matches the server-side esc() in src/lib/http.ts.
// The old version escaped only &<>" (safe for text content + double-quoted attributes, but
// vulnerable inside single-quoted JS strings used in onclick handlers below).
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

/* ══ EDIT TASK (modal — user request 2026-09) ════════════════════════ */
/* Was inline (ef-${id} form below the card). Now opens a native <dialog> modal with
   the same fields: title, note, deadline, recurrence. Saves via the same PATCH
   endpoint + re-renders the quadrant. The inline form is kept as a data source
   (the modal reads from it) but is never shown inline. */
let sadhanaEditDlg = null
function startEdit(id, q) {
  const task = [1, 2, 3, 4].flatMap(qq => tasks[qq]).find(x => x.id === id)
  if (!task) return
  if (!sadhanaEditDlg) {
    sadhanaEditDlg = document.createElement('dialog')
    sadhanaEditDlg.id = 'sadhana-edit-modal'
    sadhanaEditDlg.className = 'dialog'
    sadhanaEditDlg.innerHTML =
      '<form class="modal" id="se-form" novalidate>' +
        '<div class="row spread"><h3 id="se-title">' + tr('editTask') + '</h3>' +
        '<button type="button" class="ghost icon-btn" id="se-close" aria-label="' + tr('closeEdit') + '">✕</button></div>' +
        '<label>' + tr('taskTitle') + ' <textarea id="se-input" rows="3" maxlength="300" dir="auto" required></textarea></label>' +
        '<label>' + tr('noteLbl') + ' <textarea id="se-note" rows="2" dir="auto" style="font-size:12px;color:var(--text-muted)"></textarea></label>' +
        '<div id="se-deadline-row"><label class="form-lbl">' + tr('deadline') + '</label>' +
          '<button type="button" class="dl-trigger" id="se-dl-trigger"><span class="dl-trigger-ico">📅</span><span id="se-dl-label"></span></button>' +
        '</div>' +
        '<div id="se-recur-ui"></div>' +
        '<p class="error" id="se-error" role="alert"></p>' +
        '<div class="edit-acts">' +
          '<button type="button" class="btn" style="font-size:12px;padding:5px 12px;color:var(--err)" id="se-del" title="' + tr('delete') + '">🗑</button>' +
          '<span style="flex:1"></span>' +
          '<button type="button" class="btn" style="font-size:12px;padding:5px 12px" id="se-cancel">' + tr('cancelEdit') + '</button>' +
          '<button type="submit" class="btn btn-primary" style="font-size:12px;padding:5px 12px" id="se-save">' + tr('saveEdit') + '</button>' +
        '</div>' +
      '</form>'
    document.body.appendChild(sadhanaEditDlg)
    sadhanaEditDlg.addEventListener('cancel', (e) => { e.preventDefault(); sadhanaEditDlg.close() })
    sadhanaEditDlg.addEventListener('click', (e) => { if (e.target === sadhanaEditDlg) sadhanaEditDlg.close() })
    sadhanaEditDlg.querySelector('#se-close').onclick = () => sadhanaEditDlg.close()
    sadhanaEditDlg.querySelector('#se-cancel').onclick = () => sadhanaEditDlg.close()
    sadhanaEditDlg.querySelector('#se-del').onclick = () => {
      const tid = sadhanaEditDlg.dataset.tid
      const tq = Number(sadhanaEditDlg.dataset.q)
      if (tid && tq) { sadhanaEditDlg.close(); softDel(tid, tq) }
    }
    // Deadline picker trigger
    sadhanaEditDlg.querySelector('#se-dl-trigger').onclick = function() {
      openDLP('se-modal', this)
    }
    // Form submit
    sadhanaEditDlg.querySelector('#se-form').addEventListener('submit', (e) => {
      e.preventDefault()
      const tid = sadhanaEditDlg.dataset.tid
      const tq = Number(sadhanaEditDlg.dataset.q)
      if (!tid || !tq) return
      const inp = sadhanaEditDlg.querySelector('#se-input')
      const newText = inp.value.trim()
      if (!newText) { inp.focus(); return }
      const task = tasks[tq].find(x => x.id === tid)
      if (task) task.title = newText
      const noteInp = sadhanaEditDlg.querySelector('#se-note')
      if (noteInp && task) {
        const newNote = noteInp.value
        if (newNote !== task.note) { task.note = newNote; api(`/api/sadhana/tasks/${tid}`, { note: newNote }, 'PATCH') }
      }
      // Recurrence
      const rd = getRecurData('se-modal')
      if (task) { task.recur = rd.recurring; task.recur_type = rd.recur_type || ''; task.recur_config = rd.recur_config || '' }
      // Deadline
      const ds = dlState['se-modal'] || { type: 'none', val: '' }
      const newFuzzy = ds.type === 'fuzzy' ? ds.val : ''
      const newDate = ds.type === 'exact' ? ds.val : ''
      if (task) { task.fuzzy = newFuzzy; task.date = newDate }
      const newTime = ds.type === 'exact' ? (ds.time || '') : ''; if (task) task.time = newTime
      api(`/api/sadhana/tasks/${tid}`, { title: newText, ...rd, fuzzy: newFuzzy || null, due_date: newDate || null, due_time: newTime || null }, 'PATCH')
      renderQ(tq)
      sadhanaEditDlg.close()
    })
  }
  // Pre-fill the modal with the task's current values
  sadhanaEditDlg.dataset.tid = id
  sadhanaEditDlg.dataset.q = String(q)
  sadhanaEditDlg.querySelector('#se-input').value = task.title || ''
  sadhanaEditDlg.querySelector('#se-note').value = task.note || ''
  // Init recurrence UI in the modal
  const slot = 'se-modal'
  initRecur(slot, task.recur || false, task.recur_type || 'daily', task.recur_config || '')
  buildRecurUI('se-recur-ui', slot)
  // Init deadline state
  if (task.fuzzy) dlState[slot] = { type: 'fuzzy', val: task.fuzzy }
  else if (task.date) dlState[slot] = { type: 'exact', val: task.date, time: task.time || '' }
  else dlState[slot] = { type: 'none', val: '' }
  updateDLTrigger(slot)
  // Update the deadline label in the modal
  const dlLabel = sadhanaEditDlg.querySelector('#se-dl-label')
  if (dlLabel) {
    const cur = dlState[slot]
    if (cur.type === 'fuzzy') {
      const f = FUZZY.find(x => x.k === cur.val)
      dlLabel.textContent = f ? (lang === 'fa' ? f.fa : f.en) : cur.val
    } else if (cur.type === 'exact') {
      dlLabel.textContent = cur.val + (cur.time ? ' ' + cur.time : '')
    } else {
      dlLabel.textContent = lang === 'fa' ? 'بدون مهلت' : 'No deadline'
    }
  }
  sadhanaEditDlg.querySelector('#se-error').textContent = ''
  sadhanaEditDlg.showModal()
  setTimeout(() => sadhanaEditDlg.querySelector('#se-input').focus(), 50)
}
function cancelEdit(id) {
  // Legacy: the inline form is no longer shown, but this is kept for back-compat
  // (cardTap / keyboard shortcuts may call it). Now just closes the modal.
  if (sadhanaEditDlg) sadhanaEditDlg.close()
}
function saveEdit(id, q) {
  // Legacy: the modal's submit handler does the actual save now. This is kept for
  // back-compat (any code calling saveEdit directly) — it delegates to the modal submit.
  const form = sadhanaEditDlg?.querySelector('#se-form')
  if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}
function clearEditDL(slot){
  dlState[slot]={type:'none',val:''};
  updateDLTrigger(slot);
}

/* ══ TASK UPDATES (inline log) ═════════════════ */
function toggleUpdates(e,id){
  e.stopPropagation();
  const panel=document.getElementById(`upd-panel-${id}`);
  if(!panel)return;
  const opening=!panel.classList.contains('open');
  panel.classList.toggle('open');
  if(opening){const inp=document.getElementById(`upd-inp-${id}`);if(inp)setTimeout(()=>inp.focus(),50);}
}
function addUpdate(id,q){
  const inp=document.getElementById(`upd-inp-${id}`);if(!inp)return;
  const text=inp.value.trim();if(!text)return;
  /* Phase 7 item 2 — the "+" used to look DEAD on failure: the input was cleared
     BEFORE the POST resolved and any error (offline blip, expired session, note
     over the server's 500-char cap) was swallowed by api()'s catch. Now: the text
     stays until the row is actually painted, a toast explains the failure, the
     button is guarded while in flight, and a 401 routes to the login page. */
  if(text.length>500){
    inp.focus();
    return window.hibana?.toast(lang==='fa'?'یادداشت حداکثر ۵۰۰ نویسه است':'Notes are limited to 500 characters','err');
  }
  if(inp.dataset.inFlight==='1')return;
  inp.dataset.inFlight='1';
  const addBtn=document.querySelector(`#upd-panel-${id} .upd-add-btn`);
  if(addBtn)addBtn.disabled=true;
  fetch(`/api/sadhana/tasks/${id}/notes`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})})
    .then(async r=>{
      if(r.status===401){window.hibana?.toast(lang==='fa'?'نشست منقضی شده — دوباره وارد شوید':'Session expired — sign in again','err');setTimeout(()=>window.location.href='/login.html',900);return null;}
      const u=await r.json().catch(()=>null);
      if(!r.ok||!u||!u.id){
        window.hibana?.toast(lang==='fa'?'ذخیره نشد — دوباره تلاش کنید':"Couldn't save — try again.",'err');
        return null;
      }
      inp.value='';
      return u;
    })
    .catch(()=>{window.hibana?.toast(lang==='fa'?'ذخیره نشد — اتصال را بررسی کن':"Couldn't save — check your connection",'err');return null;})
    .then(u=>{
      if(!u)return;
      const task=[1,2,3,4].flatMap(qq=>tasks[qq]).find(x=>x.id===id);
      if(task){if(!task.updates)task.updates=[];task.updates.push({id:u.id,text:u.text||text,ts:u.ts||''});}
      /* paint the fresh row without a full re-render. (2026-09-02 fix: the API used to
         return only {ok,id} — `u.ts.slice` threw, so the just-added note never showed
         until a page refresh; the response now echoes text+ts.) */
      const list=document.getElementById(`upd-panel-${id}`)?.querySelector('.upd-list');
      if(list){
        list.querySelector('.upd-empty')?.remove();
        const row=document.createElement('div');
        row.className='upd-row';row.id=`upd-${u.id}`;
        row.innerHTML=updRowInner({id:u.id,text:u.text||text,ts:u.ts||''},id,q);
        list.appendChild(row);
      }
      /* update toggle count */
      const btn=document.getElementById(`tc-${id}`)?.querySelector('.upd-toggle');
      if(btn){const cnt=task?.updates?.length||0;btn.innerHTML=`<span class="upd-ico">📋</span>${cnt}`;btn.classList.add('has-notes');}
      inp.focus();
    })
    .finally(()=>{
      delete inp.dataset.inFlight;
      if(addBtn)addBtn.disabled=false;
    });
}
/* ── note EDIT (2026-09-02): ✎ turns a note row into an inline input; Enter/Esc or
   ✓/✕ commit/cancel. PATCH /api/sadhana/updates/:id does the server work. ── */
function updFind(uid,taskId){
  const t=[1,2,3,4].flatMap(qq=>tasks[qq]).find(x=>x.id===taskId);
  return t?.updates?.find(x=>x.id===uid);
}
function paintUpdRow(uid,taskId,q){
  const row=document.getElementById(`upd-${uid}`);if(!row)return;
  const u=updFind(uid,taskId);if(!u)return;
  row.innerHTML=updRowInner(u,taskId,q);
}
function startUpdEdit(uid,taskId,q){
  const row=document.getElementById(`upd-${uid}`);if(!row)return;
  const u=updFind(uid,taskId);if(!u)return;
  row.innerHTML=`<span class="upd-ts">${(u.ts||'').slice(0,10)}</span><input class="upd-edit-inp" id="upde-${uid}" value="${esc(u.text)}" maxlength="500" onkeydown="if(event.key==='Enter'){event.preventDefault();saveUpdEdit('${uid}','${taskId}',${q});}else if(event.key==='Escape'){cancelUpdEdit('${uid}','${taskId}',${q});}"><button class="upd-edit upd-save" onclick="saveUpdEdit('${uid}','${taskId}',${q})" title="${lang==='fa'?'ذخیره':'Save'}">✓</button><button class="upd-del" onclick="cancelUpdEdit('${uid}','${taskId}',${q})" title="${lang==='fa'?'لغو':'Cancel'}">✕</button>`;
  const inp=document.getElementById(`upde-${uid}`);if(inp){inp.focus();inp.select();}
}
function saveUpdEdit(uid,taskId,q){
  const inp=document.getElementById(`upde-${uid}`);if(!inp)return;
  const text=inp.value.trim();
  if(!text){inp.focus();return;}
  const u=updFind(uid,taskId);
  const prev=u?u.text:'';
  if(u)u.text=text;
  paintUpdRow(uid,taskId,q);
  api(`/api/sadhana/updates/${uid}`,{text},'PATCH').then(r=>{
    if(!r||!r.ok){
      if(u)u.text=prev;
      paintUpdRow(uid,taskId,q);
      window.hibana?.toast(lang==='fa'?'ذخیره نشد — دوباره تلاش کنید':"Couldn't save — try again.",'err');
    }
  });
}
function cancelUpdEdit(uid,taskId,q){paintUpdRow(uid,taskId,q);}
function delUpdate(uid,taskId,q){
  api(`/api/sadhana/notes/${uid}`, undefined, 'DELETE').then(()=>{
    const task=[1,2,3,4].flatMap(qq=>tasks[qq]).find(x=>x.id===taskId);
    if(task&&task.updates)task.updates=task.updates.filter(x=>x.id!==uid);
    const row=document.getElementById(`upd-${uid}`);
    if(row)row.remove();
    /* show empty msg if no more updates */
    const list=document.getElementById(`upd-panel-${taskId}`)?.querySelector('.upd-list');
    if(list&&!list.children.length){
      const emp=document.createElement('div');emp.className='upd-empty';
      emp.textContent=tr('noUpdates');list.appendChild(emp);
    }
    /* update toggle count */
    const btn=document.getElementById(`tc-${taskId}`)?.querySelector('.upd-toggle');
    if(btn){const cnt=task?.updates?.length||0;
      btn.innerHTML=`<span class="upd-ico">📋</span>${cnt||'+'}`;
      btn.classList.toggle('has-notes',cnt>0);
    }
  });
}

/* ══ CRUD ══════════════════════════════════════ */
function softDel(id,q){
  const task=tasks[q].find(x=>x.id===id);if(!task)return;
  /* push to undo stack */
  undoStack.push({task:JSON.parse(JSON.stringify(task)),q});
  const el=document.getElementById(`tc-${id}`);
  if(el){el.classList.add('removing');setTimeout(()=>{task.deleted=true;renderQ(q);if(zenQ===q)renderZen();},350);}
  api(`/api/sadhana/tasks/${id}`, undefined, 'DELETE');
  showUndoToast();
}
function togglePin(e,id,q){
  e.stopPropagation();
  const task=tasks[q].find(x=>x.id===id);if(!task)return;
  task.pinned=!task.pinned;
  renderQ(q);if(zenQ===q)renderZen();
  api(`/api/sadhana/tasks/${id}`, { pinned: task.pinned }, 'PATCH');
}
function togDone(id,q){
  const task=tasks[q].find(x=>x.id===id);if(!task)return;
  if(!task.done){
    task.done=true;
    // Completing archives the task instantly (server stamps cleared_at, 2026-08-29):
    // non-recurring cards leave the board right away with a confirmation toast;
    // recurring tasks stay in the quadrant's "completed" section until they reopen.
    if(!task.recur){
      tasks[q]=tasks[q].filter(x=>x.id!==id);
      const t=lang==='fa'
        ?'✅ '+esc(task.title)+' — به آرشیو رفت'
        :'✅ '+esc(task.title)+' — moved to Archive';
      window.hibana?.toast(t,'info',4000);
    }
    renderQ(q);if(zenQ===q)renderZen();
    api(`/api/sadhana/tasks/${id}/complete`, {});
  }else{
    task.done=false;
    renderQ(q);if(zenQ===q)renderZen();
    api(`/api/sadhana/tasks/${id}/uncomplete`, {});
  }
}
function showForm(q){
  document.getElementById(`ab-${q}`).style.display='none';
  document.getElementById(`af-${q}`).classList.add('vis');
  document.getElementById(`ce-${q}`).textContent='📌';
  formTags[q]=[]; /* Phase 6 item 13: fresh label set per task */
  const ftp=document.getElementById(`ftp-${q}`);
  if(ftp){ftp.hidden=true;ftp.innerHTML='';}
  const ftb=document.getElementById(`ftb-${q}`);
  if(ftb)ftb.setAttribute('aria-expanded','false');
  document.getElementById(`ti-${q}`).focus();
}
/* Phase 6 item 13: reveal/collapse the label picker inside the quick form. */
function togFormTags(q){
  const ftp=document.getElementById(`ftp-${q}`);
  const ftb=document.getElementById(`ftb-${q}`);
  if(!ftp)return;
  ftp.hidden=!ftp.hidden;
  if(!ftp.hidden&&!ftp.innerHTML)buildTagPicker(`ftp-${q}`,q);
  if(ftb)ftb.setAttribute('aria-expanded',String(!ftp.hidden));
}
function hideForm(q){
  document.getElementById(`ab-${q}`).style.display='';
  document.getElementById(`af-${q}`).classList.remove('vis');
  document.getElementById(`ti-${q}`).value='';
  document.getElementById(`ce-${q}`).textContent='📌';
  formTags[q]=[];
  const ftp=document.getElementById(`ftp-${q}`);
  if(ftp){ftp.hidden=true;ftp.innerHTML='';}
}
function fKey(e,q){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addTask(q);}if(e.key==='Escape')hideForm(q);}
/* (l) 2026-09-06: in-flight add guard — Ali's "each add lands two times". A double-tap
   / ghost click / Enter+click while the POST was still in flight re-read the
   still-filled textarea and fired a SECOND identical POST (prod D1 carries pairs of
   duplicate rows created 2–21ms apart). One add per form until the server answers:
   the textarea is cleared the moment the request leaves, so any second event reads
   an empty input; the text is restored if the request fails. */
const addingTask={};
function addTask(q){
  if(addingTask[q])return;
  const ta=document.getElementById(`ti-${q}`);
  const v=ta.value.trim();if(!v)return;
  const emoji=document.getElementById(`ce-${q}`).textContent;
  const body={quadrant:q,emoji,title:v,tags:[...formTags[q]]}; /* item 13: labels ride the quick add too */
  addingTask[q]=true;ta.value='';
  api('/api/sadhana/tasks',body).then(res=>{
    addingTask[q]=false;
    if(!res||!res.ok){ta.value=v;ta.focus();return;}
    revealIfHidden(q);
    const pos=tasks[q].length?Math.max(...tasks[q].map(t=>t.pos||0))+1:0;
    tasks[q].push({id:res.id,emoji,title:v,fuzzy:'',date:'',time:'',tags:[...formTags[q]],done:false,deleted:false,pinned:false,pos,progress:'untouched',note:'',recur:false,recur_type:'',recur_config:'',updates:[]});
    hideForm(q);renderQ(q);updateFilterCount();if(zenQ===q)renderZen();
  });
}

/* ══ UNDO ══════════════════════════════════════ */
function showUndoToast(){
  const toast=document.getElementById('undoToast');
  document.getElementById('undoMsg').textContent=tr('undoMsg');
  document.getElementById('undoBtn').textContent=tr('undo');
  toast.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer=setTimeout(()=>{toast.classList.remove('show');undoStack=[];},5000);
}
function undoDelete(){
  if(!undoStack.length)return;
  const{task,q}=undoStack.pop();
  task.deleted=false;
  /* restore in local state */
  const existing=tasks[q].find(x=>x.id===task.id);
  if(existing)existing.deleted=false;
  else tasks[q].push(task);
  /* restore in DB via the undelete endpoint */
  api(`/api/sadhana/tasks/${task.id}/restore`, {});
  renderQ(q);updateFilterCount();
  document.getElementById('undoToast').classList.remove('show');
  clearTimeout(undoTimer);
}
/* Ctrl+Z */
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='z'&&undoStack.length){
    e.preventDefault();undoDelete();
  }
});

/* ══ QUICK ADD MODAL ═══════════════════════════ */
function openQA(q){
  formTags.m=[];
  dlState.m={type:'none',val:''};updateDLTrigger('m');
  initRecur('m');
  document.getElementById('mep').textContent='📌';
  document.getElementById('mInp').value='';
  document.getElementById('mNote').value='';
  if(q){document.getElementById('mQ').value=q;}
  document.getElementById('mTitle').textContent=tr('quickAdd');
  document.getElementById('mLblTask').textContent=tr('task');
  document.getElementById('mLblQ').textContent=tr('quadrant');
  document.getElementById('mCancel').textContent=tr('cancel');
  document.getElementById('mSubmit').textContent=tr('addTask');
  document.getElementById('mInp').placeholder=`${tr('addTaskBtn')}…`;
  document.getElementById('mNote').placeholder=lang==='fa'?'یادداشت (اختیاری)…':'Note (optional)…';
  /* always show all fields in modal */
  buildTagPicker('mTags','m');
  updateDLTrigger('m');
  if(!recurState['m'])initRecur('m');
  buildRecurUI('mRecurUI','m');
  document.getElementById('mLblTags').textContent=tr('tags');
  document.getElementById('mLblDL').textContent=tr('deadline');
  document.getElementById('mLblRecur').textContent=tr('recurLbl');
  document.getElementById('qaModal').classList.add('open');
  setTimeout(()=>document.getElementById('mInp').focus(),50);
}
function addFromModal(){
  if(addingTask.m)return;
  const inp=document.getElementById('mInp');
  const v=inp.value.trim();if(!v)return;
  const q=parseInt(document.getElementById('mQ').value);
  const emoji=document.getElementById('mep').textContent;
  const s=dlState.m;
  const note=document.getElementById('mNote').value.trim();
  const tags=[...formTags.m];
  const rd=getRecurData('m');
  addingTask.m=true;inp.value='';
  api('/api/sadhana/tasks',{quadrant:q,emoji,title:v,fuzzy:s.type==='fuzzy'?s.val:null,due_date:s.type==='exact'?s.val:null,due_time:s.type==='exact'?(s.time||null):null,tags,note,...rd}).then(res=>{
    addingTask.m=false;
    if(!res||!res.ok){inp.value=v;inp.focus();return;}
    revealIfHidden(q);
    const pos=tasks[q].length?Math.max(...tasks[q].map(t=>t.pos||0))+1:0;
    tasks[q].push({id:res.id,emoji,title:v,fuzzy:s.type==='fuzzy'?s.val:'',date:s.type==='exact'?s.val:'',time:s.type==='exact'?(s.time||''):'',tags,done:false,deleted:false,pinned:false,pos,progress:'untouched',note,recur:!!rd.recurring,recur_type:rd.recur_type||'',recur_config:rd.recur_config||'',updates:[]});
    document.getElementById('qaModal').classList.remove('open');
    renderQ(q);updateFilterCount();if(zenQ===q)renderZen();
  });
}

/* ══ ZEN MODE ══════════════════════════════════ */
function openZen(q){
  zenQ=q;const qDef=QUADS.find(x=>x.id===q);
  document.getElementById('zenCard').style.borderTop=`3px solid ${qDef.col}`;
  document.getElementById('zenHeader').innerHTML=`
    <div class="zen-big">${quadSym(qDef)}</div>
    <div class="zen-title-block">
      <div class="zen-title">${esc(qDef[lang].title)}</div>
      <div class="zen-sub">${esc(qDef[lang].sub)}</div>
    </div>
    <button class="zen-close" onclick="closeZen()">✕</button>`;
  renderZen();
  /* zen add form */
  document.getElementById('zenFooter').innerHTML=`
    <button class="add-btn q${q}" onclick="showZenForm(${q})" id="zab-${q}">＋ ${tr('addTaskBtn')}</button>
    <div class="add-form" id="zaf-${q}">
      <div class="emo-row"><span class="ch-emo" id="zce-${q}" onclick="openEP('zenform',${q})">📌</span><span class="emo-hint">${tr('tapEmoji')}</span></div>
      <textarea class="ai" id="zti-${q}" rows="2" placeholder="${tr('addTaskBtn')}…" onkeydown="zfKey(event,${q})"></textarea>
      <div><label class="form-lbl">${tr('tags')}</label><div class="tag-picker" id="zftp-${q}"></div></div>
      <div><label class="form-lbl">${tr('deadline')}</label>
        <button class="dl-trigger" id="zdlt-${q}" onclick="openDLP('z${q}',this)">
          <span class="dl-trigger-ico">📅</span>
          <span id="zdltl-${q}">${tr('noDeadline')}</span>
        </button>
      </div>
      <div class="form-acts">
        <button class="btn" style="font-size:11.5px;padding:5px 10px" onclick="hideZenForm(${q})">${tr('cancel')}</button>
        <button class="btn zen-add-btn" data-zen-q="${q}" style="font-size:11.5px;padding:5px 10px" onclick="addTaskZen(${q})">${tr('add')}</button>
      </div>
    </div>`;
  dlState[`z${q}`]={type:'none',val:''};
  document.getElementById('zenOv').classList.add('open');
  document.getElementById('zenCard').classList.add('open');
}
function renderZen(){if(zenQ===null)return;renderQ(zenQ,document.getElementById('zenBody'));}
function showZenForm(q){
  document.getElementById(`zab-${q}`).style.display='none';
  document.getElementById(`zaf-${q}`).classList.add('vis');
  formTags[q]=[];buildTagPicker(`zftp-${q}`,q);
  dlState[`z${q}`]={type:'none',val:''};updateDLTrigger(`z${q}`);
  document.getElementById(`zti-${q}`).focus();
}
function hideZenForm(q){document.getElementById(`zab-${q}`).style.display='';document.getElementById(`zaf-${q}`).classList.remove('vis');document.getElementById(`zti-${q}`).value='';}
function zfKey(e,q){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();addTaskZen(q);}if(e.key==='Escape')hideZenForm(q);}
/* (l): same in-flight guard as the board form — the zen overlay shares the double-fire
   bug class (double-tap on «افزودن» while the POST is in flight). */
function addTaskZen(q){
  if(addingTask['z'+q])return;
  const ta=document.getElementById(`zti-${q}`);
  const v=ta.value.trim();if(!v)return;
  const emoji=document.getElementById(`zce-${q}`).textContent;
  const s=dlState[`z${q}`]||{type:'none',val:''};
  addingTask['z'+q]=true;ta.value='';
  api('/api/sadhana/tasks',{quadrant:q,emoji,title:v,fuzzy:s.type==='fuzzy'?s.val:null,due_date:s.type==='exact'?s.val:null,due_time:s.type==='exact'?(s.time||null):null,tags:[...formTags[q]]}).then(res=>{
    addingTask['z'+q]=false;
    if(!res||!res.ok){ta.value=v;ta.focus();return;}
    const pos=tasks[q].length?Math.max(...tasks[q].map(t=>t.pos||0))+1:0;
    tasks[q].push({id:res.id,emoji,title:v,fuzzy:s.type==='fuzzy'?s.val:'',date:s.type==='exact'?s.val:'',time:s.type==='exact'?(s.time||''):'',tags:[...formTags[q]],done:false,deleted:false,pinned:false,pos,progress:'untouched',note:'',recur:false,recur_type:'',recur_config:'',updates:[]});
    hideZenForm(q);renderZen();renderQ(q);updateFilterCount();
  });
}
function closeZen(){document.getElementById('zenOv').classList.remove('open');document.getElementById('zenCard').classList.remove('open');zenQ=null;}

/* ══ DRAG ══════════════════════════════════════ */
/* ══ DRAG & DROP ════════════════════════════════ */

function onDS(e,id,q){
  dragId=id;dragFrom=q;
  setTimeout(()=>{const el=document.getElementById(`tc-${id}`);if(el)el.classList.add('dragging');},0);
  e.dataTransfer.effectAllowed='move';
}
function onDE(){
  // Clean up all indicators
  document.querySelectorAll('.drag-target-above,.drag-target-below,.dragging').forEach(el=>{
    el.classList.remove('drag-target-above','drag-target-below','dragging');
  });
  dragId=null;dragFrom=null;dragOverCard=null;
}

// Quadrant body drag-over (for cross-quadrant drop target highlight)
function onDO(e,q){
  e.preventDefault();
  document.getElementById(`Q${q}`).classList.add('drag-over');
}
function onDL(){
  document.querySelectorAll('.quadrant').forEach(el=>el.classList.remove('drag-over'));
}

// Card-level drag-over: show above/below indicator
function onDOCard(e,targetId){
  if(!dragId||dragId===targetId)return;
  e.preventDefault();e.stopPropagation();
  const card=document.getElementById(`tc-${targetId}`);if(!card)return;
  const rect=card.getBoundingClientRect();
  const midY=rect.top+rect.height/2;
  // Clear previous
  document.querySelectorAll('.drag-target-above,.drag-target-below').forEach(el=>{
    el.classList.remove('drag-target-above','drag-target-below');
  });
  if(e.clientY<midY) card.classList.add('drag-target-above');
  else               card.classList.add('drag-target-below');
  dragOverCard={id:targetId,above:e.clientY<midY};
}
function onDLCard(e,targetId){
  const card=document.getElementById(`tc-${targetId}`);if(card){
    card.classList.remove('drag-target-above','drag-target-below');
  }
}

// Drop on a card: reorder within quadrant OR move to quadrant
function onDropCard(e,targetId,tq){
  e.preventDefault();e.stopPropagation();
  document.querySelectorAll('.drag-target-above,.drag-target-below,.drag-over,.dragging').forEach(el=>{
    el.classList.remove('drag-target-above','drag-target-below','drag-over','dragging');
  });
  if(!dragId||dragId===targetId)return;

  if(dragFrom===tq){
    /* Same quadrant: manual SORT (2026-09-02 user request). The insert index is
       recomputed AFTER the removal — the old fixed-index math landed cards one slot
       off when dragging downwards — and the PINNED block is protected: pinned cards
       always stay on top, unpinned cards can never be dropped above them. */
    const open=tasks[tq].filter(x=>!x.deleted&&!x.done)
      .sort((a,b)=>((b.pinned?1:0)-(a.pinned?1:0))||((a.pos||0)-(b.pos||0)));
    const fromIdx=open.findIndex(x=>x.id===dragId);
    if(fromIdx===-1)return;
    const above=dragOverCard&&dragOverCard.id===targetId?dragOverCard.above:true;
    const [moved]=open.splice(fromIdx,1);
    let insertAt=open.findIndex(x=>x.id===targetId);
    if(insertAt===-1)insertAt=open.length;
    if(!above)insertAt+=1;
    /* clamp: unpinned → never above the pinned block; pinned → never below it */
    const firstUnpinned=open.findIndex(x=>!x.pinned);
    if(!moved.pinned){
      if(firstUnpinned!==-1&&insertAt<firstUnpinned)insertAt=firstUnpinned;
      if(firstUnpinned===-1)insertAt=open.length;
    }else if(firstUnpinned!==-1&&insertAt>firstUnpinned){
      insertAt=firstUnpinned;
    }
    open.splice(insertAt,0,moved);
    open.forEach((t,i)=>{t.pos=i;});
    tasks[tq]=[...open,...tasks[tq].filter(x=>x.deleted||x.done)];
    renderQ(tq);
    api('/api/sadhana/tasks/reorder', { quadrant: tq, ids: open.map((x) => x.id) });
  } else {
    // Cross-quadrant move
    const task=tasks[dragFrom].find(x=>x.id===dragId);
    if(task){
      tasks[dragFrom]=tasks[dragFrom].filter(x=>x.id!==dragId);
      task.quadrant=tq;
      tasks[tq].push(task);
      renderQ(dragFrom);renderQ(tq);
      api(`/api/sadhana/tasks/${dragId}/move`, { quadrant: tq });
    }
  }
  dragId=null;dragFrom=null;dragOverCard=null;
}

// Drop on quadrant body (cross-quadrant only, when not dropped on a card)
function onDrop(e,tq){
  e.preventDefault();
  document.querySelectorAll('.quadrant').forEach(el=>el.classList.remove('drag-over'));
  if(!dragId||dragFrom===tq)return;
  const task=tasks[dragFrom].find(x=>x.id===dragId);
  if(task){
    tasks[dragFrom]=tasks[dragFrom].filter(x=>x.id!==dragId);
    task.quadrant=tq;
    tasks[tq].push(task);
    renderQ(dragFrom);renderQ(tq);
    api(`/api/sadhana/tasks/${dragId}/move`, { quadrant: tq });
  }
  dragId=null;dragFrom=null;dragOverCard=null;
}

/* ══ EMOJI PICKER (Phase 6 item 2 — full standard library) ══════
   The page-level EC (8 curated categories, ~200 emojis) is retired: openEP now opens
   the shared /js/emoji-picker.js dialog (1100+ emojis, eight standard categories,
   bilingual keyword search + a recent-picks row). pickE keeps the same target
   dispatch (form / zenform / modal / quad / task) — every existing call site is
   unchanged. */
function openEP(type,q,tid){
  epTgt={type,q,tid};
  const trigger=window.event?.target;
  let cur='📌';
  try{
    if(type==='form'&&document.getElementById(`ce-${q}`))cur=document.getElementById(`ce-${q}`).textContent;
    else if(type==='zenform'&&document.getElementById(`zce-${q}`))cur=document.getElementById(`zce-${q}`).textContent;
    else if(type==='modal'&&document.getElementById('mep'))cur=document.getElementById('mep').textContent;
    else if(type==='quad'&&document.getElementById('qeEmo'))cur=document.getElementById('qeEmo').textContent;
    else if(type==='task'){const t=tasks[q]?.find(x=>x.id===tid);if(t&&t.emoji)cur=t.emoji;}
  }catch(e){}
  window.hibanaEmojiPicker?.open({
    anchor:trigger instanceof Element?trigger:null,
    current:cur,
    onPick:(e)=>pickE(e),
  });
}
function closeEP(){window.hibanaEmojiPicker?.close();}
function pickE(e){
  if(!epTgt)return;const{type,q,tid}=epTgt;
  epTgt=null;
  if(type==='form')document.getElementById(`ce-${q}`).textContent=e;
  else if(type==='zenform')document.getElementById(`zce-${q}`).textContent=e;
  else if(type==='modal')document.getElementById('mep').textContent=e;
  else if(type==='quad'){qeEmoji=e;qeEmojiTouched=true;const b=document.getElementById('qeEmo');if(b)b.textContent=e;}
  else if(type==='task'){const task=tasks[q].find(x=>x.id===tid);if(task){task.emoji=e;renderQ(q);}api(`/api/sadhana/tasks/${tid}`, { emoji: e }, 'PATCH');}
}

/* ══ RECURRING UI ═══════════════════════════════ */
/*
  recurState keyed by slot ('m' for modal, task.id string for edit forms).
  {on:bool, type:'daily'|'weekly'|'ndays'|'monthly', days:string}
  - weekly:  days = comma-separated Python weekday nums (Mon=0…Sun=6)
  - ndays:   days = integer string e.g. "5"
  - monthly: days = day-of-month string e.g. "15"
*/
let recurState={};

/* Weekday definitions — Python weekday() numbers, displayed in locale order */
const WD_EN=[{n:0,lbl:'Mo'},{n:1,lbl:'Tu'},{n:2,lbl:'We'},{n:3,lbl:'Th'},{n:4,lbl:'Fr'},{n:5,lbl:'Sa'},{n:6,lbl:'Su'}];
const WD_FA=[{n:5,lbl:'ش'},{n:6,lbl:'ی'},{n:0,lbl:'د'},{n:1,lbl:'س'},{n:2,lbl:'چ'},{n:3,lbl:'پ'},{n:4,lbl:'ج'}];

function initRecur(slot, on=false, type='daily', days=''){
  recurState[slot]={on,type,days};
}

function buildRecurUI(containerId, slot){
  const el=document.getElementById(containerId);if(!el)return;
  if(!recurState[slot])initRecur(slot);
  const s=recurState[slot];
  const switchId=`rswitch-${slot}`;

  let html=`<div class="recur-toggle-row">
    <label class="recur-switch">
      <input type="checkbox" id="${switchId}" ${s.on?'checked':''} onchange="togRecur('${slot}','${containerId}')">
      <span class="recur-slider"></span>
    </label>
    <span class="recur-toggle-lbl" onclick="document.getElementById('${switchId}').click()">
      ${s.on?tr('recurring'):tr('recurOff')}
    </span>
  </div>`;

  if(s.on){
    const types=['daily','weekly','ndays','monthly'];
    html+=`<div class="recur-config">
      <div class="recur-type-grid">
        ${types.map(t=>`<button class="recur-type-btn${s.type===t?' sel':''}" onclick="setRecurType('${slot}','${containerId}','${t}')">${tr(t)}</button>`).join('')}
      </div>
      <div class="recur-sub" id="rsub-${slot}">${buildRecurSub(slot)}</div>
    </div>`;
  }
  el.innerHTML=html;
}

function buildRecurSub(slot){
  const s=recurState[slot];
  if(!s||!s.on)return'';

  if(s.type==='daily'){
    return`<span class="recur-n-lbl" style="color:var(--accent);font-size:11px">🔄 ${lang==='fa'?'هر روز ریست می‌شود':'Resets every day at midnight'}</span>`;
  }

  if(s.type==='weekly'){
    const wdays=lang==='fa'?WD_FA:WD_EN;
    const sel=s.days?s.days.split(',').map(Number):[];
    return`<div>
      <div class="recur-n-lbl" style="margin-bottom:5px">${tr('selectDays')}:</div>
      <div class="recur-day-grid">
        ${wdays.map(d=>`<button class="recur-day-btn${sel.includes(d.n)?' sel':''}" onclick="togWeekday('${slot}',${d.n})">${d.lbl}</button>`).join('')}
      </div>
    </div>`;
  }

  if(s.type==='ndays'){
    const n=s.days||'7';
    return`<div class="recur-n-row">
      <span class="recur-n-lbl">${lang==='fa'?'هر':'Every'}</span>
      <input class="recur-n-input" type="number" min="1" max="365" value="${n}"
        id="rndays-${slot}" oninput="setRecurDays('${slot}',this.value)">
      <span class="recur-n-lbl">${tr('daysLabel')}</span>
    </div>`;
  }

  if(s.type==='monthly'){
    const d=s.days||'1';
    return`<div class="recur-n-row">
      <span class="recur-n-lbl">${tr('dayOfMonth')}:</span>
      <input class="recur-n-input" type="number" min="1" max="31" value="${d}"
        id="rmonth-${slot}" oninput="setRecurDays('${slot}',this.value)">
    </div>`;
  }
  return'';
}

function togRecur(slot, containerId){
  if(!recurState[slot])initRecur(slot);
  recurState[slot].on=!recurState[slot].on;
  if(!recurState[slot].days&&recurState[slot].type==='ndays')recurState[slot].days='7';
  if(!recurState[slot].days&&recurState[slot].type==='monthly')recurState[slot].days='1';
  buildRecurUI(containerId,slot);
}

function setRecurType(slot, containerId, type){
  if(!recurState[slot])initRecur(slot,true);
  recurState[slot].type=type;
  /* set sensible defaults */
  if(type==='ndays'&&!recurState[slot].days)recurState[slot].days='7';
  if(type==='monthly'&&!recurState[slot].days)recurState[slot].days='1';
  if(type==='weekly')recurState[slot].days='';
  if(type==='daily')recurState[slot].days='';
  buildRecurUI(containerId,slot);
}

function togWeekday(slot, num){
  if(!recurState[slot])return;
  let days=recurState[slot].days?recurState[slot].days.split(',').map(Number).filter(x=>!isNaN(x)):[];
  const idx=days.indexOf(num);
  if(idx>-1)days.splice(idx,1);else days.push(num);
  days.sort((a,b)=>a-b);
  recurState[slot].days=days.join(',');
  /* just re-render sub without full rebuild */
  const sub=document.getElementById(`rsub-${slot}`);
  if(sub)sub.innerHTML=buildRecurSub(slot);
}

function setRecurDays(slot, val){
  if(!recurState[slot])return;
  recurState[slot].days=String(parseInt(val)||1);
}

function getRecurData(slot){
  const s=recurState[slot];
  if(!s||!s.on)return{recurring:false,recur_type:null,recur_config:''};
  let days=s.days||'';
  /* validate ndays/monthly */
  if(s.type==='ndays'){const n=parseInt(days);days=isNaN(n)||n<1?'1':String(n);}
  if(s.type==='monthly'){const n=parseInt(days);days=isNaN(n)||n<1?'1':n>31?'31':String(n);}
  return{recurring:true,recur_type:s.type,recur_config:days};
}

/* Descriptive badge label for a task */
function recurLabel(task){
  if(!task.recur)return'';
  const wdays=lang==='fa'?WD_FA:WD_EN;
  switch(task.recur_type){
    case'daily': return lang==='fa'?'🔄 روزانه':'🔄 Daily';
    case'weekly':{
      if(!task.recur_config)return lang==='fa'?'🔄 هفتگی':'🔄 Weekly';
      const nums=task.recur_config.split(',').map(Number);
      const labels=nums.map(n=>{const w=wdays.find(x=>x.n===n);return w?w.lbl:'?';});
      return`🔄 ${labels.join('·')}`;
    }
    case'ndays': return`🔄 ${lang==='fa'?'هر '+toFa(task.recur_config)+' روز':'Every '+task.recur_config+'d'}`;
    case'monthly': return`🔄 ${lang==='fa'?'روز '+toFa(task.recur_config):day_ordinal(task.recur_config)}`;
    default: return'🔄';
  }
}
function day_ordinal(n){const i=parseInt(n);const s=['th','st','nd','rd'];const v=i%100;return i+(s[(v-20)%10]||s[v]||s[0]);}

/* ══ PROGRESS — direct 3-dot state picker ═══════ */
function setProgress(e,id,q,state){
  e.stopPropagation();
  const task=tasks[q].find(x=>x.id===id);if(!task)return;
  /* Clicking the already-active state resets to untouched */
  task.progress=(task.progress===state&&state!=='untouched')?'untouched':state;
  renderQ(q);if(zenQ===q)renderZen();
  api(`/api/sadhana/tasks/${id}`, { progress: task.progress }, 'PATCH');
}

/* ══ MODAL ADVANCED TOGGLE ══════════════════════ */
function toggleAdvanced(){
  const adv=document.getElementById('mAdvanced');
  const tog=document.getElementById('mAdvToggle');
  if(!adv||!tog)return;
  const open=adv.style.display!=='none';
  adv.style.display=open?'none':'block';
  tog.textContent=open?tr('moreOptions'):tr('lessOptions');
  tog.setAttribute('aria-expanded',String(!open));
  if(!open){
    buildTagPicker('mTags','m');
    updateDLTrigger('m');
    if(!recurState['m'])initRecur('m');
    buildRecurUI('mRecurUI','m');
    /* update labels */
    document.getElementById('mLblTags').textContent=tr('tags');
    document.getElementById('mLblDL').textContent=tr('deadline');
    document.getElementById('mLblRecur').textContent=tr('recurLbl');
  }
}

/* ══ THEME ═════════════════════════════════════ */
function applyTheme(dark){
  document.documentElement.setAttribute('data-theme',dark?'dark':'light');
}
function updateThemeLabel(){
  const dark=document.documentElement.getAttribute('data-theme')==='dark';
  const ico=document.getElementById('themeIco');
  const lbl=document.getElementById('themeLabel');
  if(ico)ico.textContent=dark?'☀️':'🌙';
  if(lbl){
    if(lang==='fa') lbl.textContent=dark?'حالت روشن':'حالت تیره';
    else lbl.textContent=dark?'Light mode':'Dark mode';
  }
}
function toggleTheme(){const dark=document.documentElement.getAttribute('data-theme')==='dark';PREFS.theme=dark?'light':'dark';applyTheme(!dark);}

/* ══ LANG ══════════════════════════════════════ */
function setLang(l){
  lang=l;PREFS.lang=l;
  /* Calendar follows the language (server model: calendar_pref is derived from
     language_pref) — task dates and the header pill stay Jalali for FA users. */
  cal=l==='fa'?'j':'g';
  /* Hibana: language lives on the user record (multi-device). Fire-and-forget. */
  api('/api/settings',{language_pref:l},'PATCH');
  document.body.classList.toggle('rtl',l==='fa');
  /* lbEN/lbFA (the old header's inline language toggle) are gone — the unified
     Hibana topbar / More sheet owns language switching now. */
  const _lbEN=document.getElementById('lbEN');if(_lbEN)_lbEN.classList.toggle('active',l==='en');
  const _lbFA=document.getElementById('lbFA');if(_lbFA)_lbFA.classList.toggle('active',l==='fa');
  document.getElementById('addTaskBtn').textContent=tr('addTask');
  const _archLbl=document.getElementById('archiveLbl');
  if(_archLbl)_archLbl.textContent=l==='fa'?'آرشیو':'Archive';
  /* user menu labels */
  const umLang=document.getElementById('umLblLang');
  if(umLang)umLang.textContent=l==='fa'?'زبان':'Language';
  const signOutLbl=document.getElementById('signOutLbl');
  if(signOutLbl)signOutLbl.textContent=tr('signOut');
  updateThemeLabel();
  buildGrid();buildFilterBar();buildHeaderDate();buildModalQuads();buildQuadDots();
  document.title=lang==='fa'?'لیست کارها — هیبانا':'To-do list — Hibana';
}

/* ══ CALENDAR ══════════════════════════════════
   No manual toggle (2026-08-29 user request): the calendar system is DERIVED from the
   language — fa → Jalali/shamsi, en → Gregorian. setLang re-derives `cal` above. */
function updateDate(){
  /* Date now lives exclusively in the header pill — delegate to buildHeaderDate */
  buildHeaderDate();
}
function gregWeek(d){
  /* ISO 8601 week number — weeks start Monday */
  const jan4=new Date(d.getFullYear(),0,4);
  const startOfW1=new Date(jan4);startOfW1.setDate(jan4.getDate()-(jan4.getDay()||7)+1);
  return Math.ceil(((d-startOfW1)/86400000+1)/7);
}

/* ══ USER MENU ═════════════════════════════════ */
function toggleUserMenu(e){
  if(e)e.stopPropagation();
  const w=document.getElementById('userMenuWrap');
  if(w)w.classList.toggle('open');
}
document.addEventListener('click',function(e){
  const w=document.getElementById('userMenuWrap');
  if(w&&w.classList.contains('open')&&!w.contains(e.target))
    w.classList.remove('open');
});


/* ══ HIBANA: modal quadrant options (server names) ═══════════ */
function buildModalQuads(){
  const sel=document.getElementById('mQ');if(!sel)return;
  sel.innerHTML=QUADS.map(q=>`<option value="${q.id}">${quadEmoji(q)} Q${q.id} — ${lang==='fa'?q.name.fa:q.name.en}</option>`).join('');
}

/* ══ ARCHIVE OVERLAY (in-page view) ═══════════════════════════ */
async function openArchive(){
  const ov=document.getElementById('archOv');
  ov.classList.add('open');
  const isFA=lang==='fa';
  document.getElementById('archTitle').textContent=isFA?'🗄️ آرشیو وظایف':'🗄️ Task Archive';
  document.getElementById('archClose').textContent=isFA?'✕ بستن':'✕ Close';
  const body=document.getElementById('archBody');
  body.innerHTML='<div class="arch-empty">'+(isFA?'بارگذاری…':'Loading…')+'</div>';
  const data=await fetch('/api/sadhana/archive').then(r=>r.ok?r.json():null).catch(()=>null);
  if(!data){body.innerHTML='<div class="arch-empty">'+(isFA?'خطا در بارگذاری':'Failed to load')+'</div>';return;}
  let h='<div class="arch-stats">';
  for(const q of data.byQuadrant){
    /* Phase 6 item 11: the Q1–Q4 prefixes are gone — the quadrant concept changed. */
    h+='<span class="arch-stat">'+esc(q.name)+': <b>'+(isFA?toFa(q.count):q.count)+'</b></span>';
  }
  h+='<span class="arch-stat">'+(isFA?'کل':'Total')+': <b>'+(isFA?toFa(data.total):data.total)+'</b></span></div>';
  for(const q of data.byQuadrant){
    const rows=(data.tasks||[]).filter(t=>t.quadrant===q.id);
    h+='<div class="arch-group"><h4>'+esc(q.name)+' — '+(isFA?toFa(rows.length):rows.length)+'</h4>';
    if(!rows.length){
      h+='<div class="arch-empty">'+(isFA?'هنوز کاری بایگانی نشده':'No completed tasks yet')+'</div></div>';
      continue;
    }
    for(const r of rows){
      const tags=(r.tags||[]).map(tid=>{const tg=TAGS.find(x=>x.id===tid);return tg?'<span title="'+(isFA?tg.fa:tg.en)+'">'+tg.ico+'</span>':''}).join('');
      h+='<div class="arch-task"><span>'+esc(r.emoji||'📌')+'</span><b>'+esc(r.title)+'</b>'
        +(r.recurring?'<span class="recur-badge">'+(isFA?'تکرارشونده':'Recurring')+'</span>':'')
        +(tags?'<span class="at-tags">'+tags+'</span>':'')
        +'<button type="button" class="arch-restore" onclick="archRestore(\''+r.id+'\')" title="'+(isFA?'برگرداندن به تابلو':'Put back on the board')+'">↩ '+(isFA?'بازگردانی':'Restore')+'</button>'
        +'<button type="button" class="arch-delete" data-arch-del="'+r.id+'" onclick="archDelete(\''+r.id+'\')" title="'+tr('delFromArchive')+'" aria-label="'+tr('delFromArchive')+'">🗑</button>'
        +'</div>';
    }
    h+='</div>';
  }
  if((data.recurring||[]).length){
    h+='<div class="arch-recur"><h4>🔄 '+(isFA?'تکرارشونده — تاریخچه انجام':'Recurring — Completion Log')+'</h4>';
    for(const r of data.recurring){
      h+='<div class="arch-ritem"><span>'+esc(r.emoji||'📌')+'</span><b>'+esc(r.title)+'</b>'
        +'<span class="recur-badge">✓ '+(isFA?toFa(r.count)+' بار':r.count+'×')+'</span>'
        /* Phase 6 item 10: recurring archives are deletable too — clears this task's
           sadhana_recur_history rows; the task itself stays on the board. */
        +'<button type="button" class="arch-delete" data-arch-recur-del="'+r.id+'" onclick="archRecurDelete(\''+r.id+'\')" title="'+(isFA?'حذف تاریخچهٔ این تکرارشونده':'Delete this recurring history')+'" aria-label="'+(isFA?'حذف تاریخچهٔ تکرارشونده':'Delete recurring history')+'">🗑</button>'
        +'</div>';
      if((r.dates||[]).length){
        h+='<div class="arch-rdates">'+r.dates.map(d=>'<span class="arch-rdate">'+esc(formatStoredDate(d))+'</span>').join('')+'</div>';
      }
    }
    h+='</div>';
  }
  body.innerHTML=h;
}
function closeArchive(){document.getElementById('archOv').classList.remove('open');}
/* ↩ Restore: un-completes the task server-side (which also clears cleared_at) and
   reloads the archive view — the task reappears on the board immediately. */
async function archRestore(id){
  const btn=document.querySelector('.arch-restore[onclick*="'+id+'"]');
  if(btn)btn.disabled=true;
  try{
    const res=await fetch('/api/sadhana/tasks/'+id+'/uncomplete',{method:'POST'});
    if(!res.ok)throw new Error('restore failed');
    window.hibana?.toast(lang==='fa'?'↩ به تابلو برگشت':'↩ Back on the board','info',3000);
    reloadTasks(); // repaint the board underneath the overlay
    await openArchive();
  }catch{
    if(btn)btn.disabled=false;
    window.hibana?.toast(lang==='fa'?'بازگردانی ناموفق بود':'Restore failed','err');
  }
}
/* 🗑 Delete forever (batch s): HARD-deletes the task — the row and its journal
   (tags, updates, recurrence history) vanish completely; no undo by design.
   First click asks for confirmation (native confirm, bilingual via tr());
   on success the board + the whole archive view (stats + groups + total)
   refetch — same refresh pattern as archRestore. */
async function archDelete(id){
  if(!confirm(tr('delFromArchiveConfirm')))return;
  const btn=document.querySelector('.arch-delete[data-arch-del="'+id+'"]');
  if(btn)btn.disabled=true;
  try{
    const res=await fetch('/api/sadhana/tasks/'+id+'/hard',{method:'DELETE'});
    if(!res.ok)throw new Error('hard delete failed');
    window.hibana?.toast(lang==='fa'?'🗑 برای همیشه حذف شد':'🗑 Deleted for good','info',3000);
    reloadTasks(); // repaint the board underneath the overlay
    await openArchive(); // refetch — stats, groups + total all refresh
  }catch{
    if(btn)btn.disabled=false;
    window.hibana?.toast(lang==='fa'?'حذف ناموفق بود':'Delete failed','err');
  }
}

/* 🗑 Delete recurring HISTORY (Phase 6 item 10): the tasks archive could hard-delete
   plain tasks but a recurring task's completion log had no delete at all. This clears
   every sadhana_recur_history row for the task (ownership-checked server-side) — the
   recurring task itself stays on the board, only its archived history vanishes. */
async function archRecurDelete(taskId){
  if(!taskId)return;
  if(!confirm(lang==='fa'?'تاریخچهٔ انجام این کار تکرارشونده برای همیشه حذف شود؟ خود کار روی تابلو می‌ماند.':'Permanently delete this recurring task\'s completion history? The task itself stays on the board.'))return;
  const btn=document.querySelector('.arch-delete[data-arch-recur-del="'+taskId+'"]');
  if(btn)btn.disabled=true;
  try{
    const res=await fetch('/api/sadhana/recur-history/'+taskId,{method:'DELETE'});
    if(!res.ok)throw new Error('recur history delete failed');
    window.hibana?.toast(lang==='fa'?'🗑 تاریخچهٔ تکرارشونده حذف شد':'🗑 Recurring history deleted','info',3000);
    await openArchive();
  }catch{
    if(btn)btn.disabled=false;
    window.hibana?.toast(lang==='fa'?'حذف ناموفق بود':'Delete failed','err');
  }
}

/* ══ LOGOUT (Hibana session) ══════════════════════════════════ */
function doLogout(){
  api('/api/auth/logout',{}).then(()=>{location.href='/login.html';});
}

/* ══ ESC closes topmost surface ═══════════════════════════════ */
document.addEventListener('keydown',(e)=>{
  if(e.key!=='Escape')return;
  const dl=document.getElementById('dlPopup');
  if(dl&&dl.classList.contains('open')){closeDLP();return;}
  if(window.hibanaEmojiPicker?.isOpen()){closeEP();return;}
  const qe=document.getElementById('qePop');
  if(qe&&qe.classList.contains('open')){closeQEdit();return;}
  const qa=document.getElementById('qaModal');
  if(qa&&qa.classList.contains('open')){qa.classList.remove('open');return;}
  const ar=document.getElementById('archOv');
  if(ar&&ar.classList.contains('open')){closeArchive();return;}
  if(zenQ!==null){closeZen();return;}
});
window.addEventListener('resize',()=>{checkAllMore();});

/* ══ QUADS from the server payload ════════════════════════════ */
const Q_BADGES={
  1:{en:'🔄 Daily',fa:'🔄 روزانه'},
  3:{en:'⚡ Act now',fa:'⚡ همین الان'},
  2:{en:'🌱 No deadline',fa:'🌱 بدون ددلاین'},
  4:{en:'🫶 Heart matters',fa:'🫶 ارزش قلبی'},
};
/* SVG glyph set for quadrant symbols — the same 12 stroke glyphs the dashboard picker
   offers (paths mirror src/lib/html.ts). icon_id holds either a glyph id or a plain
   emoji (board picker, 2026-09-02); quadSym renders the right one. */
const Q_GLYPHS={
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="1"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  heart:'<path d="M20.5 8.8c0 5-8.5 11-8.5 11s-8.5-6-8.5-11A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.8Z"/>',
  flag:'<path d="M6 21V4"/><path d="M6 4h12l-2.6 4 2.6 4H6"/>',
  'folder-plus':'<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7Z"/><path d="M12 11v4M10 13h4"/>',
  calendar:'<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  book:'<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z"/><path d="M4 5.5v16M8 7h8M8 11h8"/>',
  idea:'<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4.2 12.6c.9.7 1.2 1.6 1.2 2.4h6c0-.8.3-1.7 1.2-2.4A7 7 0 0 0 12 2Z"/>',
  bell:'<path d="M18 8.5a6 6 0 0 0-12 0c0 6.5-2.5 7.8-2.5 9h17c0-1.2-2.5-2.5-2.5-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  mountain:'<path d="M3.5 20h17L14 5.5l-3.5 6L8.2 8.3 3.5 20Z"/>',
  leaf:'<path d="M4.5 19.5C4.5 10 10 4.5 19.5 4.5c0 9.5-5.5 15-15 15Z"/><path d="M4.5 19.5c4.5-7.5 9-12 13.5-13.5"/>',
};
function quadSym(q){
  const id=q.iconId;
  if(id&&Q_GLYPHS[id])return `<svg class="q-big-svg" viewBox="0 0 24 24" aria-hidden="true">${Q_GLYPHS[id]}</svg>`;
  return esc(id||q.icon);
}
/* Emoji-only symbol (native <select> options can't render SVG): custom emoji if set,
   else the quadrant's default emoji. */
function quadEmoji(q){return (q.iconId&&!Q_GLYPHS[q.iconId])?q.iconId:q.icon;}
function buildQuads(data){
  const order=(data.order&&data.order.length===4)?data.order:[1,3,2,4];
  const byId=Object.fromEntries((data.quads||[]).map(q=>[q.id,q]));
  QUADS=order.map(id=>{
    const q=byId[id]||{id,icon:'📌',icon_id:null,name_en:'Section '+id,name_fa:'بخش '+id,sub_en:'',sub_fa:''};
    const iconId=q.icon_id||null; // custom glyph id or emoji (null = default emoji)
    const big=iconId||q.icon;     // raw symbol: glyph id → SVG, else emoji text
    return {
      id:q.id,
      iconId,
      icon:q.icon,                  // default emoji (fallback when iconId is a glyph/null)
      big,
      col:'var(--q'+q.id+')',
      name:{en:q.name_en,fa:q.name_fa},
      sub:{en:q.sub_en,fa:q.sub_fa},
      badge:Q_BADGES[q.id]||{en:'',fa:''},
      /* Phase 6 item 11: no Q1–Q4 prefixes anywhere — just the (custom) quadrant name */
      en:{title:q.name_en,sub:q.sub_en,badge:(Q_BADGES[q.id]||{}).en||''},
      fa:{title:q.name_fa,sub:q.sub_fa,badge:(Q_BADGES[q.id]||{}).fa||''},
    };
  });
}

/* ══ QUADRANT RENAME + SYMBOL (2026-09-02) ══════════
   The ✎ pen (hover over a quadrant name) opens this popover: rename the quadrant and
   pick a new emoji symbol in one place. Saves via PATCH /api/sadhana/quadrants/:q and
   repaints the board. */
let qeQ=null,qeEmoji='',qeEmojiTouched=false,qeSubInitial=null;
function openQEdit(q,btn){
  const qDef=QUADS.find(x=>x.id===q);if(!qDef)return;
  qeQ=q;qeEmojiTouched=false;
  qeEmoji=quadEmoji(qDef);
  document.getElementById('qeEmo').textContent=qeEmoji;
  const pop=document.getElementById('qePop');
  const r=btn.getBoundingClientRect();
  pop.classList.add('open');document.getElementById('qeOv').classList.add('open');
  pop.style.top=Math.max(8,Math.min(r.bottom+8,window.innerHeight-220))+'px';
  pop.style.left=Math.max(8,Math.min(r.left,window.innerWidth-296))+'px';
  const inp=document.getElementById('qeName');
  inp.value=lang==='fa'?qDef.name.fa:qDef.name.en;
  /* Subheading (2026-08-29 user request): editable alongside the title — e.g.
     «امروز : کارهای روزانه ضروری». Prefilled with the current value (custom or the
     localized default); only sent when it actually changed (a name-only edit must
     not pin the default sub as a custom one). */
  const subInp=document.getElementById('qeSub');
  qeSubInitial=lang==='fa'?qDef.sub.fa:qDef.sub.en;
  subInp.value=qeSubInitial;
  subInp.placeholder=lang==='fa'?'زیرعنوان بخش…':'Quadrant subheading…';
  document.getElementById('qeSave').textContent=lang==='fa'?'ذخیره':'Save';
  document.getElementById('qeCancel').textContent=lang==='fa'?'انصراف':'Cancel';
  inp.focus();inp.select();
}
function closeQEdit(){
  document.getElementById('qePop').classList.remove('open');
  document.getElementById('qeOv').classList.remove('open');
  qeQ=null;
}
async function saveQEdit(){
  if(qeQ===null)return;
  const name=document.getElementById('qeName').value.trim();
  if(!name){document.getElementById('qeName').focus();return;}
  const body={name};
  if(qeEmojiTouched)body.icon_id=qeEmoji; // only re-symbol when the user actually picked one
  const sub=document.getElementById('qeSub').value.trim();
  if(qeSubInitial!==null&&sub!==qeSubInitial)body.subtitle=sub; // subheading only when edited
  try{
    const res=await fetch(`/api/sadhana/quadrants/${qeQ}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!res.ok)throw new Error('save failed');
    closeQEdit();
    window.hibana?.toast(lang==='fa'?'✅ بخش به‌روز شد':'✅ Quadrant updated','info');
    await reloadTasks();
    buildGrid();buildFilterBar();buildHeaderDate();buildModalQuads();buildQuadDots();
  }catch{
    window.hibana?.toast(lang==='fa'?'ذخیره نشد — دوباره تلاش کنید':"Couldn't save — try again.",'err');
  }
}
document.getElementById('qeName')?.addEventListener('keydown',(e)=>{
  if(e.key==='Enter'){e.preventDefault();saveQEdit();}
  if(e.key==='Escape'){e.stopPropagation();closeQEdit();}
});

/* ══ INIT — auth guard + board fetch + paint ══════════════════ */
/* Re-fetches the board payload into `tasks` and repaints the grid. init() uses it for
   the first paint; archRestore() reuses it so a task restored from the Archive
   reappears on the board without a page reload. Returns false on fetch failure. */
async function reloadTasks(){
  const data=await fetch('/api/sadhana').then(r=>r.ok?r.json():null).catch(()=>null);
  if(!data){
    const g=document.getElementById('matGrid');
    if(g)g.innerHTML='<div class="sadhana-loading">'+(lang==='fa'?'بارگذاری ناموفق — صفحه را تازه کنید':'Failed to load — refresh the page')+'</div>';
    return false;
  }
  buildQuads(data);
  tasks={1:[],2:[],3:[],4:[]};
  for(const q of [1,2,3,4]){
    const rows=(data.tasks&&data.tasks[String(q)])||[];
    tasks[q]=rows.map(t=>({...t,deleted:false,pinned:!!t.pinned,done:!!t.done,recur:!!t.recur,
      tags:t.tags||[],updates:t.updates||[],pos:t.pos||0}));
  }
  renderAll();
  return true;
}
/* Live-refresh hook (2026-09-02 user request): the FAB «کار جدید» dialog (app.js)
   POSTs straight to the API; without this the board only picked the new task up
   after a manual page refresh. app.js calls it after a successful add. */
window.hibanaSadhanaRefresh=()=>reloadTasks();
async function init(){
  // 1. Session (redirect anonymous visitors to login — same guard as the app shell).
  const me=await fetch('/api/auth/me').then(r=>r.ok?r.json():null).catch(()=>null);
  if(!me||!me.user){location.href='/login.html';return;}
  USERNAME=me.user.username||(me.user.email||'').split('@')[0]||'user';
  const nameEl=document.getElementById('userNameLbl');
  if(nameEl)nameEl.textContent=USERNAME;

  // 2. Language follows the user record (multi-device); the CALENDAR is derived from
  // the language (fa → Jalali, en → Gregorian — 2026-08-29 user request: no manual
  // toggle). A stale 'sadhana-cal' key from the old chip toggle is cleared for good.
  lang=me.user.language_pref==='fa'?'fa':'en';
  cal=lang==='fa'?'j':'g';
  try{localStorage.removeItem('sadhana-cal')}catch(err){/* private mode */}

  // 3. Board data.
  const ok=await reloadTasks();
  if(!ok)return;

  // 4. Paint (mirrors the original's init tail, plus dynamic modal options).
  applyTheme(PREFS.theme==='dark');
  document.body.classList.toggle('rtl',lang==='fa');
  document.documentElement.lang=lang;
  const _lbEN2=document.getElementById('lbEN');if(_lbEN2)_lbEN2.classList.toggle('active',lang==='en');
  const _lbFA2=document.getElementById('lbFA');if(_lbFA2)_lbFA2.classList.toggle('active',lang==='fa');
  document.getElementById('addTaskBtn').textContent=tr('addTask');
  const _archLbl2=document.getElementById('archiveLbl');
  if(_archLbl2)_archLbl2.textContent=lang==='fa'?'آرشیو':'Archive';
  const _signOutLbl=document.getElementById('signOutLbl');
  if(_signOutLbl)_signOutLbl.textContent=tr('signOut');
  const _umLang=document.getElementById('umLblLang');
  if(_umLang)_umLang.textContent=lang==='fa'?'زبان':'Language';
  updateThemeLabel();
  buildGrid();
  buildFilterBar();
  buildHeaderDate();
  buildModalQuads();
  buildQuadDots();
  document.title=lang==='fa'?'لیست کارها — هیبانا':'To-do list — Hibana';

}
init();

