'use strict';
/**
 * هذا الملف إضافي بالكامل - لا يعدّل أي شيء في renderer.js. يضيف:
 * 1) تبويبات دخول الإدارة/الفرع + تسجيل فرع جديد على شاشة القفل.
 * 2) بانر علوي للفرع بعد الدخول + زر تسجيل خروج.
 * 3) إخفاء/تعطيل أزرار أوامر التشغيل المقفولة على هذا الفرع من قبل الإدارة (دفاع بصري -
 *    السيرفر أصلاً يرفض الطلب حتى لو حاول أحد تجاوز الواجهة).
 * 4) صفحة "👥 الفروع" الكاملة للإدارة: طلبات الانضمام، الفروع المعتمدة مع صلاحياتها، والسلة.
 */

// خريطة اسم دالة الزر بالواجهة (كما يُستخدم في onclick="callRun('اسم')") إلى مفتاح الأمر
// المستخدم في صلاحيات السيرفر (نفس الخريطة الموجودة داخل renderer.js لكن هنا للعرض فقط).
const CMD_NAME_TO_KEY = {
  aliBigDataRun: 'bigdata', aliTurboRun: 'turbo', aliTurboRunManual: 'manual',
  aliExceptionalRun: 'exceptional', aliBranchLimitRun: 'branchLimit', aliPreview20: 'preview20',
  aliShortageFromWarehouses: 'shortageWarehouses', aliShortageBranchToBranch: 'shortageBranches'
};
const CMD_KEY_LABELS = {
  turbo: 'Turbo', bigdata: 'BIG DATA', manual: 'Turbo يدوي', exceptional: 'السحب الاستثنائي الكامل',
  branchLimit: 'حدود الفروع الخاصة', preview20: 'معاينة أول 20', shortageWarehouses: 'نواقص من المستودعات',
  shortageBranches: 'نواقص من الفروع',
  voiceMsg: '🎤 رسائل صوتية', videoMsg: '📹 رسائل فيديو', liveCall: '📞 مكالمات حية', peerChat: '🤝 دردشة مع فروع ثانية',
  updateSheets: '📋 تحديث تواريخ صفحات الملف'
};

window.showLockTab = function (tab) {
  document.getElementById('adminLoginBlock').style.display = tab === 'admin' ? 'block' : 'none';
  document.getElementById('branchLoginBlock').style.display = tab === 'branch' ? 'block' : 'none';
  document.getElementById('branchRegisterBlock').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('tabAdminBtn').classList.toggle('active', tab === 'admin');
  document.getElementById('tabBranchBtn').classList.toggle('active', tab === 'branch');
  document.getElementById('tabRegisterBtn').classList.toggle('active', tab === 'register');
};

window.doBranchLogin = async function () {
  const u = document.getElementById('branchUser').value, p = document.getElementById('branchPass').value;
  const err = document.getElementById('branchLoginErr');
  const r = await window.api.branch.login(u, p);
  if (r.ok) { err.textContent = ''; document.getElementById('lockScreen').classList.add('hidden'); applySessionUI(); }
  else err.textContent = r.message || 'تعذّر تسجيل الدخول.';
};

window.doBranchRegister = async function () {
  const name = document.getElementById('regDisplayName').value;
  const u = document.getElementById('regUsername').value;
  const p = document.getElementById('regPassword').value;
  const phone = document.getElementById('regPhone').value;
  const email = document.getElementById('regEmail').value;
  const msg = document.getElementById('branchRegisterMsg');
  const r = await window.api.branch.register(name, u, p, phone, email);
  msg.style.color = r.ok ? '#86efac' : '#fca5a5';
  msg.textContent = r.message || (r.ok ? 'تم الإرسال.' : 'تعذّر الإرسال.');
  if (r.ok) { document.getElementById('regDisplayName').value = ''; document.getElementById('regUsername').value = ''; document.getElementById('regPassword').value = ''; document.getElementById('regPhone').value = ''; document.getElementById('regEmail').value = ''; }
};

window.doLogoutAny = async function () {
  await window.api.session.logout();
  location.reload();
};

