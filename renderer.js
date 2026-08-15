'use strict';
const BR=[['online','الاونلاين'],['shati','الشاطئ'],['aziziyah','العزيزية'],['fakhriyah','الفاخرية'],['jubail','الجبيل'],['tarout','تاروت'],['hofuf','الهفوف'],['hyper','الهايبر'],['mubarraz','المبرز'],['hafr','حفر الباطن'],['olaya','العليا'],['shahabiyah','الشهابية'],['saihat','سيهات'],['khafji','الخفجي'],['bustan','بستان'],['fursan','الفرسان'],['dahiyah','الضاحية'],['muntazah','المنتزه'],['narjis','النرجس']];
const WH=[['dabab_wh','مستودع الضباب'],['cups_wh','مستودع الأكواب'],['fursan_main_wh','مستودع الفرسان 2 الرئيسي'],['wh_main_khaldiyah','مستودع الخالدية'],['wh_beauty','مستودع التجميل']];
const el=id=>document.getElementById(id); let lastFile=null;
function page(name){document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));el('page-'+name).classList.add('active');document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===name));}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>page(b.dataset.page));document.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{page('dashboard');setTimeout(()=>{let x=el(b.dataset.jump);if(x)x.scrollIntoView({behavior:'smooth'})},50)});
function showFile(r){let ok=r&&r.ok;el('fileDot').className='dot '+(ok?'ok':'');el('fileStatus').textContent=ok?('جاهز: '+r.name):(r&&r.message||'لم يتم اختيار ملف');el('filePath').textContent=ok?r.path:'—';el('fileSheets').textContent=ok?(r.sheets||0):0;el('fileProducts').textContent=ok?(r.products||0):0;el('fileMsg').textContent=r&&r.message?r.message:'اختر ملف Excel.';lastFile=ok?r:null;if(ok&&typeof loadCategoryPage==='function')loadCategoryPage();}
el('chooseExcel').onclick=async()=>showFile(await window.api.excel.choose());el('reloadExcel').onclick=async()=>showFile(await window.api.excel.reload());el('goDashboard').onclick=()=>page('dashboard');
function card(prefix,type,x,on){return `<label class="locCard ${type==='wh'?'wh ':''}${on?'on':''}" data-prefix="${prefix}" data-type="${type}"><input type="checkbox" id="${prefix}_${x[0]}" ${on?'checked':''} onchange="syncCards()"><span class="locText"><span class="ar">${x[1]}</span><br><span class="code">${x[0]}</span></span></label>`}
function render(){el('srcBranches').innerHTML=BR.map(x=>card('src','branch',x,true)).join('');el('srcWh').innerHTML=WH.map(x=>card('src','wh',x,true)).join('');el('dstBranches').innerHTML=BR.map(x=>card('dst','branch',x,true)).join('');el('dstWh').innerHTML=WH.map(x=>card('dst','wh',x,false)).join('');renderBranchLimits();renderWhLimits();loadSettings();syncCards();loadBranchLimits();loadWhLimits();}
window.syncCards=function(){document.querySelectorAll('.locCard').forEach(l=>{let c=l.querySelector('input[type=checkbox]');if(c)l.classList.toggle('on',c.checked)});el('srcCount').textContent=getChecked('src').length;el('dstCount').textContent=getChecked('dst').length};
window.sel=function(p,t,v){document.querySelectorAll(`.locCard[data-prefix="${p}"]`).forEach(l=>{if(t==='all'||l.dataset.type===t)l.querySelector('input').checked=v});syncCards()};
function getChecked(p){return [...document.querySelectorAll(`.locCard[data-prefix="${p}"] input:checked`)].map(c=>c.id.replace(p+'_',''))} function num(id){let e=el(id),v=e?Number(e.value):0;return isNaN(v)?0:v}
function cfg(){return {cover:num('cover'),keep:num('keep'),whMin:num('wh'),minTr:num('min'),noSales:num('nosales'),manualQty:num('manual'),exceptionQty:num('exceptionQty'),exceptionSplitMin:num('exceptionSplitMin'),zeroSalesKeep:num('zeroKeep'),maxCover:num('maxCover'),zeroSalesStockLimit:num('zeroSalesStockLimit'),keepQty:num('keepQty'),raiseSmallNeed:num('raiseSmallNeed'),salesRaise:num('salesRaise'),branchLimitMode:el('branchLimitMode').value,shortageStockThreshold:num('shortageStockThreshold'),filterMainCategory:savedCategoryFilter.main,filterSubCategory:savedCategoryFilter.sub,filterBrand:savedCategoryFilter.brand,exceptionMode:el('exceptionMode').value,zeroSalesMode:el('zeroSalesMode').value,sources:getChecked('src'),dests:getChecked('dst')}}
window.saveSettings=function(){localStorage.setItem('ALI_TURBO_V8_SETTINGS',JSON.stringify(cfg()));el('msg').textContent='تم حفظ الاختيارات والإعدادات.'};function loadSettings(){try{let s=JSON.parse(localStorage.getItem('ALI_TURBO_V8_SETTINGS')||'{}');Object.keys(s).forEach(k=>{if(el(k)&&!Array.isArray(s[k]))el(k).value=s[k]})}catch{}}
function renderBranchLimits(){el('branchLimitsGrid').innerHTML=BR.concat(WH).map(x=>`<div class="locCard"><span class="locText"><b>${x[1]}</b><br><span class="code">${x[0]}</span></span><span><input type="number" placeholder="أدنى" style="width:64px" id="bl_min_${x[0]}"><input type="number" placeholder="أعلى" style="width:64px" id="bl_max_${x[0]}"></span></div>`).join('');el('blCount').textContent=BR.length+WH.length}
function renderWhLimits(){el('whLimitsGrid').innerHTML=WH.map(x=>`<div class="locCard wh"><span class="locText"><b>${x[1]}</b><br><span class="code">${x[0]}</span></span><input type="number" placeholder="حد التفعيل" style="width:90px" id="wl_thr_${x[0]}"></div>`).join('')}
window.saveBranchLimits=async()=>ok(await window.api.limits.saveBranch(BR.concat(WH).map(x=>({id:x[0],min:el('bl_min_'+x[0]).value,max:el('bl_max_'+x[0]).value}))));window.loadBranchLimits=async()=>{let a=await window.api.limits.loadBranch();a.forEach(x=>{if(el('bl_min_'+x.id))el('bl_min_'+x.id).value=x.min??'';if(el('bl_max_'+x.id))el('bl_max_'+x.id).value=x.max??''})};window.clearBranchLimits=async()=>{ok(await window.api.limits.clearBranch());loadBranchLimits()};
// تعميم سريع: يعبّي "الحد الأدنى" بنفس القيمة لكل الفروع (مو المستودعات) دفعة وحدة، بدل تعبئة كل
// فرع لحاله يدويًا - يحفظ فورًا بنفس الضغطة (نفس فكرة "تصفير كل الحدود" لكن بالعكس: تعبئة بدل مسح).
window.broadcastBranchLimitMin=async()=>{
  const v=el('blBroadcastMin').value;
  if(v===''){alert('اكتب رقم الحد الأدنى أول قبل الضغط على "تطبيق وحفظ للكل".');return}
  BR.forEach(x=>{if(el('bl_min_'+x[0]))el('bl_min_'+x[0]).value=v});
  await saveBranchLimits();
  el('blBroadcastMin').value='';
  alert('تم تطبيق الحد الأدنى ('+v+') على كل الفروع ('+BR.length+' فرع) وحفظه.');
};
window.saveWhLimits=async()=>ok(await window.api.limits.saveWh(WH.map(x=>({id:x[0],thr:el('wl_thr_'+x[0]).value}))));window.loadWhLimits=async()=>{let a=await window.api.limits.loadWh();a.forEach(x=>{if(el('wl_thr_'+x.id))el('wl_thr_'+x.id).value=x.thr??''})};window.clearWhLimits=async()=>{ok(await window.api.limits.clearWh());loadWhLimits()};
function setStatus(s,p=0,cls='busy'){el('status').textContent=s;el('status').className='status '+cls;el('bar').style.width=p+'%';el('p').textContent=p+'%'}function setMonitor(m={}){[['products','products'],['done','done'],['t','transfers'],['q','qty'],['coveredPct','coveredPct'],['rejected','rejected'],['critical','critical'],['elapsed','elapsed'],['speed','speed'],['eta','eta'],['batch','batch'],['errors','errors'],['u','uncovered'],['lock','lock'],['cancel','cancel']].forEach(([a,b])=>{if(el(a)&&m[b]!==undefined)el(a).textContent=m[b]});if(m.progress!==undefined)setStatus(m.status||'جاري التنفيذ',m.progress,'busy')}
function ok(r){const success=!!(r&&r.ok!==false);setStatus(success?'تم بنجاح':'تعذّر التنفيذ',100,success?'ok':'fail');el('msg').textContent=r&&r.message?r.message:(success?'تم':'حدث خطأ غير معروف');setMonitor(r||{});refreshMonitor();dbRefreshStats();}
function fail(e){setStatus('توقف بخطأ',0,'fail');el('msg').textContent=e&&e.message?e.message:String(e)}
window.callRun=async function(fn){saveSettings();setStatus('جاري التنفيذ',35);try{let map={aliTurboRun:'turbo',aliBigDataRun:'bigdata',aliExceptionalRun:'exceptional',aliTurboRunManual:'manual',aliBranchLimitRun:'branchLimit',aliPreview20:'preview20',aliShortageFromWarehouses:'shortageWarehouses',aliShortageBranchToBranch:'shortageBranches'};let method=map[fn];let r=window.api.run[method]?await window.api.run[method](cfg()):{ok:false,message:'هذا الأمر ظاهر ومحفوظ، وسيتم استكمال محركه في النسخة التالية.'};ok(r)}catch(e){fail(e)}};
window.call=async function(fn){try{let map={aliCheckData:'checkData',aliDupCheck:'dupCheck',aliCleanResults:'cleanResults',aliCancelRun:'cancel',aliUnlock:'unlock',aliDeleteResultArrows:'deleteArrows',aliRestoreLastDistribution:'restore'};let m=map[fn];ok(window.api.run[m]?await window.api.run[m]():{ok:false,message:'الأمر محفوظ في الواجهة.'})}catch(e){fail(e)}};
window.exportFile=async function(fn){let map={aliExportBranches:'branches',aliExportWarehouses:'warehouses',aliExportAll:'all',aliExportRaise:'raise',aliExportSummary:'summary',aliExportShortageWarehouses:'shortageWarehouses',aliExportShortageBranches:'shortageBranches',aliExportDupBarcodes:'dupBarcodes',aliExportStockDupBarcodes:'stockDupBarcodes'};let m=map[fn];try{if(fn==='aliExportCategoryAudit'){ok(await window.api.exportFile.categoryAudit(lastAuditScope));return;}ok(window.api.exportFile[m]?await window.api.exportFile[m]():{ok:false,message:'لا توجد نتائج لهذا التقرير بعد.'})}catch(e){fail(e)}};window.refreshMonitor=async()=>setMonitor(await window.api.run.monitor());
window.api.run.onProgress(setMonitor);window.api.excel.getCurrent().then(showFile);render();refreshMonitor();setInterval(refreshMonitor,5000);

