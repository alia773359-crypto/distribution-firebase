#!/usr/bin/env node
/**
 * تنظيف/أرشفة يومية لقاعدة بيانات Firebase - يشتغل تلقائيًا كل يوم (عبر GitHub Actions،
 * راجع .github/workflows/daily-cleanup.yml) بدون أي سيرفر أو استضافة إضافية، ومجانًا بالكامل.
 *
 * ليش نحتاج هذا أصلًا؟
 * -----------------
 * المحادثة (الدردشة) تخزّن أي ملف مرفق (صورة/PDF/إلخ) كنص Base64 داخل قاعدة البيانات نفسها،
 * ويتراكم للأبد بدون أي حذف تلقائي. خطة Firebase المجانية (Spark) فيها سقف تخزين 1 جيجابايت -
 * الرسائل والمرفقات القديمة هي أكبر مصدر نمو، ولازم تتنضف/تُؤرشف بشكل دوري وإلا تمتلئ قاعدة
 * البيانات مع الوقت وتتوقف الكتابة فيها.
 *
 * شنو بالضبط يسوي هذا السكربت كل تشغيل؟
 * --------------------------------------
 * 1) المرفقات (الصور/الملفات) بالرسائل الأقدم من ATTACHMENT_RETENTION_DAYS يوم (افتراضيًا 30):
 *    يمسح المرفق نفسه بس (الملف الثقيل) ويسيب نص الرسالة والمرسل والتاريخ - يعني "أرشفة" فعلية
 *    (تفقد الملف المرفق القديم، لكن يبقى سجل المحادثة نفسه مقروء).
 * 2) الرسائل الأقدم من MESSAGE_RETENTION_DAYS يوم (افتراضيًا 180) تُحذف نهائيًا بالكامل.
 * 3) الفروع المحذوفة (سلة المحذوفات) الأقدم من TRASH_RETENTION_DAYS يوم (افتراضيًا 30):
 *    تُحذف نهائيًا من قاعدة البيانات (بيانات الفرع + صلاحياته) - هذا نفس تأثير زر "حذف نهائي"
 *    يدويًا، بس تلقائي لو نسيت تسويه بنفسك.
 * 4) المحادثات المنقولة لسلة المحذوفات (من لوحة الإدارة) الأقدم من TRASH_RETENTION_DAYS يوم:
 *    تُحذف نهائيًا هي ورسائلها بالكامل، وتُشال من فهرس محادثات كل عضو فيها.
 *
 * كل الفترات بالأعلى قابلة للتعديل من الأسفل مباشرة (أو عبر متغيرات بيئة بنفس الاسم).
 */

// ملاحظة: apiKey و databaseURL هذولا بيانات مشروع عامة (مو أسرار) - نفس القيم المكتوبة بصراحة
// بملف public/firebase-config.js (لاحظ تعليقه هناك: "بيانات عامة آمنة، مو كلمات مرور سرية").
// ما نستوردها من ذاك الملف مباشرة لأنه مكتوب كسكربت متصفح عادي (window.FIREBASE_CONFIG)، مو
// كوحدة Node.js - فلو غيّرت مشروع Firebase مستقبلًا، حدّث القيم بهذا الملف وبذاك الملف مع بعض.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA-QL6yIiAvDBlhm_WlDsOMNXz7NgStnLk',
  databaseURL: 'https://distribution-platform-1f155-default-rtdb.europe-west1.firebasedatabase.app'
};

const ATTACHMENT_RETENTION_DAYS = Number(process.env.ATTACHMENT_RETENTION_DAYS || 30);
const MESSAGE_RETENTION_DAYS = Number(process.env.MESSAGE_RETENTION_DAYS || 180);
const TRASH_RETENTION_DAYS = Number(process.env.TRASH_RETENTION_DAYS || 30);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error('❌ متغيّر البيئة ADMIN_PASSWORD غير موجود - راجع تعليمات إعداد الأسرار (Secrets) بـ GitHub.'); process.exit(1); }

const DB_URL = FIREBASE_CONFIG.databaseURL;
const API_KEY = FIREBASE_CONFIG.apiKey;
const ADMIN_EMAIL = 'admin@branch.distribution.local';

const now = Date.now();
const cutoffAttachment = now - ATTACHMENT_RETENTION_DAYS * 86400000;
const cutoffMessage = now - MESSAGE_RETENTION_DAYS * 86400000;
const cutoffTrash = now - TRASH_RETENTION_DAYS * 86400000;

