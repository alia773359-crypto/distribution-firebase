'use strict';
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* تجاهل - البرنامج يبقى يعمل بدون PWA */ });
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallButton();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById('pwaInstallBtn');
  if (btn) btn.remove();
});

function showInstallButton() {
  if (document.getElementById('pwaInstallBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'pwaInstallBtn';
  btn.textContent = '📲 ثبّت كتطبيق';
  btn.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:600;background:#0ea5e9;color:#fff;border:0;border-radius:999px;padding:10px 18px;font-weight:900;font-size:12px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)';
  btn.onclick = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    btn.remove();
  };
  document.body.appendChild(btn);
}