// ---- قفل كلمة المرور ----
let authFirstTime=false;
async function initAuth(){
  const st=await window.api.auth.status();
  if(!st.hasPassword){authFirstTime=true;el('lockSub').textContent='أول استخدام: حدد كلمة مرور لحماية اللوحة (أو اتركها فارغة واضغط دخول لتجاهل الحماية)';el('lockPass2').style.display='block';el('lockPass2').placeholder='تأكيد كلمة المرور';}
  else{authFirstTime=false;el('lockSub').textContent='أدخل كلمة المرور للدخول';el('lockPass2').style.display='none';}
  el('passStatus').textContent=st.hasPassword?'محمية بكلمة مرور حاليًا.':'لا توجد كلمة مرور حاليًا - أي شخص يفتح البرنامج يدخل مباشرة.';
}
window.doLogin=async function(){
  const p=el('lockPass').value, err=el('lockErr');
  if(authFirstTime){
    if(p && p!==el('lockPass2').value){err.textContent='كلمتا المرور غير متطابقتين.';return;}
    if(p){const r=await window.api.auth.setPassword('',p);if(!r.ok){err.textContent=r.message;return;}}
    el('lockScreen').classList.add('hidden');return;
  }
  const r=await window.api.auth.login(p);
  if(r.ok){err.textContent='';el('lockScreen').classList.add('hidden');}
  else err.textContent=r.message;
};
window.changePassword=async function(){const o=el('passOld').value,n=el('passNew').value;const r=await window.api.auth.setPassword(o,n);ok(r);if(r.ok){el('passOld').value='';el('passNew').value='';initAuth();}};
window.removePassword=async function(){const o=el('passOld').value;const r=await window.api.auth.removePassword(o);ok(r);if(r.ok)initAuth();};
initAuth();
async function dbRefreshStats(){if(!el('dbStatsMsg'))return;const r=await window.api.db.stats();el('dbStatsMsg').textContent=r.message;}
window.dbClean=async function(){const r=await window.api.db.clean();ok(r);dbRefreshStats();};
dbRefreshStats();

