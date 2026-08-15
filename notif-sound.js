'use strict';
/**
 * إشعارات صوتية بسيطة (نغمة رسالة جديدة / رنين مكالمة واردة) باستخدام Web Audio API مباشرة -
 * بدون أي ملف صوت خارجي يحتاج تحميل أو استضافة أو رفع لملفات المشروع، يشتغل فورًا بأي متصفح
 * حديث فور تفاعل المستخدم الأول مع الصفحة (متطلب أمان قياسي بكل المتصفحات لمنع أصوات مزعجة
 * تلقائية بدون علم المستخدم - أول نقرة/ضغطة بالصفحة كافية لتفعيله، ثم يشتغل تلقائيًا بعدها).
 */
let audioCtx = null;
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { /* تجاهل */ });
  return audioCtx;
}
function beep(freq, durationMs, startAt, volume) {
  const ctx = getCtx();
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const t0 = ctx.currentTime + (startAt || 0), v = volume || 0.15;
  osc.start(t0);
  gain.gain.setValueAtTime(v, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.stop(t0 + durationMs / 1000 + 0.05);
}

// نغمة قصيرة صاعدة (نغمتين) لإشعار "رسالة جديدة" أو "طلب انضمام جديد"
window.playNotifSound = function (kind) {
  try {
    if (kind === 'message') {
      beep(880, 120, 0, 0.13);
      beep(1175, 150, 0.13, 0.13);
    } else if (kind === 'ring') {
      beep(700, 350, 0, 0.16);
      beep(880, 350, 0.4, 0.16);
    }
  } catch (e) { /* بعض المتصفحات تمنع الصوت قبل أول تفاعل من المستخدم مع الصفحة - تجاهل بصمت */ }
};

// رنين متكرر لمكالمة واردة - يستمر حتى الرد أو الرفض أو انتهاء المكالمة (stopRinging)
let ringInterval = null;
window.startRinging = function () {
  window.stopRinging();
  window.playNotifSound('ring');
  ringInterval = setInterval(() => window.playNotifSound('ring'), 1600);
};
window.stopRinging = function () {
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
};
