'use strict';
/**
 * هذا الملف يبني window.api بنفس الشكل بالضبط اللي كانت تبنيه api-client.js (النسخة اللي تتكلم
 * مع سيرفر Node) - لكن هنا بدون أي سيرفر إطلاقًا: البيانات تُخزَّن وتُقرأ مباشرة من Firebase
 * Realtime Database (مجاني، دائم، بدون جهازك)، ومحرك التوزيع نفسه (نفس الملف المُختبَر
 * والمطابق تمامًا لنسخة السيرفر) يشتغل داخل متصفحك مباشرة.
 *
 * المرحلة الحالية (1): الحسابات + الموافقة + ملف Excel + الفئات + الحدود + أوامر التشغيل
 * الأساسية (Turbo / BIG DATA / يدوي / الاستثنائي / حدود الفروع / معاينة 20 / تقارير النواقص).
 * الدردشة والمكالمات والصفحة الرئيسية الملخّصة تُبنى بمرحلة قادمة فوق نفس هذا الأساس.
 */

const DB_URL = window.FIREBASE_CONFIG.databaseURL;
const API_KEY = window.FIREBASE_CONFIG.apiKey;
const AUTH_BASE = 'https://identitytoolkit.googleapis.com/v1';
const TOKEN_REFRESH_URL = 'https://securetoken.googleapis.com/v1/token?key=' + API_KEY;
// بريد إلكتروني وهمي يُصنَع تلقائيًا من اسم المستخدم - Firebase Authentication يتطلب صيغة
// بريد إلكتروني تقنيًا، لكن ما يحتاج يكون بريدًا حقيقيًا (ما نرسل له أي شيء) - هذا يخلينا
// نحافظ على تجربة "اسم مستخدم" البسيطة للفروع بدل إجبارهم يكتبون إيميل حقيقي.
const FAKE_EMAIL_DOMAIN = '@branch.distribution.local';
const ADMIN_EMAIL = 'admin' + FAKE_EMAIL_DOMAIN;