// ---- صفحة "الفئات": هيكلة تفاعلية (لوحة ذكية) + تحديد يُحفظ كفلتر لتقارير النواقص ----
let categoryAuditRows = [];
let catSelection = { main: new Set(), sub: new Set(), brand: new Set() };
// كل فئة/فرعية/براند "نشوفها لأول مرة" فقط هي التي تُحدَّد تلقائيًا (تمامًا مثل بطاقات المصادر والوجهات) - أي إلغاء تحديد تسويه أنت يدويًا يبقى محفوظًا حتى لو تغيّر النطاق أو أعدت تحميل نفس الملف
let catSeen = { main: new Set(), sub: new Set(), brand: new Set() };
let catTotal = { main: 0, sub: 0, brand: 0 };
async function loadCategoryPage(){
  if(!el('categoryAccordion'))return;
  const scope = el('catPageScope') ? el('catPageScope').value : 'stock';
  lastAuditScope = scope;
  const r = await window.api.category.audit(scope);
  if(!r.ok){el('categoryAccordion').innerHTML='<div class="msg">'+r.message+'</div>';return;}
  categoryAuditRows = r.rows;
  const mains=new Set(), subs=new Set(), brands=new Set(); let none=0;
  categoryAuditRows.forEach(x=>{
    if(x.mainCategory==='(بدون فئة رئيسية)'){none+=x.count;return;}
    mains.add(x.mainCategory); subs.add(x.mainCategory+'|'+x.subCategory); brands.add(x.mainCategory+'|'+x.subCategory+'|'+x.brand);
  });
  mains.forEach(m=>{ if(!catSeen.main.has(m)){ catSeen.main.add(m); catSelection.main.add(m); } });
  subs.forEach(s=>{ if(!catSeen.sub.has(s)){ catSeen.sub.add(s); catSelection.sub.add(s); } });
  brands.forEach(b=>{ if(!catSeen.brand.has(b)){ catSeen.brand.add(b); catSelection.brand.add(b); } });
  catTotal = { main: mains.size, sub: subs.size, brand: brands.size };
  el('catStatMains').textContent=mains.size; el('catStatSubs').textContent=subs.size; el('catStatBrands').textContent=brands.size; el('catStatNone').textContent=none;
  renderCategoryPage();
}
let openMains = new Set(), openSubs = new Set();
function catSquare(kind,key,label,count,extra,selSet,openSet){
  const sel=selSet.has(key), open=openSet&&openSet.has(key);
  const arrowHtml = openSet ? `<span class="arrowBadge" onclick="event.stopPropagation();toggleCatOpen('${kind}','${esc(key)}')">▶</span>` : '';
  return `<div class="catSq ${sel?'sel':''} ${open?'open':''}" title="${label} - ${count} منتج${extra?' - '+extra:''}" onclick="toggleCatSel('${kind}','${esc(key)}')">${arrowHtml}<b>${label}</b><span class="n">${count}${extra?' - '+extra:''}</span></div>`;
}
function drillHead(title, keys, level){
  return `<div class="drillHead"><b>${title}</b><span class="mini"><button onclick="event.stopPropagation();selectAllIn('${level}',${attrJSON(keys)})">تحديد الكل</button><button onclick="event.stopPropagation();deselectAllIn('${level}',${attrJSON(keys)})">إلغاء الكل</button></span></div>`;
}
function renderCategoryPage(){
  const q=(el('catSearch')&&el('catSearch').value||'').trim();
  const tree={};
  categoryAuditRows.forEach(x=>{
    if(x.mainCategory==='(بدون فئة رئيسية)')return;
    if(q && !(x.mainCategory.includes(q)||x.subCategory.includes(q)||x.brand.includes(q)))return;
    if(!tree[x.mainCategory])tree[x.mainCategory]={count:0,subs:{}};
    tree[x.mainCategory].count+=x.count;
    const sub=x.subCategory;
    if(!tree[x.mainCategory].subs[sub])tree[x.mainCategory].subs[sub]={count:0,brands:{}};
    tree[x.mainCategory].subs[sub].count+=x.count;
    tree[x.mainCategory].subs[sub].brands[x.brand]=(tree[x.mainCategory].subs[sub].brands[x.brand]||0)+x.count;
  });
  const mains=Object.keys(tree).sort();
  if(!mains.length){el('categoryAccordion').innerHTML='<div class="msg">لا توجد نتائج مطابقة.</div>';updateCatSelSummary();return;}

  // كل فئة رئيسية بطاقة صغيرة بجانب البقية، وبمجرد الضغط عليها تنسدل فئاتها الفرعية مباشرة تحتها في نفس المكان (وليس آخر الصفحة)
  let html = `<div class="catPanel"><div class="pnlHead"><b>الأقسام الرئيسية</b><span class="mini"><button onclick="selectAllIn('main',${attrJSON(mains)})">تحديد الكل</button><button onclick="deselectAllIn('main',${attrJSON(mains)})">إلغاء الكل</button></span></div><div class="pnlBody" style="display:block"><div class="catGrid">`;

  mains.forEach(m=>{
    html += catSquare('main', m, m, tree[m].count, Object.keys(tree[m].subs).length+' فئة فرعية', catSelection.main, openMains);
    if(openMains.has(m)){
      const subKeys=Object.keys(tree[m].subs).sort();
      html += `<div class="catDrill">${drillHead('الفئات الفرعية لـ "'+m+'"', subKeys.map(s=>m+'|'+s), 'sub')}<div class="catGrid nested">`;
      subKeys.forEach(s=>{
        const sKey=m+'|'+s;
        html += catSquare('sub', sKey, s, tree[m].subs[s].count, Object.keys(tree[m].subs[s].brands).length+' براند', catSelection.sub, openSubs);
        if(openSubs.has(sKey)){
          const brandKeys=Object.keys(tree[m].subs[s].brands).sort();
          html += `<div class="catDrill lvl2">${drillHead('براندات "'+s+'"', brandKeys.map(b=>sKey+'|'+b), 'brand')}<div class="catGrid nested2">`;
          html += brandKeys.map(b => catSquare('brand', sKey+'|'+b, b, tree[m].subs[s].brands[b], '', catSelection.brand, null)).join('');
          html += `</div></div>`;
        }
      });
      html += `</div></div>`;
    }
  });

  html += `</div></div></div>`;
  el('categoryAccordion').innerHTML = html;
  updateCatSelSummary();
}
function esc(s){return String(s).replace(/'/g,"\\'")}
// JSON.stringify ينتج علامات اقتباس مزدوجة " - لو حطيناها مباشرة داخل onclick="..." (نفس نوع الاقتباس) المتصفح يقطع الخاصية عند أول علامة، فيصير الزر معطّل بصمت. هذا كان يمنع "تحديد الكل/إلغاء الكل" من العمل. الحل: تحويلها إلى &quot; ليفكّها المتصفح صح وقت التنفيذ.
function attrJSON(arr){return JSON.stringify(arr).replace(/"/g,'&quot;')}
window.toggleCatOpen=function(level,key){
  const set = level==='main'?openMains:openSubs;
  if(set.has(key))set.delete(key); else set.add(key);
  renderCategoryPage();
};
window.toggleCatSel=function(level,key){
  const set = level==='main'?catSelection.main:level==='sub'?catSelection.sub:catSelection.brand;
  if(set.has(key))set.delete(key); else set.add(key);
  renderCategoryPage();
};
window.selectAllIn=function(level,keys){
  const set = level==='main'?catSelection.main:level==='sub'?catSelection.sub:catSelection.brand;
  keys.forEach(k=>set.add(k));
  renderCategoryPage();
};
window.deselectAllIn=function(level,keys){
  const set = level==='main'?catSelection.main:level==='sub'?catSelection.sub:catSelection.brand;
  keys.forEach(k=>set.delete(k));
  renderCategoryPage();
};
function updateCatSelSummary(){
  const n=catSelection.main.size+catSelection.sub.size+catSelection.brand.size;
  const total=catTotal.main+catTotal.sub+catTotal.brand;
  let txt;
  if(total===0){
    txt='لا توجد فئات مكتشفة بعد.';
  }else if(n>=total){
    txt='✅ كل الفئات محددة حاليًا تلقائيًا (تمامًا مثل المصادر والوجهات) - كل المنتجات ستدخل التشغيل. ألغِ تحديد أي فئة لا تريدها ثم اضغط "حفظ التحديد".';
  }else if(n===0){
    txt='لا يوجد تحديد حاليًا - كل الفئات ستدخل التشغيل.';
  }else{
    txt=`محدد الآن: ${catSelection.main.size} من ${catTotal.main} رئيسية، ${catSelection.sub.size} من ${catTotal.sub} فرعية، ${catSelection.brand.size} من ${catTotal.brand} براند (اضغط "حفظ التحديد" لتطبيقه).`;
  }
  if(el('catSelSummary'))el('catSelSummary').textContent=txt;
}
let savedCategoryFilter={main:[],sub:[],brand:[]};
window.saveCategorySelection=function(){
  // لو الكل محدد (الوضع الافتراضي) يُحفظ كـ"بدون فلتر" بالضبط كسلوك البرنامج الأصلي عند عدم التحديد - فقط عند إلغاء تحديد فئات معينة فعليًا يتحول إلى قيد حقيقي
  const mainAll = catSelection.main.size>=catTotal.main;
  const subAll  = catSelection.sub.size>=catTotal.sub;
  const brandAll= catSelection.brand.size>=catTotal.brand;
  savedCategoryFilter = {
    main: mainAll?[]:Array.from(catSelection.main),
    sub: subAll?[]:Array.from(catSelection.sub).map(k=>k.split('|')[1]),
    brand: brandAll?[]:Array.from(catSelection.brand).map(k=>k.split('|')[2])
  };
  const n=savedCategoryFilter.main.length+savedCategoryFilter.sub.length+savedCategoryFilter.brand.length;
  if(el('shortageCatSummary'))el('shortageCatSummary').textContent = n===0 ? 'لم يتم تحديد أي فئة - كل المنتجات ستدخل التشغيل.' : `تم حفظ تحديد: ${savedCategoryFilter.main.length} فئة رئيسية، ${savedCategoryFilter.sub.length} فرعية، ${savedCategoryFilter.brand.length} براند - سيُطبَّق على كل أوامر التشغيل (Turbo/BIG DATA/السحب الاستثنائي/النواقص).`;
};
window.clearCategorySelection=function(){
  catSelection={main:new Set(),sub:new Set(),brand:new Set()};
  savedCategoryFilter={main:[],sub:[],brand:[]};
  renderCategoryPage();
  if(el('shortageCatSummary'))el('shortageCatSummary').textContent='لم يتم تحديد أي فئة بعد - كل المنتجات ستدخل التشغيل.';
};
let lastAuditScope='stock';

// ---- ربط أودو ----
let odooDiscovered=null;
async function odooLoadSettings(){const s=await window.api.odoo.loadSettings();if(el('odooUrl'))el('odooUrl').value=s.serverUrl||'';if(el('odooDb'))el('odooDb').value=s.dbName||'';if(el('odooUser'))el('odooUser').value=s.username||'';if(el('odooKey'))el('odooKey').value=s.apiKey||'';}
function odooCollect(){return {serverUrl:el('odooUrl').value.trim(),dbName:el('odooDb').value.trim(),username:el('odooUser').value.trim(),apiKey:el('odooKey').value.trim()}}
window.odooTestConnection=async function(){el('odooConnMsg').textContent='جاري الاتصال...';const r=await window.api.odoo.testConnection(odooCollect());el('odooConnMsg').textContent=r.message||(r.ok?'تم الاتصال بنجاح':'تعذر الاتصال');el('odooConnMsg').style.color=r.ok?'#166534':'#991b1b';};
window.odooDiscover=async function(){el('odooMapMsg').textContent='جاري البحث عن مواقع أودو...';const r=await window.api.odoo.discoverLocations();if(!r.ok){el('odooMapMsg').textContent=r.message;return;}odooDiscovered=r;const opts=[{id:'',label:'— بدون ربط —'}].concat((r.warehouses||[]).map(w=>({id:'wh:'+w.lot_stock_id[0]+':'+w.name,label:'مستودع: '+w.name}))).concat((r.stockLocations||[]).map(s=>({id:'loc:'+s.id+':'+(s.complete_name||s.name),label:'موقع: '+(s.complete_name||s.name)})));
 const all=BR.map(x=>({code:x[0],ar:x[1],kind:'branch'})).concat(WH.map(x=>({code:x[0],ar:x[1],kind:'wh'})));
 el('odooLocMapGrid').innerHTML=all.map(loc=>{const sug=r.suggestions&&r.suggestions[loc.code];
   return `<div class="locCard" style="cursor:default"><span class="locText"><b>${loc.ar}</b> <span class="code">${loc.code}</span>${sug?('<br><span class="tiny" style="color:#166534">اقتراح: '+sug.odooLocationNames[0]+'</span>'):''}</span><select id="omap_${loc.code}" style="width:55%">${opts.map(o=>`<option value="${o.id}">${o.label}</option>`).join('')}</select></div>`;}).join('');
 if(r.suggestions){Object.keys(r.suggestions).forEach(code=>{const sel=el('omap_'+code);if(!sel)return;const sug=r.suggestions[code];const match=[...sel.options].find(o=>o.textContent.includes(sug.odooLocationNames[0]));if(match)sel.value=match.value;});}
 el('odooMapMsg').textContent='تم العثور على '+(r.warehouses||[]).length+' مستودع و'+(r.stockLocations||[]).length+' موقع داخلي في أودو. اختر لكل فرع/مستودع عندنا الموقع المطابق ثم احفظ.';
};
window.odooSaveLocMap=async function(){
 const all=BR.map(x=>({code:x[0],kind:'branch'})).concat(WH.map(x=>({code:x[0],kind:'wh'})));
 const rows=[];
 all.forEach(loc=>{const sel=el('omap_'+loc.code);if(!sel||!sel.value)return;const parts=sel.value.split(':');const kind=parts[0];
   if(kind==='wh'||kind==='loc')rows.push({id:loc.code,type:loc.kind,odooLocationIds:[Number(parts[1])],odooLocationNames:[parts.slice(2).join(':')]});
 });
 const r=await window.api.odoo.saveLocationMap(rows);el('odooMapMsg').textContent=r.message;
};
window.odooSync=async function(fn,arg){const r=await window.api.odoo[fn](arg);el('odooSyncMsg').textContent=r.message||(r.ok?'تم':'فشل');el('odooSyncMsg').style.color=r.ok?'#166534':'#991b1b';};
window.odooSyncSales=async function(which){const days=el('odooSalesDays'+which).value;const r=await window.api.odoo.syncSales(days,which===1?'sales30':'sales90');el('odooSyncMsg').textContent=r.message||(r.ok?'تم':'فشل');el('odooSyncMsg').style.color=r.ok?'#166534':'#991b1b';};
window.odooSyncAll=async function(){el('odooSyncMsg').textContent='جاري المزامنة الشاملة...';el('odooBar').style.width='0%';const d1=el('odooSalesDays1').value,d2=el('odooSalesDays2').value;const r=await window.api.odoo.syncAll(d1,d2);el('odooSyncMsg').textContent=r.message||(r.ok?'تم':'فشل');el('odooBar').style.width=r.ok?'100%':'0%';};
window.api.odoo.onProgress(d=>{if(el('odooBar'))el('odooBar').style.width=(d.progress||0)+'%';if(el('odooSyncMsg')&&d.status)el('odooSyncMsg').textContent=d.status;});
odooLoadSettings();
