'use strict';
/**
 * إشعارات صوتية أنيقة (نغمة رسالة جديدة / رنين مكالمة واردة) باستخدام Web Audio API مباشرة -
 * بدون أي ملف صوت خارجي.
 *
 * ملاحظة مهمة عن "الصرير المزعج" اللي كان يصير بمكبرات الصوت: السبب التقني المعروف هو تشغيل
 * أو إيقاف الصوت "فجأة" (بدون صعود/هبوط تدريجي بالحجم) - هذا يسبب "طقطقة/صرير" (Click/Pop)
 * واضح خصوصًا بالسماعات الخارجية. الحل الصحيح دائمًا: صعود ونزول ناعم للحجم (Envelope) بكل
 * نغمة مهما كانت قصيرة - وهذا بالضبط ما تسويه دالة tone() بالأسفل، فما فيه أي بداية/نهاية فجائية.
 */
let audioCtx = null;
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => { /* تجاهل */ });
  return audioCtx;
}

// نغمة واحدة نظيفة تمامًا: صعود ناعم (attack) ثم ثبات ثم هبوط ناعم (release) - أبدًا ما تبدأ
// أو تنتهي فجأة، وهذا يمنع أي صرير/طقطقة نهائيًا بغض النظر عن مستوى الصوت.
function tone(freq, startAt, duration, opts) {
  const ctx = getCtx();
  const t0 = ctx.currentTime + startAt;
  const attack = (opts && opts.attack) || 0.02;
  const release = (opts && opts.release) || 0.14;
  const peak = (opts && opts.volume) || 0.2;
  const type = (opts && opts.type) || 'sine';
  const holdEnd = Math.max(t0 + attack, t0 + duration - release);

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  gain.gain.setValueAtTime(peak, holdEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}
// أكثر من نغمة بنفس اللحظة (تناغم) تعطي إحساس "جرس" غني ودافئ بدل نغمة مسطحة وحيدة
function chord(freqs, startAt, duration, opts) {
  freqs.forEach(f => tone(f, startAt, duration, opts));
}

window.playNotifSound = function (kind) {
  try {
    if (kind === 'message') {
      // نغمة "شيميز" أنيقة بأسلوب إشعارات الجوالات الحديثة - نغمتين متتاليتين هابطتين
      // ومتناغمتين (شبيهة بنغمة إشعار الرسائل بأجهزة آيفون/واتساب): نغمة عالية دافئة ثم
      // نغمة أخفض تعطي إحساس "اكتمال" لطيف، بدون أي حدة أو صرير.
      chord([1567.98, 1975.53], 0, 0.22, { volume: 0.22, attack: 0.012, release: 0.14, type: 'sine' });   // G6 + B6
      chord([1318.51, 1661.22], 0.13, 0.3, { volume: 0.2, attack: 0.015, release: 0.2, type: 'sine' });  // E6 + G#6
    } else if (kind === 'ring') {
      // نمط رنين هاتف أنيق: "تريل" سريع بنغمتين متبادلتين (بدل نغمة واحدة مملة)، بحجم أعلى
      // شوي عشان يكون واضح ومميز حتى بمكبر صوت، بدون ما يوصل لحد التشويش أو الصرير.
      [0, 0.1, 0.2, 0.3, 0.4, 0.5].forEach((offset, i) => {
        tone(i % 2 === 0 ? 987.77 : 1318.51, offset, 0.13, { volume: 0.3, attack: 0.01, release: 0.06, type: 'triangle' });
      });
    }
  } catch (e) { /* بعض المتصفحات تمنع الصوت قبل أول تفاعل من المستخدم مع الصفحة - تجاهل بصمت */ }
};

// رنين متكرر لمكالمة واردة - نفس نمط رنات الهواتف الحقيقية: رنّة (~0.6 ثانية) ثم سكوت (~1.3
// ثانية) ثم تتكرر - مو صوت مستمر بلا فواصل، وهذا يخليها مريحة للأذن حتى لو استمرت المكالمة شوي.
let ringInterval = null;
window.startRinging = function () {
  window.stopRinging();
  window.playNotifSound('ring');
  ringInterval = setInterval(() => window.playNotifSound('ring'), 1900);
};
window.stopRinging = function () {
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
};
