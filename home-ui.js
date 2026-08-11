'use strict';
/**
 * منطق الصفحة الرئيسية - ملف إضافي منفصل، لا يعدّل renderer.js.
 */
function fmtDateTimeHome(iso) {
  if (!iso) return 'لم يُحدَّث بعد';
  try {
    const d = new Date(iso);
    return d.toLocaleString('ar-SA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

async function loadHomePage() {
  const r = await window.api.session.me();
  if (!r.role) return;

  document.getElementById('homeGreetingText').textContent = r.role === 'admin'
    ? 'أهلًا بك - هذي نظرة سريعة على حالة المنصة كاملة.'
    : 'أهلًا ' + (r.displayName || '') + ' - هذي نظرة سريعة على حالة بياناتك.';

  const excelEl = document.getElementById('homeExcelStatus');
  const excelInfo = await window.api.excel.getCurrent();
  if (excelInfo.ok) {
    excelEl.innerHTML = `📄 <b>${esc(excelInfo.name)}</b><br>آخر رفع: ${fmtDateTimeHome(excelInfo.modifiedAt)}<br>` +
      `عدد منتجات المخزون: ${excelInfo.products} - صفوف الاحتياج: ${excelInfo.needProducts}`;
  } else {
    excelEl.textContent = 'لا يوجد ملف Excel محمّل بعد - اذهب لصفحة "ملف Excel" لرفع واحد.';
  }

  const sheetsGrid = document.getElementById('homeSheetsGrid');
  const sheetsRes = await window.api.sheets.list();
  if (sheetsRes.ok) {
    sheetsGrid.innerHTML = sheetsRes.rows.map(s => `
      <div class="metric">
        <div class="name">${esc(s.label)}</div>
        <b style="font-size:11px">${fmtDateTimeHome(s.updatedAt)}</b>
        ${s.updatedBy ? `<div class="tiny">بواسطة: ${esc(s.updatedBy)}</div>` : ''}
        <button class="btnBlue" style="margin-top:8px;width:100%;box-shadow:0 2px 6px rgba(14,165,233,.25)" onclick="homeMarkSheetUpdated('${s.key}')">✅ اضغط هنا لتأكيد التحديث الآن</button>
        <div class="tiny" style="margin-top:3px;color:#0284c7">👆 هذا زر حقيقي - اضغطه بعد ما تحدّث هذي الصفحة فعليًا بملف الإكسل</div>
      </div>`).join('');
  }

  if (r.role === 'admin') {
    document.getElementById('homeAdminCards').style.display = 'block';
    const branches = await window.api.admin.listBranches('approved');
    const pending = await window.api.admin.listBranches('pending');
    document.getElementById('homeBranchStats').innerHTML = `
      <div class="metric"><div class="name">طلبات بانتظار الموافقة</div><b>${pending.ok ? pending.rows.length : 0}</b></div>
      <div class="metric"><div class="name">فروع معتمدة</div><b>${branches.ok ? branches.rows.length : 0}</b></div>
      <div class="metric"><div class="name">فروع نشطة</div><b>${branches.ok ? branches.rows.filter(b => b.isActive).length : 0}</b></div>`;
    const emailRes = await window.api.settings.getAdminEmail();
    if (emailRes.ok) document.getElementById('homeAdminEmailInput').value = emailRes.email || '';
  }
}

window.homeMarkSheetUpdated = async function (key) {
  const r = await window.api.sheets.markUpdated(key);
  if (!r.ok) alert(r.message || 'تعذّر التحديث.');
  loadHomePage();
};
window.saveHomeAdminEmail = async function () {
  const email = document.getElementById('homeAdminEmailInput').value;
  const msgEl = document.getElementById('homeAdminEmailMsg');
  const r = await window.api.settings.setAdminEmail(email);
  msgEl.style.color = r.ok ? '#166534' : '#991b1b';
  msgEl.textContent = r.message || (r.ok ? 'تم الحفظ.' : 'تعذّر الحفظ.');
};

async function refreshNotifBell() {
  const r = await window.api.settings.badgeCount();
  const bell = document.getElementById('notifBell');
  if (bell) {
    if (r.ok && r.count > 0) {
      document.getElementById('notifBellCount').textContent = r.count;
      bell.style.display = 'block';
    } else {
      bell.style.display = 'none';
    }
  }
  // شارة الرسائل الجديدة - تشتغل للإدارة والفروع الاثنين (بعكس شارة طلبات الانضمام اللي
  // للإدارة فقط)، عشان الفرع يعرف إن فيه رسالة جديدة وصلته بدون ما يحتاج يفتح الدردشة يتأكد.
  const chatBell = document.getElementById('chatNotifBell');
  if (chatBell) {
    const cr = await window.api.settings.chatBadgeCount();
    if (cr.ok && cr.count > 0) {
      document.getElementById('chatNotifBellCount').textContent = cr.count;
      chatBell.style.display = 'block';
    } else {
      chatBell.style.display = 'none';
    }
  }
}

async function loadNotifSettingsPage() {
  const emailRes = await window.api.settings.getAdminEmail();
  if (emailRes.ok) document.getElementById('notifAdminEmail').value = emailRes.email || '';
  const phoneRes = await window.api.settings.getAdminPhone();
  if (phoneRes.ok) document.getElementById('notifAdminPhone').value = phoneRes.phone || '';
}
window.saveNotifSettings = async function () {
  const phone = document.getElementById('notifAdminPhone').value;
  const email = document.getElementById('notifAdminEmail').value;
  const msgEl = document.getElementById('notifSettingsMsg');
  const r1 = await window.api.settings.setAdminPhone(phone);
  const r2 = await window.api.settings.setAdminEmail(email);
  const ok = r1.ok && r2.ok;
  msgEl.style.color = ok ? '#166534' : '#991b1b';
  msgEl.textContent = ok ? 'تم حفظ إعدادات الإشعارات.' : (r1.message || r2.message || 'تعذّر الحفظ.');
};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-page="notifsettings"]').forEach(btn => {
    btn.onclick = () => { if (typeof page === 'function') page('notifsettings'); loadNotifSettingsPage(); };
  });
  setInterval(refreshNotifBell, 15000);
});

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-page="home"]').forEach(btn => {
    btn.onclick = () => { if (typeof page === 'function') page('home'); loadHomePage(); };
  });
  setTimeout(loadHomePage, 400);
});