// ---------- Firebase Authentication (REST) ----------
async function authSignUp(email, password) {
  const r = await fetch(`${AUTH_BASE}/accounts:signUp?key=${API_KEY}`, { method: 'POST', body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const data = await r.json();
  if (!r.ok) throw new Error(mapAuthError(data));
  return data; // { idToken, localId (uid), refreshToken, expiresIn }
}
async function authSignIn(email, password) {
  const r = await fetch(`${AUTH_BASE}/accounts:signInWithPassword?key=${API_KEY}`, { method: 'POST', body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const data = await r.json();
  if (!r.ok) throw new Error(mapAuthError(data));
  return data;
}
function mapAuthError(data) {
  const code = (data && data.error && data.error.message) || '';
  if (code.includes('EMAIL_EXISTS')) return 'رقم الهاتف هذا مسجّل من قبل بحساب آخر - تأكد من رقمك، أو تواصل مع الإدارة لو تعتقد إنه خطأ.';
  if (code.includes('EMAIL_NOT_FOUND') || code.includes('INVALID_LOGIN_CREDENTIALS') || code.includes('INVALID_PASSWORD')) return 'بيانات الدخول غير صحيحة (تأكد من رقم الهاتف/كلمة المرور).';
  if (code.includes('WEAK_PASSWORD')) return 'كلمة المرور يجب أن تكون 6 خانات على الأقل (شرط Firebase).';
  if (code.includes('TOO_MANY_ATTEMPTS')) return 'محاولات كثيرة جدًا - انتظر شوي وحاول من جديد.';
  return 'تعذّرت العملية: ' + (code || 'خطأ غير معروف');
}
async function authRefresh(refreshToken) {
  const r = await fetch(TOKEN_REFRESH_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken)
  });
  const data = await r.json();
  if (!r.ok) throw new Error('تعذّر تجديد الجلسة - سجّل الدخول من جديد.');
  return { idToken: data.id_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, uid: data.user_id };
}

// ---------- الجلسة (محفوظة محليًا، تحمل رمز دخول Firebase حقيقي) ----------
function getSession() { try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch (e) { return null; } }
function setSession(s) { localStorage.setItem('session', JSON.stringify(s)); }
function clearSession() { localStorage.removeItem('session'); }

async function getValidIdToken() {
  const s = getSession();
  if (!s) return null;
  const now = Date.now();
  if (s.idToken && s.tokenExpiresAt && now < s.tokenExpiresAt - 60000) return s.idToken; // لسه صالح (بهامش دقيقة أمان)
  if (!s.refreshToken) return s.idToken || null;
  try {
    const fresh = await authRefresh(s.refreshToken);
    const updated = { ...s, idToken: fresh.idToken, refreshToken: fresh.refreshToken, tokenExpiresAt: Date.now() + Number(fresh.expiresIn) * 1000 };
    setSession(updated);
    return fresh.idToken;
  } catch (e) { clearSession(); return null; }
}

// ---------- أدوات مساعدة لقاعدة البيانات (كل طلب يحمل رمز الدخول الحقيقي - قواعد الأمان
// على Firebase هي اللي تتحقق فعليًا مين يقدر يقرأ/يكتب وين، مو الكود هنا) ----------
async function authQS() { const t = await getValidIdToken(); return t ? ('?auth=' + t) : ''; }
async function dbGet(path) {
  const r = await fetch(`${DB_URL}/${path}.json${await authQS()}`);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(dbErrorMessage(r.status, data));
  return data;
}
async function dbSet(path, value) {
  const r = await fetch(`${DB_URL}/${path}.json${await authQS()}`, { method: 'PUT', body: JSON.stringify(value) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(dbErrorMessage(r.status, data));
  return data;
}
async function dbUpdate(path, value) {
  const r = await fetch(`${DB_URL}/${path}.json${await authQS()}`, { method: 'PATCH', body: JSON.stringify(value) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(dbErrorMessage(r.status, data));
  return data;
}
async function dbDelete(path) {
  const r = await fetch(`${DB_URL}/${path}.json${await authQS()}`, { method: 'DELETE' });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(dbErrorMessage(r.status, data));
  return data;
}
function dbErrorMessage(status, data) {
  if (status === 401 || status === 403) return 'ما عندك صلاحية لهذا الإجراء (قواعد الأمان رفضت الطلب).';
  return 'تعذّر الاتصال بقاعدة البيانات (' + status + ')' + (data && data.error ? ': ' + data.error : '');
}

function randomHex(len) { const arr = new Uint8Array(len); crypto.getRandomValues(arr); return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join(''); }
function safeUsername(s) { return String(s || '').trim(); } // اسم عرض حر (عربي أو إنجليزي) - ما يحتاج تفرّد، لأن رقم الهاتف هو المُعرِّف الفريد الآن
function cleanPhoneNumber(p) { return String(p || '').replace(/[^0-9+]/g, ''); }
function safeKey(s) { return String(s).replace(/[.#$\[\]/]/g, '_'); }


// ---------- المصادقة (حساب الإدارة - حساب Firebase Auth حقيقي، بريد وهمي ثابت) ----------
async function authStatus() {
  try { const exists = await dbGet('adminExists'); return { hasPassword: !!exists }; }
  catch (e) { return { hasPassword: false }; }
}
async function authSetPassword(oldPassword, newPassword) {
  let exists = false;
  try { exists = await dbGet('adminExists'); } catch (e) { /* لسه ما فيه شي، طبيعي أول مرة */ }
  if (!exists) {
    // أول مرة: ننشئ حساب الإدارة الحقيقي على Firebase
    if (!newPassword || String(newPassword).length < 6) return { ok: false, message: 'كلمة المرور يجب أن تكون 6 خانات على الأقل (شرط أمان Firebase).' };
    try {
      const cred = await authSignUp(ADMIN_EMAIL, newPassword);
      setSession({ role: 'admin', uid: cred.localId, idToken: cred.idToken, refreshToken: cred.refreshToken, tokenExpiresAt: Date.now() + Number(cred.expiresIn) * 1000 });
      await dbSet('admins/' + cred.localId, true);
      await dbSet('adminExists', true);
      return { ok: true, message: 'تم إنشاء حساب الإدارة وحفظ كلمة المرور.' };
    } catch (e) { return { ok: false, message: e.message }; }
  }
  // تغيير كلمة مرور حساب إدارة موجود - نتحقق من كلمة المرور القديمة عبر تسجيل دخول فعلي أولًا
  try {
    await authSignIn(ADMIN_EMAIL, oldPassword || '');
  } catch (e) { return { ok: false, message: 'كلمة المرور الحالية غير صحيحة.' }; }
  if (!newPassword || String(newPassword).length < 6) return { ok: false, message: 'كلمة المرور يجب أن تكون 6 خانات على الأقل (شرط أمان Firebase).' };
  try {
    const token = await getValidIdToken();
    const r = await fetch(`${AUTH_BASE}/accounts:update?key=${API_KEY}`, { method: 'POST', body: JSON.stringify({ idToken: token, password: newPassword, returnSecureToken: true }) });
    const data = await r.json();
    if (!r.ok) throw new Error(mapAuthError(data));
    const s = getSession();
    setSession({ ...s, idToken: data.idToken, refreshToken: data.refreshToken, tokenExpiresAt: Date.now() + Number(data.expiresIn) * 1000 });
    return { ok: true, message: 'تم تحديث كلمة المرور.' };
  } catch (e) { return { ok: false, message: e.message }; }
}
async function authLogin(password) {
  let exists = false;
  try { exists = await dbGet('adminExists'); } catch (e) { /* تجاهل - نحاول تسجيل الدخول بأي حال */ }
  if (!exists) return { ok: false, message: 'لا يوجد حساب إدارة بعد - حدد كلمة مرور أولاً من هذي الشاشة.' };
  try {
    const cred = await authSignIn(ADMIN_EMAIL, password);
    setSession({ role: 'admin', uid: cred.localId, idToken: cred.idToken, refreshToken: cred.refreshToken, tokenExpiresAt: Date.now() + Number(cred.expiresIn) * 1000 });
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message }; }
}
async function authRemovePassword() {
  return { ok: false, message: 'إلغاء كلمة المرور غير متاح بهذي المرحلة - الأمان الحقيقي عبر Firebase يتطلب وجود كلمة مرور دائمًا (هذا مقصود لحمايتك).' };
}

// ---------- حالة داخلية بالمتصفح (بيانات الإكسل المحمّلة حاليًا بهذا المتصفح تحديدًا) ----------
let currentExcel = null; // { ctx, info } - نفس شكل ما كان بالسيرفر بالضبط

async function ensureExcelLoaded() {
  if (currentExcel) return currentExcel;
  const meta = await dbGet('excelMeta');
  if (!meta || !meta.chunkCount) throw new Error('لا يوجد ملف Excel محمّل بعد - اذهب لصفحة "ملف Excel" وارفع واحدًا.');
  const chunkPromises = [];
  for (let i = 0; i < meta.chunkCount; i++) chunkPromises.push(dbGet('excelChunks/' + i));
  const chunks = await Promise.all(chunkPromises);
  const base64 = chunks.join('');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const loaded = window.ExcelLoaderModule.readWorkbook(bytes, meta.name, meta.modifiedAt);
  currentExcel = loaded;
  return loaded;
}

// ---------- حسابات الفروع (كل فرع = حساب Firebase Auth حقيقي، بريد وهمي من اسم المستخدم) ----------
async function branchRegister(displayName, username, password, phone, email) {
  if (!displayName || !String(displayName).trim()) return { ok: false, message: 'اكتب اسم الفرع.' };
  const uname = safeUsername(username) || String(displayName).trim(); // اسم عرض حر - لو ما كتب اسم مستخدم منفصل نستخدم اسم الفرع نفسه
  if (!password || String(password).length < 6) return { ok: false, message: 'كلمة المرور يجب أن تكون 6 خانات على الأقل (شرط أمان Firebase).' };
  const cleanPhone = cleanPhoneNumber(phone);
  if (!cleanPhone || cleanPhone.length < 8) return { ok: false, message: 'اكتب رقم هاتف صحيح (يشمل رمز الدولة، مثال: 9665xxxxxxxx) - هذا رقمك المُعرِّف لتسجيل الدخول لاحقًا.' };
  const cleanEmail = String(email || '').trim();
  try {
    // رقم الهاتف هو المُعرِّف الفريد الآن لتسجيل الدخول (وليس اسم المستخدم) - يسمح لعدة فروع
    // مختلفة تستخدم نفس اسم العرض (مثلاً "محمد") طالما أرقام هواتفهم مختلفة فعليًا.
    let cred;
    try {
      cred = await authSignUp(cleanPhone + FAKE_EMAIL_DOMAIN, password);
    } catch (signupErr) {
      // فشل التسجيل برسالة "مسجّل من قبل" (EMAIL_EXISTS) يصير غالبًا لما الإدارة تكون سوّت
      // "حذف نهائي" لفرع قديم بنفس الرقم: بيانات الفرع تُحذف من قاعدة البيانات فعلاً، لكن حساب
      // Firebase Authentication الحقيقي (تسجيل الدخول نفسه) يبقى موجودًا تقنيًا - حذفه الكامل
      // يحتاج خادمًا خلفيًا (Admin SDK) ما نملكه بهذا الحل بدون سيرفر. بدل ما نوقف الشخص هنا
      // بلا أي مخرج، نتحقق: لو كلمة المرور اللي كتبها الآن تطابق كلمة مرور ذاك الحساب القديم
      // (يعني هو نفسه صاحبه أصلاً)، ولا يوجد له طلب/حساب نشط حاليًا، نعتبرها "إعادة تقديم طلب
      // انضمام" ونعيد استخدام نفس الحساب بدل ما نرفضه برسالة غامضة.
      if (!String(signupErr.message || '').includes('مسجّل من قبل')) return { ok: false, message: signupErr.message };
      let signInCred;
      try { signInCred = await authSignIn(cleanPhone + FAKE_EMAIL_DOMAIN, password); }
      catch (e) { return { ok: false, message: 'رقم الهاتف هذا مسجّل من قبل بكلمة مرور مختلفة عن اللي كتبتها الآن - لو كنت فرعًا سابقًا وتذكر كلمة مرورك القديمة جرّب تسجيل الدخول العادي بدلًا من التسجيل، أو تواصل مع الإدارة.' }; }
      const existingAcc = await dbGet('branches/' + signInCred.localId).catch(() => null);
      if (existingAcc && !existingAcc.deletedAt) return { ok: false, message: 'رقم الهاتف هذا مسجّل من قبل بحساب نشط بالفعل - سجّل الدخول بدل التسجيل من جديد، أو تواصل مع الإدارة لو تعتقد إنه خطأ.' };
      cred = signInCred; // نفس الحساب القديم (محذوف من قاعدة البيانات فقط) - نعيد فتح طلب انضمام جديد عليه
    }
    const payload = { displayName: String(displayName).trim(), username: uname, phone: cleanPhone, email: cleanEmail, status: 'pending', createdAt: new Date().toISOString(), approvedAt: null, deletedAt: null, lastLoginAt: null };
    // نكتب بيانات الفرع مباشرة برمز الدخول المؤقت الناتج من التسجيل، ونتحقق فعليًا من نجاح
    // الكتابة (لا نفترضها) - أحيانًا يحتاج رمز الدخول الجديد ثانية أو ثانيتين حتى يُعترف فيه
    // من قواعد الأمان (تأخير طبيعي بأنظمة Firebase)، فنعيد المحاولة مرة قبل ما نعتبرها فشلت.
    async function attemptWrite() {
      const r = await fetch(`${DB_URL}/branches/${cred.localId}.json?auth=${cred.idToken}`, { method: 'PUT', body: JSON.stringify(payload) });
      return r.ok;
    }
    let saved = await attemptWrite();
    if (!saved) { await new Promise(res => setTimeout(res, 1500)); saved = await attemptWrite(); }
    if (!saved) return { ok: false, message: 'تم إنشاء حسابك لكن تعذّر حفظ طلبك بقاعدة البيانات - جرّب التسجيل مرة ثانية بعد قليل، أو تواصل مع الإدارة مباشرة.' };
    fetch(`${DB_URL}/settings/adminEmail.json?auth=${cred.idToken}`).then(r => r.json()).then(adminEmail => {
      if (adminEmail) sendEmailNotification(adminEmail, 'طلب انضمام فرع جديد - ' + payload.displayName, 'فرع جديد "' + payload.displayName + '" (هاتف: ' + cleanPhone + ') أرسل طلب انضمام وينتظر موافقتك.');
    }).catch(() => { /* الإشعار اختياري */ });
    return { ok: true, message: 'تم إرسال طلب الانضمام. انتظر موافقة الإدارة قبل تسجيل الدخول (سجّل الدخول لاحقًا برقم هاتفك وكلمة المرور).' };
  } catch (e) { return { ok: false, message: e.message }; }
}
async function branchLogin(phone, password) {
  const cleanPhone = cleanPhoneNumber(phone);
  try {
    const cred = await authSignIn(cleanPhone + FAKE_EMAIL_DOMAIN, password);
    setSession({ role: 'branch', uid: cred.localId, idToken: cred.idToken, refreshToken: cred.refreshToken, tokenExpiresAt: Date.now() + Number(cred.expiresIn) * 1000 });
    const acc = await dbGet('branches/' + cred.localId);
    if (!acc || acc.deletedAt) { clearSession(); return { ok: false, message: 'حساب غير موجود.' }; }
    if (acc.status === 'pending') { clearSession(); return { ok: false, message: 'طلبك بانتظار موافقة الإدارة بعد.' }; }
    if (acc.status === 'rejected') { clearSession(); return { ok: false, message: 'تم رفض طلب انضمامك من قبل الإدارة.' }; }
    if (acc.status === 'suspended') { clearSession(); return { ok: false, message: 'حسابك موقوف حاليًا من قبل الإدارة.' }; }
    const s = getSession(); setSession({ ...s, branchName: acc.displayName });
    dbUpdate('branches/' + cred.localId, { lastLoginAt: new Date().toISOString() }).catch(() => { /* لا نمنع تسجيل الدخول لو فشل تسجيل الوقت فقط */ });
    return { ok: true, displayName: acc.displayName, message: 'تم تسجيل الدخول.' };
  } catch (e) { return { ok: false, message: e.message }; }
}
async function sessionMe() {
  const s = getSession();
  if (!s) return { role: null };
  if (s.role === 'admin') return { role: 'admin' };
  if (s.role === 'branch') {
    try {
      const acc = await dbGet('branches/' + s.uid);
      if (!acc || acc.deletedAt || acc.status !== 'approved') { clearSession(); return { role: null }; }
      const perms = (await dbGet('permissions/' + s.uid)) || {};
      const locked = Object.keys(perms).filter(k => perms[k] === false);
      return { role: 'branch', branchId: s.uid, displayName: acc.displayName, phone: acc.phone, email: acc.email, locked, pendingChanges: acc.pendingChanges || null };
    } catch (e) { clearSession(); return { role: null }; }
  }
  return { role: null };
}

// ---------- تعديل بيانات الفرع (يحتاج موافقة الإدارة قبل ما يُطبَّق فعليًا) ----------
async function branchRequestProfileChange(displayName, phone, email) {
  try {
    const s = getSession();
    if (!s || s.role !== 'branch') return { ok: false, message: 'سجّل الدخول كفرع أولاً.' };
    const cleanPhone = String(phone || '').replace(/[^0-9+]/g, '');
    await dbUpdate('branches/' + s.uid, {
      pendingChanges: { displayName: String(displayName || '').trim(), phone: cleanPhone, email: String(email || '').trim(), requestedAt: new Date().toISOString() }
    });
    // ملاحظة مهمة: تغيير رقم الهاتف هنا يحدّث رقم التواصل/واتساب المعروض فقط - رقم تسجيل
    // الدخول الفعلي يبقى دائمًا نفس الرقم اللي سجّلت فيه أول مرة (قيد تقني من Firebase
    // Authentication، ما نقدر نغيّره من خلال موافقة الإدارة وحدها بدون خادم خلفي).
    return { ok: true, message: 'تم إرسال طلب تعديل بياناتك للإدارة - بياناتك الحالية تبقى فعّالة لحد ما توافق الإدارة على التعديل. ملاحظة: لو غيّرت رقم الهاتف هنا، هذا يحدّث رقم التواصل/واتساب المعروض بس - رقم تسجيل الدخول يبقى نفس الرقم اللي سجّلت فيه أول مرة.' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function adminApproveProfileChange(branchId) {
  try {
    requireAdminSession();
    const acc = await dbGet('branches/' + branchId);
    if (!acc || !acc.pendingChanges) return { ok: false, message: 'لا يوجد طلب تعديل بانتظار الموافقة لهذا الفرع.' };
    const pc = acc.pendingChanges;
    await dbUpdate('branches/' + branchId, { displayName: pc.displayName, phone: pc.phone, email: pc.email, pendingChanges: null });
    return { ok: true, message: 'تم تحديث بيانات الفرع.' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function adminRejectProfileChange(branchId) {
  try { requireAdminSession(); await dbUpdate('branches/' + branchId, { pendingChanges: null }); return { ok: true, message: 'تم رفض طلب التعديل.' }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
}
// ملاحظة صريحة: تغيير كلمة المرور نفسه (بعكس الاسم/الهاتف/الإيميل) لا يمكن إخضاعه لموافقة
// الإدارة تقنيًا بدون خادم خلفي - Firebase Authentication الحقيقي يطبّق تغيير كلمة المرور
// فورًا لصاحب الحساب نفسه فقط (هذا أصلًا تصرف آمن ومتوقع، ما يحتاج إشراف بمعظم الأنظمة).
async function branchChangeOwnPassword(oldPassword, newPassword) {
  try {
    const s = getSession();
    if (!s || s.role !== 'branch') return { ok: false, message: 'سجّل الدخول كفرع أولاً.' };
    const acc = await dbGet('branches/' + s.uid);
    if (!acc) return { ok: false, message: 'حساب غير موجود.' };
    await authSignIn(acc.phone + FAKE_EMAIL_DOMAIN, oldPassword || '');
  } catch (e) { return { ok: false, message: 'كلمة المرور الحالية غير صحيحة.' }; }
  if (!newPassword || String(newPassword).length < 6) return { ok: false, message: 'كلمة المرور الجديدة يجب أن تكون 6 خانات على الأقل.' };
  try {
    const token = await getValidIdToken();
    const r = await fetch(`${AUTH_BASE}/accounts:update?key=${API_KEY}`, { method: 'POST', body: JSON.stringify({ idToken: token, password: newPassword, returnSecureToken: true }) });
    const data = await r.json();
    if (!r.ok) throw new Error(mapAuthError(data));
    const s = getSession();
    setSession({ ...s, idToken: data.idToken, refreshToken: data.refreshToken, tokenExpiresAt: Date.now() + Number(data.expiresIn) * 1000 });
    return { ok: true, message: 'تم تحديث كلمة مرورك.' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}

// ---------- إدارة الفروع (للإدارة فقط - قواعد الأمان بـ Firebase هي الحماية الحقيقية، هذا
// فقط تحقق سريع بالواجهة لمنع عرض أزرار لا تخصّك) ----------
function requireAdminSession() {
  const s = getSession();
  if (!s || s.role !== 'admin') throw new Error('هذا الإجراء يتطلب صلاحية إدارة.');
  return s;
}
async function listAllBranches() {
  const all = (await dbGet('branches')) || {};
  return Object.keys(all).map(id => ({ id, ...all[id] }));
}
async function adminListBranches(scope) {
  try {
    requireAdminSession();
    const rows = await listAllBranches();
    const perms = (await dbGet('permissions')) || {};
    let filtered = rows;
    if (scope === 'pending') filtered = rows.filter(r => r.status === 'pending' && !r.deletedAt);
    else if (scope === 'approved') filtered = rows.filter(r => r.status === 'approved' && !r.deletedAt);
    else if (scope === 'trash') filtered = rows.filter(r => !!r.deletedAt);
    else filtered = rows.filter(r => !r.deletedAt);
    return {
      ok: true, rows: filtered.map(r => {
        const isActive = !!(r.lastLoginAt && (Date.now() - new Date(r.lastLoginAt).getTime()) < 30 * 24 * 60 * 60 * 1000);
        return {
          id: r.id, displayName: r.displayName, username: r.username, status: r.status,
          phone: r.phone || '', email: r.email || '', lastLoginAt: r.lastLoginAt || null, isActive,
          hasPendingChanges: !!r.pendingChanges, pendingChanges: r.pendingChanges || null,
          rawPermissions: perms[r.id] || {},
          createdAt: r.createdAt, approvedAt: r.approvedAt, deletedAt: r.deletedAt,
          locked: Object.keys(perms[r.id] || {}).filter(k => perms[r.id][k] === false)
        };
      })
    };
  } catch (e) { return { ok: false, message: e.message || String(e), rows: [] }; }
}
async function adminSetStatus(id, status, extra) {
  try {
    requireAdminSession();
    await dbUpdate('branches/' + id, { status, ...(extra || {}) });
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}

// ---------- محرك التوزيع (يشتغل بالمتصفح مباشرة - نفس الملف المُختبَر بالضبط) ----------
const DEFAULT_CFG = {
  cover: 15, keep: 20, whMin: 20, minTr: 4, noSales: 0, manualQty: 0,
  exceptionQty: 4, exceptionSplitMin: 1, maxCover: 30, keepQty: 0, raiseSmallNeed: 0,
  salesRaise: 0, branchLimitMode: 'الأدنى', exceptionMode: 'كمية محددة لكل وجهة',
  zeroSalesKeep: 6, zeroSalesMode: 'رفض التوزيع إذا كانت المبيعات صفرية وفي المخزون كمية',
  zeroSalesStockLimit: 3, shortageStockThreshold: 0,
  filterMainCategory: [], filterSubCategory: [], filterBrand: []
};
// ملاحظة مهمة: قبل كنا نتجاهل أي خطأ بقراءة حدود الفروع/المستودعات بصمت ونرجع بيانات فاضية {}
// - وهذا كان يسبب بالضبط رسالة "لا توجد أي وجهة لها حد أدنى" حتى لو كانت الحدود محفوظة صح
// فعليًا بقاعدة البيانات (لو صار خطأ اتصال مؤقت وقت الضغط على "تشغيل")! الآن أي فشل حقيقي
// بالقراءة يظهر برسالة واضحة بدل ما "يختفي" ويبدو وكأن ما فيه حدود محفوظة أصلًا.
async function loadBranchLimitsMap() {
  try { return (await dbGet('limits/branch')) || {}; }
  catch (e) { throw new Error('تعذّر تحميل حدود الفروع الخاصة المحفوظة (' + (e.message || e) + ') - جرب تحديث الصفحة وإعادة المحاولة. إذا استمر الخطأ، تأكد من اتصال الإنترنت أو أعد تسجيل الدخول.'); }
}
async function loadWhLimitsMap() {
  try { return (await dbGet('limits/wh')) || {}; }
  catch (e) { throw new Error('تعذّر تحميل حدود المستودعات الخاصة المحفوظة (' + (e.message || e) + ') - جرب تحديث الصفحة وإعادة المحاولة.'); }
}
async function buildCfg(ui) {
  const cfg = { ...DEFAULT_CFG };
  Object.keys(DEFAULT_CFG).forEach(k => {
    if (ui[k] !== undefined && ui[k] !== '') cfg[k] = (typeof DEFAULT_CFG[k] === 'number') ? Number(String(ui[k]).replace(/,/g, '')) : ui[k];
  });
  const locs = window.LocationsModule.allLocations({});
  cfg.selectedSources = Array.isArray(ui.sources) && ui.sources.length ? ui.sources : locs.map(x => x.id);
  cfg.selectedDests = Array.isArray(ui.dests) && ui.dests.length ? ui.dests : window.LocationsModule.branchesOf({}).map(x => x.id);
  const blMap = await loadBranchLimitsMap(), whMap = await loadWhLimitsMap();
  cfg.branchLimits = {}; Object.keys(blMap).forEach(k => { cfg.branchLimits[k] = { min: blMap[k].min, max: blMap[k].max }; });
  cfg.whLimits = {}; Object.keys(whMap).forEach(k => { cfg.whLimits[k] = whMap[k].thr; });
  return cfg;
}
let runLock = false, lastShortageWh = null, lastShortageBr = null;
// ملاحظة مهمة: هذا القفل تحقق مساعد بالواجهة فقط - بعكس نسخة السيرفر (اللي كان يرفض الطلب
// فعليًا مهما حاول أحد تجاوز الواجهة)، هنا محرك التوزيع يشتغل بالكامل داخل متصفح المستخدم
// نفسه، فما فيه طرف مركزي "يرفض" التنفيذ تقنيًا. شخص متمرّس بالبرمجة يقدر يتجاوز هذا التحقق
// من نفس متصفحه. هذا قيد معروف لأي حل بدون سيرفر خلفي حقيقي.
async function checkBranchPermission(cmdKey) {
  const s = getSession();
  if (s && s.role === 'branch') {
    try {
      const perms = (await dbGet('permissions/' + s.uid)) || {};
      if (perms[cmdKey] === false) throw new Error('هذا الأمر مقفل على فرعك من قبل الإدارة.');
    } catch (e) {
      if (e.message && e.message.includes('مقفل')) throw e; // القفل الفعلي نفسه، نمرره كما هو
      // أي خطأ اتصال آخر (لا صلاحية قراءة، انقطاع نت) - نسمح بالتنفيذ بدل ما نمنعه بالغلط
    }
  }
}
async function doRun(mode, manual, ui, cmdKey) {
  await checkBranchPermission(cmdKey);
  if (runLock) throw new Error('التشغيل مقفل حاليًا، يوجد تشغيل آخر قيد التنفيذ بهذا المتصفح.');
  runLock = true;
  try {
    const loaded = await ensureExcelLoaded();
    const ctx = loaded.ctx;
    const cfg = await buildCfg(ui || {});
    const result = window.EngineModule.runDistribution(mode, manual, cfg, ctx, () => {});
    window._lastResult = result;
    return {
      ok: true, runId: result.runId, products: result.summary.products, transfers: result.summary.transfers,
      qty: result.summary.qty, rejected: result.summary.rejected, critical: result.summary.critical.length,
      coveredPct: result.summary.coveredPct, elapsed: result.elapsed, message: result.message
    };
  } finally { runLock = false; }
}

// ---------- ملف Excel (مخزَّن على شكل "قطع" صغيرة داخل قاعدة البيانات نفسها - يبقينا على
// الخطة المجانية بالكامل بدون Firebase Storage، اللي صار يتطلب خطة مدفوعة. كل قطعة صغيرة
// جدًا (٥٠٠ ألف حرف كحد أقصى) عشان ما تصطدم بأي حد حجم لكتابة واحدة). ----------
const EXCEL_CHUNK_SIZE = 500000; // حروف base64 لكل قطعة - آمن جدًا وبعيد عن أي حد حجم معروف

async function excelChoose() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.xlsx,.xlsm,.xls'; input.style.display = 'none';
    input.onchange = async () => {
      if (!input.files || !input.files[0]) { resolve({ ok: false, message: 'تم إلغاء الاختيار.' }); document.body.removeChild(input); return; }
      const file = input.files[0];
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = ''; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);
        const chunks = [];
        for (let i = 0; i < base64.length; i += EXCEL_CHUNK_SIZE) chunks.push(base64.slice(i, i + EXCEL_CHUNK_SIZE));
        // نحذف القطع القديمة أولًا (لو الملف الجديد له عدد قطع أقل من القديم، تبقى قطع زايدة قديمة بالغلط)
        await dbSet('excelChunks', null).catch(() => { /* تجاهل لو ما فيه شي أصلًا */ });
        for (let i = 0; i < chunks.length; i++) await dbSet('excelChunks/' + i, chunks[i]);
        const modifiedAt = new Date().toISOString();
        await dbSet('excelMeta', { name: file.name, modifiedAt, chunkCount: chunks.length });
        currentExcel = null;
        const loaded = window.ExcelLoaderModule.readWorkbook(bytes, file.name, modifiedAt);
        currentExcel = loaded;
        resolve({ ok: true, ...loaded.info, message: 'تم رفع ملف Excel وأصبح جاهزًا للتشغيل (ومشتركًا لكل الفروع تلقائيًا).' });
      } catch (e) { resolve({ ok: false, message: e.message || String(e) }); }
      document.body.removeChild(input);
    };
    document.body.appendChild(input);
    input.click();
  });
}
async function excelGetCurrent() {
  try { const loaded = await ensureExcelLoaded(); return { ok: true, ...loaded.info, message: 'الملف المشترك الحالي: ' + loaded.info.name }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function excelReload() {
  currentExcel = null;
  return excelGetCurrent();
}

// ---------- الفئات ----------
function scopeBarcodes(ctx, scope) {
  if (scope === 'stock') return ctx.barcodes;
  if (scope === 'both') return Array.from(new Set(ctx.needBarcodes.concat(ctx.barcodes)));
  return ctx.needBarcodes;
}
async function categoryAudit(scope) {
  try {
    const loaded = await ensureExcelLoaded();
    const barcodes = scopeBarcodes(loaded.ctx, scope);
    const rows = window.ExcelLoaderModule.categoryAudit(loaded.ctx, barcodes);
    return { ok: true, rows, message: `تم فحص ${barcodes.length} منتج: وُجدت ${rows.length} تركيبة فئة/براند مختلفة.` };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}

// ---------- الحدود ----------
async function limitsLoadBranch() {
  try {
    const map = await loadBranchLimitsMap();
    const all = window.LocationsModule.allLocations({});
    return all.map(x => ({ id: x.id, ar: x.ar, min: map[x.id] ? (map[x.id].min ?? '') : '', max: map[x.id] ? (map[x.id].max ?? '') : '' }));
  } catch (e) { return window.LocationsModule.allLocations({}).map(x => ({ id: x.id, ar: x.ar, min: '', max: '' })); }
}
async function limitsSaveBranch(rows) {
  try {
    const map = {};
    rows.forEach(r => { map[safeKey(r.id)] = { min: r.min === '' ? null : r.min, max: r.max === '' ? null : r.max }; });
    await dbSet('limits/branch', map);
    return { ok: true, message: 'تم حفظ حدود الفروع' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function limitsLoadWh() {
  try {
    const map = await loadWhLimitsMap();
    return window.LocationsModule.warehousesOf({}).map(x => ({ id: x.id, ar: x.ar, thr: map[x.id] ? map[x.id].thr : '' }));
  } catch (e) { return window.LocationsModule.warehousesOf({}).map(x => ({ id: x.id, ar: x.ar, thr: '' })); }
}
async function limitsSaveWh(rows) {
  try {
    const map = {};
    rows.forEach(r => { map[safeKey(r.id)] = { thr: r.thr === '' ? null : r.thr }; });
    await dbSet('limits/wh', map);
    return { ok: true, message: 'تم حفظ حدود المستودعات' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}

// ==================== الدردشة (ثنائية + جماعية + بين الفروع) ====================
// كل رسالة تُخزَّن بقاعدة البيانات، والمرفقات (ملفات/صوت/فيديو) كنص base64 داخل الرسالة نفسها
// لتبسيط هذي المرحلة (يشتغل تمام للأحجام المعتادة؛ لاحقًا يُفضَّل نقل الملفات الكبيرة جدًا
// لـ Firebase Storage). التحديث الحالي عبر "تحديث عند الفتح/كل فترة" وليس بثًا لحظيًا حقيقيًا
// (يحتاج مكتبة Firebase SDK الكاملة بدل REST البسيط المستخدم هنا - يُضاف بمرحلة قادمة لو احتجناه).

function meIdentity() {
  const s = getSession();
  if (!s) return null;
  if (s.role === 'admin') return { id: 'admin', name: 'الإدارة' };
  return { id: s.uid, name: s.branchName || 'فرع' };
}
function isAdminSession() { const s = getSession(); return !!(s && s.role === 'admin'); }

async function ensureDirectConversation(branchUid, branchName) {
  const convId = 'dm-' + branchUid;
  const existing = await dbGet('conversations/' + convId).catch(() => null);
  if (!existing) {
    await dbSet('conversations/' + convId, { type: 'direct', name: branchName || null, createdAt: new Date().toISOString(), deletedAt: null, pausedAt: null, members: { [branchUid]: true } });
  }
  await dbSet('userConversations/' + branchUid + '/' + convId, true).catch(() => { /* الفرع نفسه يكتب فهرسه، متوقع ينجح */ });
  return convId;
}

async function chatConversations(scope) {
  try {
    const me = meIdentity();
    if (!me) return { ok: false, message: 'سجّل الدخول أولاً.' };
    if (isAdminSession()) {
      // نضمن وجود محادثة ثنائية جاهزة مع كل فرع معتمد وغير محذوف
      const branches = await listAllBranches().catch(() => []);
      for (const b of branches) {
        if (b.status === 'approved' && !b.deletedAt) await ensureDirectConversation(b.id, b.displayName);
      }
      const all = (await dbGet('conversations')) || {};
      const convIds = Object.keys(all).filter(id => (scope === 'trash') ? !!all[id].deletedAt : !all[id].deletedAt);
      return { ok: true, rows: await Promise.all(convIds.map(id => decorateConv(id, all[id], me.id))) };
    } else {
      // فرع عادي: ما يقدر (ولا يفترض) يقرأ كل قائمة المحادثات - فقط فهرسه الخاص
      await ensureDirectConversation(me.id, me.name);
      const myIndex = (await dbGet('userConversations/' + me.id)) || {};
      const convIds = Object.keys(myIndex);
      const rows = [];
      for (const id of convIds) {
        const conv = await dbGet('conversations/' + id).catch(() => null);
        if (!conv) continue;
        const isTrash = !!conv.deletedAt;
        if ((scope === 'trash') !== isTrash) continue;
        rows.push(await decorateConv(id, conv, me.id));
      }
      return { ok: true, rows };
    }
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function decorateConv(id, conv, viewerId) {
  let name = conv.name;
  let otherId = null;
  if (conv.type === 'direct') { otherId = viewerId === 'admin' ? id.replace(/^dm-/, '') : 'admin'; if (!name) name = id.replace(/^dm-/, ''); }
  if (conv.type === 'peer') {
    const others = Object.keys(conv.members || {}).filter(m => m !== viewerId);
    otherId = others[0] || null;
    if (!name) {
      const names = await Promise.all(others.map(async id => { const acc = await dbGet('branches/' + id).catch(() => null); return acc ? acc.displayName : id; }));
      name = names.join(' ↔ ') || 'دردشة بين فروع';
    }
  }
  const msgs = (await dbGet('messages/' + id).catch(() => null)) || {};
  const msgIds = Object.keys(msgs).sort();
  const last = msgIds.length ? msgs[msgIds[msgIds.length - 1]] : null;
  return { id, type: conv.type, name, otherId, paused: !!conv.pausedAt, deletedAt: conv.deletedAt, lastMessage: last ? { body: last.body, senderName: last.senderName, hasFile: !!last.fileData } : null };
}
async function chatMessages(convId) {
  try {
    const me = meIdentity();
    if (!me) return { ok: false, message: 'سجّل الدخول أولاً.' };
    const conv = await dbGet('conversations/' + convId);
    if (!conv) return { ok: false, message: 'المحادثة غير موجودة.' };
    const decorated = await decorateConv(convId, conv, me.id);
    const msgs = (await dbGet('messages/' + convId)) || {};
    const rows = Object.keys(msgs).sort().map(mid => {
      const m = msgs[mid];
      return { id: mid, senderId: m.senderId, senderName: m.senderName, body: m.body, fileName: m.fileName, hasFile: !!m.fileData, createdAt: m.createdAt, _fileData: m.fileData };
    });
    // نعلّم هذي المحادثة "مقروءة" لحظة ما نفتحها - هذا اللي يخلي شارة "🔔 رسالة جديدة" تختفي
    // بمجرد ما تشوف الرسالة، ويحسب أي رسالة تجي بعد كذا كـ"غير مقروءة" من جديد.
    dbSet('readMarks/' + me.id + '/' + convId, new Date().toISOString()).catch(() => { /* اختياري - ما يوقف فتح المحادثة */ });
    return { ok: true, rows, conversation: { id: convId, type: conv.type, name: decorated.name, paused: decorated.paused, otherId: decorated.otherId } };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
// ---------- عدد الرسائل غير المقروءة (لشارة 💬 بالقائمة الجانبية) ----------
// ملاحظة: بدون بث لحظي حقيقي، هذا يُحسَب عند كل فحص دوري (كل 15 ثانية من home-ui.js) بقراءة
// آخر رسالة بكل محادثة أنت عضو فيها ومقارنتها بآخر وقت فتحت فيه تلك المحادثة (readMarks).
async function chatUnreadCount() {
  try {
    const me = meIdentity();
    if (!me) return 0;
    let convIds;
    if (isAdminSession()) {
      const all = (await dbGet('conversations')) || {};
      convIds = Object.keys(all).filter(id => !all[id].deletedAt);
    } else {
      const myIndex = (await dbGet('userConversations/' + me.id)) || {};
      convIds = Object.keys(myIndex);
    }
    const myReads = (await dbGet('readMarks/' + me.id).catch(() => null)) || {};
    let count = 0;
    for (const id of convIds) {
      const msgs = (await dbGet('messages/' + id).catch(() => null)) || {};
      const msgIds = Object.keys(msgs).sort();
      if (!msgIds.length) continue;
      const last = msgs[msgIds[msgIds.length - 1]];
      if (last.senderId === me.id) continue; // آخر رسالة مني أنا - مو غير مقروءة
      const lastReadAt = myReads[id];
      if (!lastReadAt || new Date(last.createdAt) > new Date(lastReadAt)) count++;
    }
    return count;
  } catch (e) { return 0; }
}
async function chatSend(convId, body, file) {
  try {
    const me = meIdentity();
    if (!me) return { ok: false, message: 'سجّل الدخول أولاً.' };
    const conv = await dbGet('conversations/' + convId).catch(() => null);
    if (conv && conv.pausedAt && !isAdminSession()) return { ok: false, message: 'تم إيقاف هذه المحادثة مؤقتًا من قبل الإدارة.' };
    if (!body || !body.trim()) { if (!file) return { ok: false, message: 'اكتب رسالة أو أرفق ملفًا.' }; }
    let fileData = null, fileName = null;
    if (file) {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = ''; for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      fileData = btoa(binary); fileName = file.name;
    }
    const msgId = String(Date.now()) + '_' + randomHex(3);
    await dbSet('messages/' + convId + '/' + msgId, { senderId: me.id, senderName: me.name, body: body || '', fileData, fileName, createdAt: new Date().toISOString() });
    notifyConversationMembers(convId, conv, me).catch(() => { /* الإشعار اختياري، ما يوقف الإرسال أبدًا */ });
    return { ok: true, id: msgId };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function notifyConversationMembers(convId, conv, sender) {
  const adminEmail = await dbGet('settings/adminEmail').catch(() => null);
  const subject = 'رسالة جديدة من ' + sender.name + ' - منصة التوزيع الذكي';
  const bodyMsg = sender.name + ' أرسل رسالة جديدة بمنصة التوزيع الذكي.';
  if (sender.id !== 'admin' && adminEmail) sendEmailNotification(adminEmail, subject, bodyMsg);
  if (!conv) return;
  const memberIds = conv.type === 'direct' ? ['admin'] : Object.keys(conv.members || {});
  for (const mid of memberIds) {
    if (mid === sender.id || mid === 'admin') continue;
    const acc = await dbGet('branches/' + mid).catch(() => null);
    if (acc && acc.email) sendEmailNotification(acc.email, subject, bodyMsg);
  }
}
async function chatFileUrl(convId, msgId) {
  // بما إن الملف مخزَّن base64 بالرسالة نفسها (لا رابط تنزيل مباشر منفصل)، نجيبه ونحوّله لرابط Blob محليًا عند الطلب
  const m = await dbGet('messages/' + convId + '/' + msgId).catch(() => null);
  if (!m || !m.fileData) return null;
  const binary = atob(m.fileData);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes]);
  return { url: URL.createObjectURL(blob), name: m.fileName };
}
async function chatDeleteConversation(id) { try { requireAdminSession(); await dbUpdate('conversations/' + id, { deletedAt: new Date().toISOString() }); return { ok: true, message: 'تم نقل المحادثة إلى سلة المحذوفات.' }; } catch (e) { return { ok: false, message: e.message || String(e) }; } }
async function chatRestoreConversation(id) { try { requireAdminSession(); await dbUpdate('conversations/' + id, { deletedAt: null }); return { ok: true, message: 'تم استرجاع المحادثة.' }; } catch (e) { return { ok: false, message: e.message || String(e) }; } }
async function chatPauseConversation(id) { try { requireAdminSession(); await dbUpdate('conversations/' + id, { pausedAt: new Date().toISOString() }); return { ok: true, message: 'تم إيقاف المحادثة مؤقتًا.' }; } catch (e) { return { ok: false, message: e.message || String(e) }; } }
async function chatResumeConversation(id) { try { requireAdminSession(); await dbUpdate('conversations/' + id, { pausedAt: null }); return { ok: true, message: 'تم رفع الإيقاف.' }; } catch (e) { return { ok: false, message: e.message || String(e) }; } }

// ---- المجموعات (الإدارة فقط تنشئ وتتحكم بالأعضاء) ----
async function chatGroupCandidates() {
  try { requireAdminSession(); const rows = await listAllBranches(); return { ok: true, rows: rows.filter(r => r.status === 'approved' && !r.deletedAt).map(r => ({ id: r.id, displayName: r.displayName })) }; }
  catch (e) { return { ok: false, message: e.message || String(e), rows: [] }; }
}
async function chatPeerCandidates() {
  try {
    const me = meIdentity();
    if (!me || isAdminSession()) return { ok: false, message: 'هذا متاح لحسابات الفروع فقط.', rows: [] };
    const rows = await listAllBranches();
    return { ok: true, rows: rows.filter(r => r.status === 'approved' && !r.deletedAt && r.id !== me.id).map(r => ({ id: r.id, displayName: r.displayName })) };
  } catch (e) { return { ok: false, message: e.message || String(e), rows: [] }; }
}
async function chatCreateGroup(name, memberBranchIds) {
  try {
    requireAdminSession();
    if (!name || !String(name).trim()) return { ok: false, message: 'اكتب اسم المجموعة.' };
    if (!Array.isArray(memberBranchIds) || !memberBranchIds.length) return { ok: false, message: 'اختر عضو واحد على الأقل.' };
    const id = 'grp-' + randomHex(6);
    const members = {}; memberBranchIds.forEach(m => { members[m] = true; });
    await dbSet('conversations/' + id, { type: 'group', name: String(name).trim(), createdAt: new Date().toISOString(), deletedAt: null, pausedAt: null, members });
    for (const m of memberBranchIds) await dbSet('userConversations/' + m + '/' + id, true);
    return { ok: true, id, message: 'تم إنشاء مجموعة "' + name + '".' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function chatSetGroupMember(convId, branchId, add) {
  try {
    requireAdminSession();
    await dbUpdate('conversations/' + convId + '/members', { [branchId]: add ? true : null });
    if (add) await dbSet('userConversations/' + branchId + '/' + convId, true);
    else await dbDelete('userConversations/' + branchId + '/' + convId);
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}

// ---- طلبات الدردشة بين الفروع (تحتاج موافقة الإدارة) ----
async function chatPeerRequest(targetBranchId) {
  try {
    const me = meIdentity();
    if (!me || isAdminSession()) return { ok: false, message: 'هذا متاح لحسابات الفروع فقط.' };
    await checkBranchPermission('peerChat');
    if (targetBranchId === me.id) return { ok: false, message: 'ما تقدر تطلب دردشة مع نفسك.' };
    const target = await dbGet('branches/' + targetBranchId).catch(() => null);
    if (!target || target.deletedAt || target.status !== 'approved') return { ok: false, message: 'الفرع المطلوب غير موجود أو غير معتمد.' };
    const peerConvId = 'peer-' + [me.id, targetBranchId].sort().join('-');
    const already = await dbGet('conversations/' + peerConvId).catch(() => null);
    if (already && !already.deletedAt) return { ok: false, message: 'يوجد بينكما محادثة مفتوحة أصلًا.' };
    const reqId = 'preq-' + randomHex(6);
    await dbSet('peerRequests/' + reqId, { requesterId: me.id, requesterName: me.name, targetId: targetBranchId, status: 'pending', createdAt: new Date().toISOString() });
    return { ok: true, message: 'تم إرسال طلبك للإدارة - بانتظار الموافقة قبل ما تقدر تبدأ الدردشة مع هذا الفرع.' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function chatPeerRequests(status) {
  try {
    requireAdminSession();
    const all = (await dbGet('peerRequests')) || {};
    const rows = await Promise.all(Object.keys(all).filter(id => !status || all[id].status === status).map(async id => {
      const r = all[id];
      const tgt = await dbGet('branches/' + r.targetId).catch(() => null);
      return { id, requesterId: r.requesterId, requesterName: r.requesterName, targetId: r.targetId, targetName: tgt ? tgt.displayName : r.targetId, status: r.status, createdAt: r.createdAt };
    }));
    return { ok: true, rows };
  } catch (e) { return { ok: false, message: e.message || String(e), rows: [] }; }
}
async function chatPeerApprove(reqId) {
  try {
    requireAdminSession();
    const pr = await dbGet('peerRequests/' + reqId);
    if (!pr || pr.status !== 'pending') return { ok: false, message: 'الطلب غير موجود أو تمت معالجته مسبقًا.' };
    const convId = 'peer-' + [pr.requesterId, pr.targetId].sort().join('-');
    const members = { [pr.requesterId]: true, [pr.targetId]: true };
    await dbSet('conversations/' + convId, { type: 'peer', name: null, createdAt: new Date().toISOString(), deletedAt: null, pausedAt: null, members });
    await dbSet('userConversations/' + pr.requesterId + '/' + convId, true);
    await dbSet('userConversations/' + pr.targetId + '/' + convId, true);
    await dbUpdate('peerRequests/' + reqId, { status: 'approved' });
    return { ok: true, message: 'تمت الموافقة - صارت الدردشة بين الفرعين متاحة الآن.' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function chatPeerReject(reqId) {
  try { requireAdminSession(); await dbUpdate('peerRequests/' + reqId, { status: 'rejected' }); return { ok: true, message: 'تم رفض طلب الدردشة.' }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
}

// ---- قوالب الرسائل (الإدارة تضيف/تحذف، الكل يقرأ) ----
async function chatTemplates() {
  try {
    const all = (await dbGet('templates')) || {};
    return { ok: true, rows: Object.keys(all).map(id => ({ id, title: all[id].title, body: all[id].body })) };
  } catch (e) { return { ok: false, message: e.message || String(e), rows: [] }; }
}
async function chatAddTemplate(title, body) {
  try {
    requireAdminSession();
    if (!title || !body) return { ok: false, message: 'اكتب عنوان ونص القالب.' };
    await dbSet('templates/' + randomHex(6), { title, body });
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function chatDeleteTemplate(id) {
  try { requireAdminSession(); await dbDelete('templates/' + id); return { ok: true }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
}

// ==================== إشارات المكالمات الصوتية/المرئية (عبر Firebase بدل SSE) ====================
// ملاحظة صريحة: بدون سيرفر حي، ما فيه "دفع لحظي فوري" (Push) حقيقي بأدوات REST البسيطة
// المستخدمة هنا - الحل هو "فحص دوري" (Polling) كل ثانيتين أثناء وجودك بصفحة الدردشة. يعني
// المكالمة الواردة ممكن تتأخر لحظتين قبل ما تظهر، بعكس نظام السيرفر السابق (لحظي تمامًا).
async function callInvite(targetId, conversationId, kind, offer) {
  try {
    const me = meIdentity();
    await dbSet('calls/' + targetId + '/incoming', { from: me.id, fromName: me.name, conversationId, kind, offer, createdAt: Date.now() });
    return { ok: true };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function callAnswer(targetId, answer) {
  try { const me = meIdentity(); await dbSet('calls/' + targetId + '/answer/' + me.id, { answer, createdAt: Date.now() }); return { ok: true }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function callIce(targetId, candidate) {
  try { const me = meIdentity(); await dbSet('calls/' + targetId + '/ice/' + me.id + '/' + randomHex(4), candidate); return { ok: true }; }
  catch (e) { return { ok: false, message: e.message || String(e) }; }
}
async function callDecline(targetId) { try { await dbDelete('calls/' + targetId + '/incoming'); return { ok: true }; } catch (e) { return { ok: false }; } }
async function callHangup(targetId) {
  try {
    const me = meIdentity();
    await dbDelete('calls/' + targetId + '/incoming');
    await dbDelete('calls/' + targetId + '/answer/' + me.id);
    await dbDelete('calls/' + me.id);
    return { ok: true };
  } catch (e) { return { ok: false }; }
}
async function callBusy(targetId) { try { await dbDelete('calls/' + targetId + '/incoming'); return { ok: true }; } catch (e) { return { ok: false }; } }

let _callPollTimer = null, _callEventCb = null, _lastSeenIce = {};
function startCallPolling() {
  if (_callPollTimer) return;
  _callPollTimer = setInterval(async () => {
    const me = meIdentity();
    if (!me || !_callEventCb) return;
    try {
      const incoming = await dbGet('calls/' + me.id + '/incoming');
      if (incoming) {
        const key = 'invite_' + incoming.from + '_' + incoming.createdAt;
        if (!_lastSeenIce[key]) { _lastSeenIce[key] = true; _callEventCb({ type: 'invite', from: incoming.from, fromName: incoming.fromName, conversationId: incoming.conversationId, kind: incoming.kind, offer: incoming.offer }); }
      }
      const answers = await dbGet('calls/' + me.id + '/answer');
      if (answers) {
        Object.keys(answers).forEach(fromUid => {
          const key = 'ans_' + fromUid + '_' + answers[fromUid].createdAt;
          if (!_lastSeenIce[key]) { _lastSeenIce[key] = true; _callEventCb({ type: 'answer', from: fromUid, answer: answers[fromUid].answer }); }
        });
      }
      const ice = await dbGet('calls/' + me.id + '/ice');
      if (ice) {
        Object.keys(ice).forEach(fromUid => {
          Object.keys(ice[fromUid] || {}).forEach(iceId => {
            const key = 'ice_' + fromUid + '_' + iceId;
            if (!_lastSeenIce[key]) { _lastSeenIce[key] = true; _callEventCb({ type: 'ice', from: fromUid, candidate: ice[fromUid][iceId] }); }
          });
        });
      }
    } catch (e) { /* تجاهل أخطاء الفحص الدوري */ }
  }, 4000); // خفّضناها من 2 ثانية لـ4 - كانت تسوي طلب شبكة مستمر باستمرار طوال الجلسة، وهذا سبب محتمل قوي للبطء اللي لاحظته
}


// ---------- تصدير النتائج كملف Excel حقيقي (يتم كامل داخل متصفحك عبر مكتبة XLSX نفسها) ----------
// ملاحظة: استبدلنا مكتبة SheetJS العادية بمكتبة "xlsx-js-style" (نفس المحرك، لكنها مجانية
// بالكامل وتدعم الألوان/الخطوط الغامقة/الحدود عند الكتابة - بعكس النسخة المجانية القديمة اللي
// كانت تتجاهل أي تنسيق). هذا هو سبب اختلاف شكل الملف الناتج سابقًا (عادي بدون ألوان) عن ملفات
// أخرى كانت منسّقة - الآن نفس هذا المصدّر ينتج ملفات منسّقة بالألوان دائمًا.
const XLSX_HEADER_STYLE = {
  fill: { patternType: 'solid', fgColor: { rgb: '1F3864' } },
  font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 11 },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: {
    top: { style: 'thin', color: { rgb: 'B7C3D0' } }, bottom: { style: 'thin', color: { rgb: 'B7C3D0' } },
    left: { style: 'thin', color: { rgb: 'B7C3D0' } }, right: { style: 'thin', color: { rgb: 'B7C3D0' } }
  }
};
function xlsxBodyStyle(isAltRow) {
  return {
    fill: { patternType: 'solid', fgColor: { rgb: isAltRow ? 'F2F5FA' : 'FFFFFF' } },
    font: { sz: 11 },
    alignment: { vertical: 'center', wrapText: false },
    border: {
      top: { style: 'thin', color: { rgb: 'E3E8EF' } }, bottom: { style: 'thin', color: { rgb: 'E3E8EF' } },
      left: { style: 'thin', color: { rgb: 'E3E8EF' } }, right: { style: 'thin', color: { rgb: 'E3E8EF' } }
    }
  };
}
function downloadAoaAsXlsx(sheets, filename) {
  const wb = window.XLSX.utils.book_new();
  sheets.forEach(s => {
    const ws = window.XLSX.utils.aoa_to_sheet(s.rows);
    if (s.rows.length) {
      const colCount = s.rows[0].length;
      // عرض أعمدة تلقائي حسب أطول محتوى بكل عمود
      ws['!cols'] = s.rows[0].map((_, colIdx) => {
        let maxLen = 8;
        s.rows.forEach(r => { const v = r[colIdx]; if (v !== undefined && v !== null) maxLen = Math.max(maxLen, String(v).length); });
        return { wch: Math.min(45, maxLen + 3) };
      });
      ws['!autofilter'] = { ref: window.XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.rows.length - 1, c: colCount - 1 } }) };
      ws['!rows'] = [{ hpx: 26 }]; // ارتفاع أكبر لصف العناوين
      ws['!freeze'] = { xSplit: 0, ySplit: 1 }; // تجميد صف العناوين عند التمرير
      // تلوين صف العناوين + تلوين متبادل لصفوف البيانات + حدود لكل الخلايا
      for (let c = 0; c < colCount; c++) {
        const headCellRef = window.XLSX.utils.encode_cell({ r: 0, c });
        if (ws[headCellRef]) ws[headCellRef].s = XLSX_HEADER_STYLE;
        for (let r = 1; r < s.rows.length; r++) {
          const cellRef = window.XLSX.utils.encode_cell({ r, c });
          if (ws[cellRef]) ws[cellRef].s = xlsxBodyStyle(r % 2 === 0);
        }
      }
    }
    ws['!sheetFormat'] = { defaultRowHeight: 20 };
    ws['!views'] = [{ rightToLeft: true }]; // اتجاه يمين-لشمال يناسب المحتوى العربي
    window.XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31)); // أسماء أوراق Excel محدودة بـ٣١ حرف
  });
  window.XLSX.writeFile(wb, filename + '.xlsx', { cellStyles: true });
}
function branchRowsToAoA(rows) {
  // المستودعات تخزين فقط، ما فيها "مبيعات" أصلًا - فلو كل صفوف هذا التقرير مصدرها مستودعات
  // (صفر مبيعات دائمًا)، نحذف عمودي مبيعات المصدر كليًا لتقليل الزحمة، بدل عرضهما فاضيين دومًا.
  const allSrcSalesZero = rows.length > 0 && rows.every(r => !r.srcS90 && !r.srcS30);
  const heads = ['Run ID', 'الباركود', 'اسم المنتج', 'الأولوية', 'الفئة', 'تاريخ آخر شراء', 'كمية آخر شراء', 'استلام آخر 10 أيام', 'المصدر', 'اسم المصدر'];
  if (!allSrcSalesZero) heads.push('مبيعات 3 أشهر المصدر', 'مبيعات 30 يوم المصدر');
  heads.push('مخزون المصدر قبل', 'المتبقي بالمصدر', 'الوجهة', 'اسم الوجهة', 'مبيعات 3 أشهر الوجهة', 'مبيعات 30 يوم الوجهة', 'مخزون الوجهة', 'في التحويل للوجهة', 'الكمية المحولة', 'فئة A', 'نوع الأمر', 'الاحتياج', 'هدف التغطية', 'سبب اختيار المصدر', 'تغطية قبل', 'تغطية بعد', 'درجة الخطر', 'سقف التصنيع الخاص');
  const body = rows.map(r => {
    const row = [r.runId, r.barcode, r.name, r.priority, r.category, r.purchaseDate, r.purchaseQty, r.rec10, r.srcId, r.srcAr];
    if (!allSrcSalesZero) row.push(r.srcS90 || 0, r.srcS30 || 0);
    row.push(r.srcStock, r.srcRemain, r.destId, r.destAr, r.destS90, r.destS30, r.destStock, r.destIncoming || 0, r.qty, r.aClass, r.mode, r.need, r.coverTarget, r.reason, r.beforeDays, r.afterDays, r.risk, r.specCap || 0);
    return row;
  });
  return [heads, ...body];
}
function raiseRowsToAoA(rows) {
  const heads = ['Run ID', 'كود الرفض', 'الباركود', 'اسم المنتج', 'درجة الأولوية', 'الوجهة/المصدر', 'اسم عربي', 'سبب عدم التوزيع', 'نوع المشكلة', 'التفصيل', 'الاحتياج', 'في التحويل', 'المتبقي', 'نوع الأمر'];
  const body = rows.map(r => [r.runId, r.code, r.barcode, r.name, r.priority, r.target, r.targetAr, r.reason, r.type, r.detail, r.need, r.incoming, r.remaining, r.mode]);
  return [heads, ...body];
}
function shortageWhRowsToAoA(rows) {
  const heads = ['الباركود', 'اسم المنتج', 'فئة المنتج', 'اسم المصدر', 'الوجهة', 'اسم الوجهة عربي', 'مبيعات 3 أشهر الوجهة', 'مبيعات 30 يوم الوجهة', 'مخزون الوجهة', 'في التحويل للوجهة', 'النقص المحسوب', 'هدف تغطية الأيام', 'مخزون المستودع', 'المتاح من هذا المستودع (فوق حد المستودع)', 'الكمية المقترحة للتحويل', 'سبب اعتبار المنتج ناقص'];
  const body = rows.map(r => [r.barcode, r.name, r.category, r.srcAr, r.destId, r.destAr, r.destS90, r.destS30, r.destStock, r.destIncoming, r.need, r.cover, r.srcStock, r.srcAvail, r.qty, r.why]);
  return [heads, ...body];
}
function shortageBrRowsToAoA(rows) {
  const heads = ['الباركود', 'اسم المنتج', 'المصدر', 'اسم المصدر', 'مبيعات 3 أشهر المصدر', 'مبيعات 30 يوم المصدر', 'مخزون المصدر قبل', 'المتبقي بالمصدر بعد الاقتراح', 'الوجهة', 'اسم الوجهة عربي', 'مبيعات 3 أشهر الوجهة', 'مبيعات 30 يوم الوجهة', 'مخزون الوجهة', 'في التحويل للوجهة', 'النقص المحسوب', 'هدف تغطية الأيام', 'الكمية المقترحة للتوزيع', 'سبب اعتبار المنتج ناقص'];
  const body = rows.map(r => [r.barcode, r.name, r.srcId, r.srcAr, r.srcS90, r.srcS30, r.srcStock, r.srcRemain, r.destId, r.destAr, r.destS90, r.destS30, r.destStock, r.destIncoming, r.need, r.cover, r.qty, r.why]);
  return [heads, ...body];
}

async function runShortageWarehouses(ui) {
  await checkBranchPermission('shortageWarehouses');
  const loaded = await ensureExcelLoaded();
  const cfg = await buildCfg(ui || {});
  const r = window.EngineModule.shortageFromWarehouses(cfg, loaded.ctx, cfg);
  lastShortageWh = r;
  const dups = (loaded.ctx.stockDupList || []).length;
  return { ok: r.ok, message: r.message + (dups ? `\n⚠️ ملاحظة: يوجد ${dups} باركود مكرر في صفحة المخزون قد يؤثر على دقة الأرقام.` : '') };
}
async function runShortageBranches(ui) {
  await checkBranchPermission('shortageBranches');
  const loaded = await ensureExcelLoaded();
  const cfg = await buildCfg(ui || {});
  const r = window.EngineModule.shortageBranchToBranch(cfg, loaded.ctx, cfg);
  lastShortageBr = r;
  const dups = (loaded.ctx.stockDupList || []).length;
  return { ok: r.ok, message: r.message + (dups ? `\n⚠️ ملاحظة: يوجد ${dups} باركود مكرر في صفحة المخزون قد يؤثر على دقة الأرقام.` : '') };
}

// ==================== تتبع "متى تم تحديث كل صفحة بالملف" (يدوي - أنت أو من تفوّضه) ====================
const SHEET_KEYS = {
  stock: 'المخزون', sales90: 'مبيعات 3 أشهر', sales30: 'مبيعات 30 يوم', purchases: 'المشتريات',
  rec10: 'استلام آخر 10 أيام', incoming: 'في التحويل الى', moved: 'نقل من', spec: 'التصنيع الخاص',
  category: 'فئة المنتج', aclass: 'فئة A', need: 'المنتجات التي يحتاج لها توزيع', restrict: 'غير متحرك من الفروع'
};
async function checkUpdateSheetsPermission() {
  const s = getSession();
  if (s && s.role === 'branch') {
    // عكس منطق أوامر التشغيل تمامًا: هذا الإجراء ممنوع افتراضيًا على كل الفروع، ولا يُسمح
    // به إلا لمن منحته الإدارة الصلاحية صراحة (تفويض، مو قفل استثنائي).
    const perms = (await dbGet('permissions/' + s.uid)) || {};
    if (perms.updateSheets !== true) throw new Error('هذا الإجراء متاح فقط لمن منحته الإدارة صلاحية "تحديث تواريخ صفحات الملف" صراحة.');
  }
}
async function sheetUpdatesList() {
  try {
    const data = (await dbGet('sheetUpdates')) || {};
    return { ok: true, rows: Object.keys(SHEET_KEYS).map(k => ({ key: k, label: SHEET_KEYS[k], updatedAt: data[k] ? data[k].updatedAt : null, updatedBy: data[k] ? data[k].updatedBy : null })) };
  } catch (e) { return { ok: false, message: e.message || String(e), rows: [] }; }
}
async function markSheetUpdated(key) {
  try {
    if (!SHEET_KEYS[key]) return { ok: false, message: 'صفحة غير معروفة.' };
    await checkUpdateSheetsPermission();
    const me = meIdentity();
    await dbSet('sheetUpdates/' + key, { updatedAt: new Date().toISOString(), updatedBy: me ? me.name : '' });
    return { ok: true, message: 'تم تسجيل تحديث صفحة "' + SHEET_KEYS[key] + '".' };
  } catch (e) { return { ok: false, message: e.message || String(e) }; }
}

// ==================== إشعارات البريد الإلكتروني (اختيارية - عبر خدمة EmailJS المجانية) ====================
// ملاحظة صريحة: هذا معطّل افتراضيًا. لتفعيله، سجّل حساب مجاني بـ emailjs.com (بدون بطاقة)
// وعبّي بيانات EMAILJS_CONFIG بالأسفل بمعرّفاتك الخاصة. بدون هذي الخطوة، الإشعارات ما ترسل
// (بصمت، بدون أي خطأ يعطّل باقي البرنامج) - الدردشة والحسابات تشتغل طبيعي بدونها تمامًا.
const EMAILJS_CONFIG = { serviceId: 'service_1rrddy5', templateId: 'template_bfyy6ot', publicKey: 'lhmu_w92j8NqqUzfu' };
async function sendEmailNotification(toEmail, subject, message) {
  if (!EMAILJS_CONFIG.serviceId || !toEmail) return; // غير مفعّل أو ما فيه بريد مسجّل - تجاهل بصمت
  try {
    const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service_id: EMAILJS_CONFIG.serviceId, template_id: EMAILJS_CONFIG.templateId, user_id: EMAILJS_CONFIG.publicKey, template_params: { to_email: toEmail, subject, message } })
    });
    // مهم: قبل كنا نتجاهل نتيجة الإرسال بالكامل (حتى الأخطاء) - لو فشل الإرسال (مثلاً 422 من
    // EmailJS)، ما كان يظهر أي أثر إلا بشبكة المتصفح (Network tab)، بدون أي تفصيل بالـ Console.
    // الآن نطبع السبب الحقيقي (نص الخطأ اللي يرجعه EmailJS نفسه) عشان تقدر تشخّص المشكلة فورًا.
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('فشل إرسال إشعار البريد (EmailJS ' + r.status + '): ' + errText + ' - الحل الأغلب: تأكد إن حقل "To Email" بقالب EmailJS (Email Templates بلوحة emailjs.com) معبّى بالضبط بـ {{to_email}}.');
    }
  } catch (e) { console.error('تعذّر الاتصال بخدمة EmailJS:', e.message || e); }
}

window.api = {
  auth: { status: authStatus, login: authLogin, setPassword: authSetPassword, removePassword: authRemovePassword },
  branch: { register: branchRegister, login: branchLogin, requestProfileChange: branchRequestProfileChange, changePassword: branchChangeOwnPassword },
  session: { me: sessionMe, logout: async () => { clearSession(); return { ok: true }; }, checkPermission: async (cmdKey) => { try { await checkBranchPermission(cmdKey); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; } } },
  admin: {
    listBranches: (scope) => adminListBranches(scope),
    approve: (id) => adminSetStatus(id, 'approved', { approvedAt: new Date().toISOString() }),
    reject: (id) => adminSetStatus(id, 'rejected'),
    suspend: (id) => adminSetStatus(id, 'suspended'),
    unsuspend: (id) => adminSetStatus(id, 'approved'),
    softDelete: async (id) => { try { requireAdminSession(); await dbUpdate('branches/' + id, { deletedAt: new Date().toISOString() }); return { ok: true }; } catch (e) { return { ok: false, message: e.message || String(e) }; } },
    restore: async (id) => { try { requireAdminSession(); await dbUpdate('branches/' + id, { deletedAt: null }); return { ok: true }; } catch (e) { return { ok: false, message: e.message || String(e) }; } },
    permanentDelete: async (id) => {
      try {
        requireAdminSession();
        await dbDelete('branches/' + id);
        await dbDelete('permissions/' + id);
        return { ok: true, message: 'تم الحذف من قاعدة البيانات. ملاحظة: حساب الدخول (Firebase Auth) بحد ذاته يبقى موجودًا تقنيًا (حذفه يتطلب خادمًا خلفيًا)، لكنه لا يقدر يدخل بعد حذف بياناته هنا.' };
      } catch (e) { return { ok: false, message: e.message || String(e) }; }
    },
    setPermission: async (id, cmdKey, allowed) => { try { requireAdminSession(); await dbUpdate('permissions/' + id, { [cmdKey]: !!allowed }); return { ok: true }; } catch (e) { return { ok: false, message: e.message || String(e) }; } },
    approveProfileChange: (id) => adminApproveProfileChange(id),
    rejectProfileChange: (id) => adminRejectProfileChange(id),
    impersonate: async () => {
      // "الدخول كهذا الفرع" غير ممكن تقنيًا بهذي البنية (بدون سيرفر خلفي): الإدارة لا تعرف
      // كلمة مرور الفرع الحقيقية، وFirebase Authentication الحقيقي يتطلبها لتسجيل الدخول -
      // هذا بالضبط الثمن مقابل الأمان الحقيقي. ميزة مشابهة ممكنة لاحقًا عبر Cloud Functions
      // (تحتاج خطة مدفوعة من Firebase) إذا احتجتها مستقبلًا.
      return { ok: false, message: 'هذي الميزة غير متاحة بهذي البنية بدون سيرفر - الإدارة ما تقدر تعرف كلمة مرور الفرع الحقيقية لتسجل دخول مكانه. راجع بياناته مباشرة من صفحة الفروع بدلًا من ذلك.' };
    }
  },
  excel: { choose: excelChoose, getCurrent: excelGetCurrent, reload: excelReload },
  category: { tree: () => ({ ok: false, message: 'غير مفعّل بهذي المرحلة.' }), audit: categoryAudit },
  chat: {
    conversations: (scope) => chatConversations(scope),
    messages: (id) => chatMessages(id),
    send: (id, body, file) => chatSend(id, body, file),
    fileUrl: (convId, msgId) => chatFileUrl(convId, msgId),
    deleteConversation: (id) => chatDeleteConversation(id),
    restoreConversation: (id) => chatRestoreConversation(id),
    pauseConversation: (id) => chatPauseConversation(id),
    resumeConversation: (id) => chatResumeConversation(id),
    groupCandidates: () => chatGroupCandidates(),
    createGroup: (name, members) => chatCreateGroup(name, members),
    setGroupMember: (convId, branchId, add) => chatSetGroupMember(convId, branchId, add),
    peerCandidates: () => chatPeerCandidates(),
    peerRequest: (targetId) => chatPeerRequest(targetId),
    peerRequests: (status) => chatPeerRequests(status),
    peerApprove: (id) => chatPeerApprove(id),
    peerReject: (id) => chatPeerReject(id),
    templates: () => chatTemplates(),
    addTemplate: (title, body) => chatAddTemplate(title, body),
    deleteTemplate: (id) => chatDeleteTemplate(id)
  },
  sheets: { list: () => sheetUpdatesList(), markUpdated: (key) => markSheetUpdated(key) },
  settings: {
    getAdminEmail: async () => { try { return { ok: true, email: (await dbGet('settings/adminEmail')) || '' }; } catch (e) { return { ok: false, email: '' }; } },
    setAdminEmail: async (email) => { try { requireAdminSession(); await dbSet('settings/adminEmail', String(email || '').trim()); return { ok: true, message: 'تم حفظ بريد الإدارة للإشعارات.' }; } catch (e) { return { ok: false, message: e.message || String(e) }; } },
    getAdminPhone: async () => { try { return { ok: true, phone: (await dbGet('settings/adminPhone')) || '' }; } catch (e) { return { ok: false, phone: '' }; } },
    setAdminPhone: async (phone) => { try { requireAdminSession(); const clean = String(phone || '').replace(/[^0-9+]/g, ''); await dbSet('settings/adminPhone', clean); return { ok: true, message: 'تم حفظ رقم هاتف الإدارة.' }; } catch (e) { return { ok: false, message: e.message || String(e) }; } },
    badgeCount: async () => { try { if (!isAdminSession()) return { ok: true, count: 0 }; const pend = await adminListBranches('pending'); return { ok: true, count: pend.ok ? pend.rows.length : 0 }; } catch (e) { return { ok: true, count: 0 }; } },
    chatBadgeCount: async () => { try { return { ok: true, count: await chatUnreadCount() }; } catch (e) { return { ok: true, count: 0 }; } }
  },
  call: {
    invite: (targetId, conversationId, kind, offer) => callInvite(targetId, conversationId, kind, offer),
    answer: (targetId, answer) => callAnswer(targetId, answer),
    ice: (targetId, candidate) => callIce(targetId, candidate),
    decline: (targetId) => callDecline(targetId),
    hangup: (targetId) => callHangup(targetId),
    busy: (targetId) => callBusy(targetId),
    onEvent: (cb) => { _callEventCb = cb; startCallPolling(); }
  },
  // الأقسام التالية (أودو، إحصائيات قاعدة البيانات) غير مفعّلة بهذي المرحلة (1) - بس لازم
  // توجد كدوال فارغة آمنة لأن renderer.js يستدعيها تلقائيًا عند فتح الصفحة، فلو كانت غير
  // موجودة إطلاقًا يتوقف تحميل الصفحة كاملة بخطأ. تُفعَّل فعليًا بمرحلة قادمة.
  db: {
    stats: async () => ({ ok: true, message: 'إحصائيات قاعدة البيانات غير مفعّلة بهذي المرحلة (لا حاجة لها أصلًا - Firebase يدير المساحة).' }),
    clean: async () => ({ ok: false, message: 'غير مطلوب بهذي البنية.' })
  },
  odoo: {
    loadSettings: async () => ({}),
    saveSettings: async () => ({ ok: false, message: 'ربط أودو غير مفعّل بهذي المرحلة بعد.' }),
    testConnection: async () => ({ ok: false, message: 'ربط أودو غير مفعّل بهذي المرحلة بعد.' }),
    discoverLocations: async () => ({ ok: false, message: 'ربط أودو غير مفعّل بهذي المرحلة بعد.' }),
    saveLocationMap: async () => ({ ok: false, message: 'ربط أودو غير مفعّل بهذي المرحلة بعد.' }),
    syncSales: async () => ({ ok: false, message: 'ربط أودو غير مفعّل بهذي المرحلة بعد.' }),
    syncAll: async () => ({ ok: false, message: 'ربط أودو غير مفعّل بهذي المرحلة بعد.' }),
    onProgress: () => { /* لا يوجد بث لحظي بهذي المرحلة - لا حاجة لأي شيء هنا */ }
  },
  limits: { saveBranch: limitsSaveBranch, loadBranch: limitsLoadBranch, saveWh: limitsSaveWh, loadWh: limitsLoadWh,
    clearBranch: async () => { try { await dbSet('limits/branch', {}); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; } },
    clearWh: async () => { try { await dbSet('limits/wh', {}); return { ok: true }; } catch (e) { return { ok: false, message: e.message }; } }
  },
  exportFile: {
    branches: async () => { if (!window._lastResult) return { ok: false, message: 'لا توجد نتائج تشغيل بعد' }; downloadAoaAsXlsx([{ name: 'تحويلات الفروع', rows: branchRowsToAoA(window._lastResult.branchRows) }], 'تحويلات_الفروع'); return { ok: true }; },
    warehouses: async () => { if (!window._lastResult) return { ok: false, message: 'لا توجد نتائج تشغيل بعد' }; downloadAoaAsXlsx([{ name: 'تحويلات المستودعات', rows: branchRowsToAoA(window._lastResult.warehouseRows) }], 'تحويلات_المستودعات'); return { ok: true }; },
    all: async () => { if (!window._lastResult) return { ok: false, message: 'لا توجد نتائج تشغيل بعد' }; downloadAoaAsXlsx([{ name: 'تحويلات الفروع', rows: branchRowsToAoA(window._lastResult.branchRows) }, { name: 'تحويلات المستودعات', rows: branchRowsToAoA(window._lastResult.warehouseRows) }], 'تحويلات_الفروع_والمستودعات'); return { ok: true }; },
    raise: async () => { if (!window._lastResult) return { ok: false, message: 'لا توجد نتائج تشغيل بعد' }; downloadAoaAsXlsx([{ name: 'منتجات يحتاج لها رفع الكمية', rows: raiseRowsToAoA(window._lastResult.raiseRows) }], 'منتجات_يحتاج_لها_رفع_الكمية'); return { ok: true }; },
    summary: async () => { if (!window._lastResult) return { ok: false, message: 'لا توجد نتائج تشغيل بعد' }; const s = window._lastResult.summary; downloadAoaAsXlsx([{ name: 'التحليل الملخص', rows: [['المؤشر', 'القيمة'], ['المنتجات', s.products], ['التحويلات', s.transfers], ['الكمية', s.qty], ['التغطية', s.coveredPct]] }], 'التحليل_الملخص'); return { ok: true }; },
    shortageWarehouses: async () => { if (!lastShortageWh || !Object.keys(lastShortageWh.sheets || {}).length) return { ok: false, message: 'شغّل تقرير نواقص المستودعات أولاً (وتأكد من وجود نقص فعلي قابل للتغطية).' }; const sheets = Object.keys(lastShortageWh.sheets).map(name => ({ name, rows: shortageWhRowsToAoA(lastShortageWh.sheets[name]) })); downloadAoaAsXlsx(sheets, 'نواقص_الفروع_من_المستودعات'); return { ok: true }; },
    shortageBranches: async () => { if (!lastShortageBr || !lastShortageBr.rows || !lastShortageBr.rows.length) return { ok: false, message: 'شغّل تقرير نواقص الفروع أولاً (وتأكد من وجود نقص فعلي قابل للتغطية).' }; downloadAoaAsXlsx([{ name: 'نواقص الفروع من الفروع', rows: shortageBrRowsToAoA(lastShortageBr.rows) }], 'نواقص_الفروع_من_الفروع'); return { ok: true }; },
    categoryAudit: async (scope) => {
      try {
        const loaded = await ensureExcelLoaded();
        const barcodes = scopeBarcodes(loaded.ctx, scope);
        const rows = window.ExcelLoaderModule.categoryAudit(loaded.ctx, barcodes);
        downloadAoaAsXlsx([{ name: 'تدقيق الفئات', rows: [['الفئة الرئيسية', 'الفئة الفرعية', 'البراند', 'عدد المنتجات'], ...rows.map(r => [r.mainCategory, r.subCategory, r.brand, r.count])] }], 'تدقيق_الفئات');
        return { ok: true };
      } catch (e) { return { ok: false, message: e.message || String(e) }; }
    }
  },
  run: {
    turbo: (u) => doRun('Turbo', false, u, 'turbo'),
    bigdata: (u) => doRun('BIG DATA', false, u, 'bigdata'),
    manual: (u) => doRun('Turbo يدوي', true, u, 'manual'),
    exceptional: (u) => doRun('السحب الكامل الاستثنائي', false, u, 'exceptional'),
    branchLimit: (u) => doRun('حدود الفروع الخاصة', false, u, 'branchLimit'),
    smartLimit: (u) => doRun('الحد الذكي', false, u, 'smartLimit'),
    preview20: (u) => doRun('Turbo', false, u, 'preview20'),
    shortageWarehouses: (u) => runShortageWarehouses(u),
    shortageBranches: (u) => runShortageBranches(u),
    checkData: async () => { try { const l = await ensureExcelLoaded(); return { ok: true, message: `الملف سليم: ${l.info.sheets} ورقة، ${l.info.products} منتج بصفحة المخزون.\nتم العثور على صفحة "المنتجات التي يحتاج لها توزيع" - فيها ${l.info.needProducts} منتج.` }; } catch (e) { return { ok: false, message: e.message }; } },
    monitor: async () => ({ lock: runLock ? 'مقفل' : 'غير مقفل' }),
    unlock: async () => { runLock = false; return { ok: true }; },
    cancel: async () => ({ ok: true, message: 'التشغيل يتم بالكامل بمتصفحك فلا يوجد إلغاء منتصف الطريق حاليًا.' }),
    onProgress: () => { /* التشغيل يتم دفعة واحدة بالمتصفح بدون تحديث تقدم مرحلي بهذي المرحلة */ }
  }
};