// ---- تطبيق قيود/واجهة الفرع بعد الدخول (لا يعدّل renderer.js، فقط يخفي/يعطّل بصريًا) ----
async function applySessionUI() {
  const s = await window.api.session.me();
  const banner = document.getElementById('branchBanner');
  const navBranches = document.getElementById('navBranches');
  if (s.role === 'branch') {
    if (navBranches) navBranches.style.display = 'none';
    banner.style.display = 'flex';
    banner.innerHTML = `<span>🏬 مسجّل دخول كفرع: ${s.displayName}</span>`;
    const btn = document.createElement('button');
    btn.textContent = 'تسجيل خروج';
    btn.onclick = window.doLogoutAny;
    banner.appendChild(btn);
    document.body.style.paddingTop = '0';
    document.querySelector('.desktop').style.marginTop = '38px';
    applyLockedCommandsToUI(s.locked || []);
    if (typeof refreshNotifBell === 'function') refreshNotifBell(); // يظهر شارة 💬 فورًا بدون ما ينتظر أول فحص دوري (حتى 15 ثانية)
  } else if (s.role === 'admin') {
    banner.style.display = 'none';
    if (navBranches) navBranches.style.display = '';
    const navNotifSettings = document.getElementById('navNotifSettings');
    if (navNotifSettings) navNotifSettings.style.display = '';
    loadBranchesAdminAll();
    refreshPendingBadge();
    if (typeof refreshNotifBell === 'function') refreshNotifBell();
  } else {
    banner.style.display = 'none';
  }
}