let idToken = null;
async function signIn() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, returnSecureToken: true })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('فشل تسجيل الدخول كإدارة: ' + (data.error?.message || r.status));
  idToken = data.idToken;
}
async function dbGet(path) {
  const r = await fetch(`${DB_URL}/${path}.json?auth=${idToken}`);
  if (!r.ok) throw new Error(`GET ${path} فشل (${r.status})`);
  return r.json();
}
async function dbDelete(path) {
  const r = await fetch(`${DB_URL}/${path}.json?auth=${idToken}`, { method: 'DELETE' });
  if (!r.ok) console.warn(`⚠️ تعذّر حذف ${path} (${r.status})`);
  return r.ok;
}
async function dbPatch(path, value) {
  const r = await fetch(`${DB_URL}/${path}.json?auth=${idToken}`, { method: 'PATCH', body: JSON.stringify(value) });
  if (!r.ok) console.warn(`⚠️ تعذّر تحديث ${path} (${r.status})`);
  return r.ok;
}

async function cleanupMessagesOfConversation(convId) {
  const msgs = await dbGet(`messages/${convId}`).catch(() => null);
  if (!msgs) return { archived: 0, deleted: 0 };
  let archived = 0, deleted = 0;
  for (const [msgId, m] of Object.entries(msgs)) {
    const t = new Date(m.createdAt || 0).getTime();
    if (!t) continue;
    if (t < cutoffMessage) {
      await dbDelete(`messages/${convId}/${msgId}`);
      deleted++;
    } else if (m.fileData && t < cutoffAttachment) {
      await dbPatch(`messages/${convId}/${msgId}`, { fileData: null, fileName: null, archivedNote: '📎 تم حذف المرفق تلقائيًا (أقدم من ' + ATTACHMENT_RETENTION_DAYS + ' يوم) للحفاظ على مساحة قاعدة البيانات.' });
      archived++;
    }
  }
  return { archived, deleted };
}

async function purgeTrashedConversation(convId, conv) {
  const members = Object.keys(conv.members || {});
  await dbDelete(`messages/${convId}`);
  await dbDelete(`conversations/${convId}`);
  for (const m of members) await dbDelete(`userConversations/${m}/${convId}`);
}

async function main() {
  console.log('🧹 بدء التنظيف اليومي -', new Date(now).toISOString());
  await signIn();
  console.log('✅ تسجيل الدخول كإدارة نجح.');

  let totalArchivedMsgs = 0, totalDeletedMsgs = 0, purgedConvs = 0, purgedBranches = 0;

  // 1) الفروع بسلة المحذوفات - حذف نهائي بعد فترة السماح
  const branches = (await dbGet('branches')) || {};
  for (const [id, b] of Object.entries(branches)) {
    if (b.deletedAt && new Date(b.deletedAt).getTime() < cutoffTrash) {
      await dbDelete(`branches/${id}`);
      await dbDelete(`permissions/${id}`);
      await dbDelete(`userConversations/${id}`);
      purgedBranches++;
    }
  }
  console.log(`🗑️ فروع محذوفة نهائيًا من سلة المحذوفات: ${purgedBranches}`);

  // 2) المحادثات - أرشفة/حذف الرسائل القديمة بالمحادثات النشطة، وحذف نهائي لمحادثات سلة المحذوفات
  const conversations = (await dbGet('conversations')) || {};
  for (const [id, conv] of Object.entries(conversations)) {
    if (conv.deletedAt && new Date(conv.deletedAt).getTime() < cutoffTrash) {
      await purgeTrashedConversation(id, conv);
      purgedConvs++;
      continue;
    }
    const { archived, deleted } = await cleanupMessagesOfConversation(id);
    totalArchivedMsgs += archived;
    totalDeletedMsgs += deleted;
  }

  console.log(`📎 مرفقات أُرشفت (حذف الملف مع إبقاء نص الرسالة): ${totalArchivedMsgs}`);
  console.log(`🗑️ رسائل حُذفت نهائيًا (أقدم من ${MESSAGE_RETENTION_DAYS} يوم): ${totalDeletedMsgs}`);
  console.log(`🗑️ محادثات حُذفت نهائيًا من سلة المحذوفات: ${purgedConvs}`);
  console.log('✅ انتهى التنظيف اليومي بنجاح.');
}

main().catch(e => { console.error('❌ فشل التنظيف اليومي:', e.message || e); process.exit(1); });
