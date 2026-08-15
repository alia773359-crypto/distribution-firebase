'use strict';
// ملاحظة مهمة عن التخزين المؤقت (Cache):
// - كل مرة تحدّث ملفات البرنامج (أي كود جديد)، لازم تغيّر رقم النسخة CACHE_NAME بالأسفل (مثلاً
//   من v2 إلى v3) - وإلا المتصفح ممكن يستمر يستخدم نسخة قديمة مخزّنة من بعض الملفات حتى بعد
//   ما ترفع التحديث، وتصير أخطاء غريبة (ملفات جديدة مع ملفات قديمة مع بعض بنفس الصفحة).
// - غيّرنا الإستراتيجية لـ"الشبكة أولًا" لملفات البرنامج نفسها (JS/HTML) بدل "التخزين أولًا" -
//   هذا يضمن إنك تشوف كل تحديث فورًا بأول تحميل صفحة، والتخزين المؤقت يستخدم فقط كحل احتياطي
//   وقت انقطاع الإنترنت (عمل بدون اتصال).
const CACHE_NAME = 'distribution-platform-v3';
const SHELL_FILES = [
  './', './index.html', './theme.js', './firebase-config.js', './firebase-client.js',
  './renderer.js', './branch-ui.js', './chat-ui.js', './call-ui.js', './home-ui.js', './notif-sound.js',
  './engine/xlsx.full.min.js', './engine/locations.js', './engine/engine.js', './engine/excelLoader.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => { /* تجاهل فشل تخزين ملف معيّن */ }));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  // أي طلب لـ Firebase (قاعدة بيانات، مصادقة) يروح مباشرة للشبكة دائمًا - ما نخزّنه أبدًا
  if (url.includes('firebaseio.com') || url.includes('firebasedatabase.app') || url.includes('googleapis.com') || url.includes('emailjs.com')) return;
  // الشبكة أولًا: نجرّب نجيب أحدث نسخة من الملف كل مرة. لو نجح الطلب، نحدّث التخزين المؤقت
  // كنسخة احتياطية ونرجعه مباشرة. لو فشل (بدون إنترنت)، نرجع النسخة المخزّنة كحل أخير فقط.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