function applyLockedCommandsToUI(lockedKeys) {
  const lockedSet = new Set(lockedKeys);
  document.querySelectorAll('[onclick*="callRun("]').forEach(el => {
    const m = /callRun\(['"]([A-Za-z0-9_]+)['"]\)/.exec(el.getAttribute('onclick') || '');
    if (!m) return;
    const cmdKey = CMD_NAME_TO_KEY[m[1]];
    if (cmdKey && lockedSet.has(cmdKey)) el.classList.add('lockedByAdmin');
  });
}

// ---- صفحة إدارة الفروع (للإدارة) ----
async function getCmdKeys() {
  return Object.keys(CMD_KEY_LABELS); // هذي المرحلة (1) - أوامر التشغيل الأساسية فقط
}

function fmtDate(iso) { if (!iso) return '-'; try { return new Date(iso).toLocaleString('ar-SA'); } catch (e) { return iso; } }

async function loadBranchesAdminAll() {
  const [pending, approved, trash] = await Promise.all([
    window.api.admin.listBranches('pending'),
    window.api.admin.listBranches('approved'),
    window.api.admin.listBranches('trash')
  ]);
  // مهم: لا نُخفي رسالة الخطأ إذا فشلت القراءة (مثلاً قواعد أمان Firebase رفضت الطلب) - كنا
  // سابقًا نعرض "لا توجد طلبات" في هذي الحالة بالضبط، وهذا يخفي مشكلة حقيقية (يبدو كأنه ما
  // فيه طلبات وهي فعليًا موجودة لكن تعذّرت قراءتها). الآن نعرض رسالة الخطأ الحقيقية بدل ذلك.
  renderPending(pending.ok ? pending.rows : null, pending.ok ? null : (pending.message || 'تعذّر تحميل طلبات الانضمام.'));
  await renderApproved(approved.ok ? approved.rows : []);
  renderTrash(trash.ok ? trash.rows : []);
}

function renderPending(rows, errorMessage) {
  const el = document.getElementById('brPendingList');
  if (!el) return;
  if (errorMessage) { el.innerHTML = `<div class="msg" style="background:#fef2f2;border-color:#fecaca;color:#991b1b">⚠️ ${esc(errorMessage)}<br><span class="tiny">تحقّق إن قواعد Firebase (ملف firebase-rules.json) منشورة فعليًا بلوحة تحكم Firebase، أو افتح أدوات المطوّر (F12 → Console) لمزيد من التفاصيل.</span></div>`; return; }
  if (!rows.length) { el.textContent = 'لا توجد طلبات انضمام بانتظار الموافقة حاليًا.'; return; }
  el.innerHTML = rows.map(r => `
    <div class="brRow">
      <div class="brInfo"><b>${r.displayName}</b><span>اسم المستخدم: ${r.username} - أُرسل: ${fmtDate(r.createdAt)}</span></div>
      <div class="brActions">
        <button class="btnGreen" onclick="brApprove('${r.id}')">✅ موافقة</button>
        <button class="btnRed" onclick="brReject('${r.id}')">❌ رفض</button>
      </div>
    </div>`).join('');
}

function renderTrash(rows) {
  const el = document.getElementById('brTrashList');
  if (!el) return;
  if (!rows.length) { el.textContent = 'سلة المحذوفات فارغة حاليًا.'; return; }
  el.innerHTML = rows.map(r => `
    <div class="brRow">
      <div class="brInfo"><b>${r.displayName}</b><span>اسم المستخدم: ${r.username} - حُذف: ${fmtDate(r.deletedAt)}</span></div>
      <div class="brActions">
        <button class="btnGreen" onclick="brRestore('${r.id}')">♻️ استرجاع</button>
        <button class="btnRed" onclick="brPermanentDelete('${r.id}')">🗑️ حذف نهائي</button>
      </div>
    </div>`).join('');
}

async function renderApproved(rows) {
  const el = document.getElementById('brApprovedList');
  if (!el) return;
  if (!rows.length) { el.textContent = 'لا توجد فروع معتمدة حاليًا.'; return; }
  const keys = await getCmdKeys();
  el.innerHTML = rows.map(r => {
    const lockedSet = new Set(r.locked || []);
    const chips = keys.map(k => {
      if (k === 'updateSheets') {
        const granted = (r.rawPermissions || {})[k] === true;
        return `<span class="permChip ${granted ? '' : 'locked'}" onclick="brTogglePerm('${r.id}','${k}',${!granted})">${granted ? '✅' : '🔒'} ${CMD_KEY_LABELS[k] || k}</span>`;
      }
      const isLocked = lockedSet.has(k);
      return `<span class="permChip ${isLocked ? 'locked' : ''}" onclick="brTogglePerm('${r.id}','${k}',${isLocked})">${isLocked ? '🔒' : '✅'} ${CMD_KEY_LABELS[k] || k}</span>`;
    }).join('');
    const suspended = r.status === 'suspended';
    const activeBadge = r.isActive ? '<span class="pill" style="color:#166534">🟢 نشط</span>' : '<span class="pill" style="color:#64748b">⚪ غير نشط</span>';
    const waLink = r.phone ? `<a href="https://wa.me/${r.phone.replace(/^\+/, '')}" target="_blank" title="فتح واتساب">💬 واتساب</a>` : '';
    const mailLink = r.email ? `<a href="mailto:${r.email}" title="إرسال إيميل">✉️ إيميل</a>` : '';
    const pendingChangeBox = r.hasPendingChanges ? `
      <div class="msg" style="margin-top:8px;background:#fffbeb;border-color:#fbbf24">
        <b>📝 طلب تعديل بيانات بانتظار موافقتك:</b>
        الاسم: ${esc(r.pendingChanges.displayName)} | الهاتف: ${esc(r.pendingChanges.phone)} | الإيميل: ${esc(r.pendingChanges.email)}
        <div style="margin-top:6px"><button class="btnGreen" onclick="brApproveProfileChange('${r.id}')">✅ موافقة</button> <button class="btnRed" onclick="brRejectProfileChange('${r.id}')">❌ رفض</button></div>
      </div>` : '';
    return `
    <div class="brRow" style="flex-direction:column;align-items:stretch">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div class="brInfo"><b>${r.displayName} ${suspended ? '<span class="pill" style="color:#991b1b">موقوف</span>' : ''} ${activeBadge}</b><span>اسم المستخدم: ${r.username} - اعتُمد: ${fmtDate(r.approvedAt)} ${r.lastLoginAt ? '- آخر دخول: ' + fmtDate(r.lastLoginAt) : ''}</span>
        <span style="display:flex;gap:10px;margin-top:2px">${waLink} ${mailLink}</span></div>
        <div class="brActions">
          ${suspended ? `<button class="btnGreen" onclick="brUnsuspend('${r.id}')">▶️ رفع التعليق</button>` : `<button class="btnGold" onclick="brSuspend('${r.id}')">⏸️ تعليق</button>`}
          <button class="btnRed" onclick="brDelete('${r.id}')">🗑️ حذف</button>
        </div>
      </div>
      ${pendingChangeBox}
      <div style="margin-top:8px"><div class="tiny" style="margin-bottom:4px">صلاحيات أوامر التشغيل والدردشة (اضغط لتبديل القفل):</div>${chips}</div>
    </div>`;
  }).join('');
}
window.brApproveProfileChange = async (id) => { await window.api.admin.approveProfileChange(id); loadBranchesAdminAll(); };
window.brRejectProfileChange = async (id) => { await window.api.admin.rejectProfileChange(id); loadBranchesAdminAll(); };

window.brApprove = async id => { await window.api.admin.approve(id); loadBranchesAdminAll(); };
window.brReject = async id => { await window.api.admin.reject(id); loadBranchesAdminAll(); };
window.brSuspend = async id => { await window.api.admin.suspend(id); loadBranchesAdminAll(); };
window.brUnsuspend = async id => { await window.api.admin.unsuspend(id); loadBranchesAdminAll(); };
window.brDelete = async id => { if (!confirm('نقل هذا الفرع إلى سلة المحذوفات؟')) return; await window.api.admin.softDelete(id); loadBranchesAdminAll(); };
window.brRestore = async id => { await window.api.admin.restore(id); loadBranchesAdminAll(); };
window.brPermanentDelete = async id => { if (!confirm('حذف نهائي - لا يمكن التراجع. متأكد؟')) return; await window.api.admin.permanentDelete(id); loadBranchesAdminAll(); };
window.brTogglePerm = async (id, cmdKey, isCurrentlyLocked) => { await window.api.admin.setPermission(id, cmdKey, isCurrentlyLocked); loadBranchesAdminAll(); };


async function refreshPendingBadge() {
  const navBranches = document.getElementById('navBranches');
  if (!navBranches) return;
  const r = await window.api.admin.listBranches('pending');
  if (!r.ok) console.error('تعذّر تحميل عدد طلبات الانضمام المعلّقة:', r.message);
  const n = r.ok ? r.rows.length : 0;
  let badge = document.getElementById('navBranchesBadge');
  if (n > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'navBranchesBadge';
      badge.style.cssText = 'position:absolute;top:2px;left:2px;background:#ef4444;color:#fff;border-radius:999px;font-size:9px;font-weight:900;min-width:15px;height:15px;display:flex;align-items:center;justify-content:center;padding:0 3px';
      navBranches.style.position = 'relative';
      navBranches.appendChild(badge);
    }
    badge.textContent = n;
  } else if (badge) {
    badge.remove();
  }
}

// يشتغل بعد نجاح تسجيل الدخول (إداري أو فرع) - نراقب اختفاء شاشة القفل بدل تعديل دوال
// renderer.js نفسها، حتى نبقي ذلك الملف بدون أي تغيير.
document.addEventListener('DOMContentLoaded', () => {
  const lockScreen = document.getElementById('lockScreen');
  if (lockScreen) {
    const obs = new MutationObserver(() => { if (lockScreen.classList.contains('hidden')) applySessionUI(); });
    obs.observe(lockScreen, { attributes: true, attributeFilter: ['class'] });
  }
  // في حال كانت هناك جلسة مسجّلة دخول أصلًا (مثل تحديث الصفحة) قبل ما تظهر شاشة القفل أصلًا
  setTimeout(applySessionUI, 300);
  const navBr = document.getElementById('navBranches');
  if (navBr) navBr.onclick = () => { if (typeof page === 'function') page('branches'); loadBranchesAdminAll(); };
});

// ---- تحديث تلقائي دوري لطلبات الانضمام (بدون ما تحتاج تسجّل خروج/دخول من جديد) ----
// بدون سيرفر مركزي/بث لحظي حقيقي (Firebase SDK الكاملة)، الحل العملي هو فحص دوري: كل 20 ثانية
// نجدّد شارة الجرس دائمًا (بأي صفحة)، وكل 15 ثانية نجدّد قائمة طلبات الانضمام كاملة لو كنت فاتح
// بالضبط صفحة "👥 الفروع" وقتها (نفس أسلوب تحديث صفحة الدردشة الموجود مسبقًا).
setInterval(() => {
  window.api.session.me().then(s => { if (s.role === 'admin') refreshPendingBadge(); }).catch(() => { /* تجاهل */ });
}, 20000);
setInterval(() => {
  const pageBr = document.getElementById('page-branches');
  if (!pageBr || !pageBr.classList.contains('active')) return;
  window.api.session.me().then(s => { if (s.role === 'admin') loadBranchesAdminAll(); }).catch(() => { /* تجاهل */ });
}, 15000);

// ملاحظة: بدون سيرفر مركزي ما فيه بث لحظي (SSE) للطلبات الجديدة هذي المرحلة - القائمة
// تتحدث تلقائيًا كل ما تزور صفحة "الفروع" أو تسجّل دخول من جديد. تحديث لحظي حقيقي (لحظة
// وصول الطلب) يحتاج مزامنة Firebase المباشرة (onValue) - يُضاف بمرحلة قادمة.
