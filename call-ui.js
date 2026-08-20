'use strict';
/**
 * مكالمات صوتية/مرئية حية (WebRTC) بين طرفين، بالإضافة لتسجيل رسائل صوتية/فيديو تُرسل
 * كمرفقات عادية بالدردشة (نفس آلية رفع الملفات الموجودة أصلًا - بدون أي تعديل بالسيرفر لهذا
 * الجزء بالذات).
 *
 * ملاحظة مهمة تعرفها: خط الإشارة (تبادل عروض/ردود/عناوين شبكة) مبني صحيح حسب معيار WebRTC
 * القياسي ومُختبَر فعليًا (وصول الرسائل الصحيحة للطرف الصحيح فقط). لكن نجاح الاتصال الفعلي
 * بالصوت/الصورة بين جهازين حقيقيين يعتمد على شبكتيهما (نستخدم خادم STUN عام مجاني من جوجل
 * لمساعدتهم يوصلون لبعض) - لو كانت إحدى الشبكتين مقيّدة جدًا (جدار حماية شركات مثلًا) ممكن
 * يحتاج خادم TURN مخصص لضمان النجاح دائمًا، وهذا قيد معروف بأي حل WebRTC بدون TURN.
 */
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
// إصلاح صرير/صدى المكالمات عند تشغيل مكبر الصوت (Speaker): getUserMedia بدون قيود صوتية
// (audio: true فقط) يعتمد على الإعدادات الافتراضية لإلغاء الصدى بالمتصفح، وهذي غير كافية لما
// يرجع صوت المكبر للميكروفون (حلقة صوتية). هذا الكائن يُستخدم فقط بمسار فتح الميكروفون
// لمكالمة حية (المكانين بالضبط أدناه) - لا علاقة له بتسجيل الرسائل الصوتية/الفيديو (تلك تبقى
// كما هي تمامًا، بدون أي تغيير، بمكان منفصل بهذا الملف).
//
// ملاحظة على القيم الإضافية (googXxx): هذي قيود قديمة خاصة بمتصفحات Chromium/Electron (غير
// قياسية بمواصفة WebRTC الرسمية)، لكنها معروفة بأنها تعطي إلغاء صدى/ضجيج أقوى فعليًا من القيم
// القياسية وحدها على هذي المتصفحات تحديدًا - المتصفحات اللي ما تعرفها ببساطة تتجاهلها بدون أي
// خطأ أو تعطيل (لا تكسر الاتصال أبدًا)، فإضافتها آمنة تمامًا حتى لو مو مدعومة بمكان التشغيل.
const CALL_AUDIO_CONSTRAINTS = {
  echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  channelCount: 1, // التقاط أحادي القناة (مو ستيريو) - خوارزميات إلغاء الصدى تشتغل أدق وأقوى عليه
  googEchoCancellation: true, googAutoGainControl: true, googNoiseSuppression: true,
  googHighpassFilter: true, googTypingNoiseDetection: true, googNoiseSuppression2: true, googEchoCancellation2: true
};
// تطبيق القيود على مسار الصوت بعد فتح الميكروفون مباشرة (طبقة حماية إضافية): بعض المتصفحات لا
// تُطبّق كل قيود getUserMedia الأولية بقوة كافية، لكن applyConstraints على المسار (Track) نفسه
// بعد فتحه يجبرها تُعاد المحاولة بتفعيل صريح - إجراء إضافي بسيط لا يغيّر أي شيء بالمسار نفسه.
async function reinforceAudioConstraints(stream) {
  try {
    const track = stream.getAudioTracks()[0];
    if (track && track.applyConstraints) await track.applyConstraints(CALL_AUDIO_CONSTRAINTS);
  } catch (e) { /* لو القيد غير مدعوم بهذا الجهاز/المتصفح، نتجاهل بصمت - الاتصال يكمل عاديًا */ }
}

let pc = null, localStream = null, callTargetId = null, isCaller = false, callKind = 'audio';
let pendingRecorder = null, recordedChunks = [], recordKind = null;

function callUiEl(html) {
  let el = document.getElementById('callOverlay');
  if (!el) {
    el = document.createElement('div');
    el.id = 'callOverlay';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.92);z-index:900;display:flex;align-items:center;justify-content:center;color:#fff;font-family:Arial,Tahoma,sans-serif';
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  el.style.display = 'flex';
  return el;
}
function closeCallUi() {
  const el = document.getElementById('callOverlay');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
  if (typeof window.stopRinging === 'function') window.stopRinging(); // يوقف الرنين بأي حالة تسكير لواجهة المكالمة
}

function cleanupCall() {
  if (pc) { try { pc.close(); } catch (e) { /* تجاهل */ } pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  callTargetId = null; isCaller = false;
  closeCallUi();
}

async function createPeerConnection(targetId) {
  const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  conn.onicecandidate = (ev) => { if (ev.candidate) window.api.call.ice(targetId, ev.candidate); };
  conn.ontrack = (ev) => {
    const remoteEl = document.getElementById('callRemoteMedia');
    if (remoteEl) remoteEl.srcObject = ev.streams[0];
  };
  conn.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(conn.connectionState)) {
      const statusEl = document.getElementById('callStatusText');
      if (statusEl && conn.connectionState !== 'closed') statusEl.textContent = 'انقطع الاتصال...';
    }
  };
  return conn;
}

function renderCallScreen(kind, name, statusText) {
  callUiEl(`
    <div style="text-align:center;width:320px">
      <div style="font-size:15px;font-weight:900;margin-bottom:4px">${kind === 'video' ? '📹' : '📞'} ${name}</div>
      <div id="callStatusText" style="font-size:12px;color:#94a3b8;margin-bottom:14px">${statusText}</div>
      <video id="callRemoteMedia" autoplay playsinline style="width:100%;border-radius:14px;background:#000;${kind === 'video' ? '' : 'display:none'}"></video>
      <video id="callLocalMedia" autoplay playsinline muted style="width:90px;border-radius:10px;position:fixed;bottom:90px;left:16px;${kind === 'video' ? '' : 'display:none'}"></video>
      <button onclick="hangupCall()" style="margin-top:16px;background:#ef4444;color:#fff;border:0;border-radius:999px;width:56px;height:56px;font-size:22px;cursor:pointer">📴</button>
    </div>`);
}

window.startCall = async function (kind) {
  if (!currentConversationId) return;
  const perm = await window.api.session.checkPermission('liveCall');
  if (!perm.ok) { alert(perm.message); return; }
  const info = window._currentConvInfo;
  if (!info || !info.otherId) { alert('ما أقدر أحدد الطرف الآخر بهذي المحادثة.'); return; }
  callTargetId = info.otherId; callKind = kind; isCaller = true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: CALL_AUDIO_CONSTRAINTS, video: kind === 'video' });
    await reinforceAudioConstraints(localStream);
  } catch (e) { alert('تعذّر الوصول للميكروفون' + (kind === 'video' ? '/الكاميرا' : '') + ': ' + e.message); return; }
  renderCallScreen(kind, info.name || 'مكالمة', 'جاري الاتصال...');
  const localEl = document.getElementById('callLocalMedia');
  if (localEl) localEl.srcObject = localStream;
  pc = await createPeerConnection(callTargetId);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await window.api.call.invite(callTargetId, currentConversationId, kind, offer);
};

window.hangupCall = function () {
  if (callTargetId) window.api.call.hangup(callTargetId);
  cleanupCall();
};

function handleIncomingCall(data) {
  callUiEl(`
    <div style="text-align:center;width:300px">
      <div style="font-size:40px;margin-bottom:8px">${data.kind === 'video' ? '📹' : '📞'}</div>
      <div style="font-size:15px;font-weight:900;margin-bottom:4px">مكالمة ${data.kind === 'video' ? 'فيديو' : 'صوتية'} واردة</div>
      <div style="font-size:13px;color:#94a3b8;margin-bottom:18px">من: ${esc(data.fromName || data.from)}</div>
      <div style="display:flex;gap:12px;justify-content:center">
        <button onclick="acceptIncomingCall()" style="background:#22c55e;color:#fff;border:0;border-radius:999px;width:56px;height:56px;font-size:22px;cursor:pointer">✅</button>
        <button onclick="declineIncomingCall()" style="background:#ef4444;color:#fff;border:0;border-radius:999px;width:56px;height:56px;font-size:22px;cursor:pointer">❌</button>
      </div>
    </div>`);
  window._incomingCallData = data;
  if (typeof window.startRinging === 'function') window.startRinging(); // رنين متكرر حتى الرد أو الرفض
}
window.acceptIncomingCall = async function () {
  if (typeof window.stopRinging === 'function') window.stopRinging(); // يوقف الرنين فورًا لحظة الرد
  const data = window._incomingCallData;
  if (!data) return;
  callTargetId = data.from; callKind = data.kind; isCaller = false;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: CALL_AUDIO_CONSTRAINTS, video: data.kind === 'video' });
    await reinforceAudioConstraints(localStream);
  } catch (e) { alert('تعذّر الوصول للميكروفون/الكاميرا: ' + e.message); window.api.call.decline(data.from); cleanupCall(); return; }
  renderCallScreen(data.kind, data.fromName || data.from, 'جاري الاتصال...');
  const localEl = document.getElementById('callLocalMedia');
  if (localEl) localEl.srcObject = localStream;
  pc = await createPeerConnection(callTargetId);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await window.api.call.answer(callTargetId, answer);
  const statusEl = document.getElementById('callStatusText');
  if (statusEl) statusEl.textContent = 'متصل';
};
window.declineIncomingCall = function () {
  const data = window._incomingCallData;
  if (data) window.api.call.decline(data.from);
  closeCallUi();
};

window.api.call.onEvent(async (data) => {
  if (data.type === 'invite') {
    if (pc) { window.api.call.busy(data.from); return; } // مشغول بمكالمة ثانية أصلًا
    handleIncomingCall(data);
  } else if (data.type === 'answer') {
    if (pc && isCaller) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      const statusEl = document.getElementById('callStatusText');
      if (statusEl) statusEl.textContent = 'متصل';
    }
  } else if (data.type === 'ice') {
    if (pc) { try { await pc.addIceCandidate(data.candidate); } catch (e) { /* تجاهل */ } }
  } else if (data.type === 'decline') {
    alert('تم رفض المكالمة.');
    cleanupCall();
  } else if (data.type === 'busy') {
    alert('الطرف الآخر مشغول بمكالمة حاليًا.');
    cleanupCall();
  } else if (data.type === 'hangup') {
    cleanupCall();
  }
});

// ---- تسجيل رسائل صوتية/فيديو (تُرسل كمرفق دردشة عادي عبر نفس آلية الإرسال الحالية) ----
window.stopRecording = function () {
  if (pendingRecorder && pendingRecorder.state === 'recording') pendingRecorder.stop();
};
window.toggleRecording = async function (kind) {
  if (pendingRecorder && pendingRecorder.state === 'recording') { pendingRecorder.stop(); return; }
  const perm = await window.api.session.checkPermission(kind === 'video' ? 'videoMsg' : 'voiceMsg');
  if (!perm.ok) { alert(perm.message); return; }
  try {
    const constraints = kind === 'video' ? { audio: true, video: true } : { audio: true };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    recordedChunks = []; recordKind = kind;
    pendingRecorder = new MediaRecorder(stream);
    pendingRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    pendingRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(recordedChunks, { type: kind === 'video' ? 'video/webm' : 'audio/webm' });
      const file = new File([blob], (kind === 'video' ? 'رسالة-فيديو-' : 'رسالة-صوتية-') + Date.now() + '.webm', { type: blob.type });
      pendingChatFile = file;
      const fname = document.getElementById('chatFileName');
      if (fname) fname.textContent = (kind === 'video' ? '📹 ' : '🎤 ') + 'جاهز للإرسال - ' + (file.size / 1024).toFixed(0) + ' كيلوبايت';
      const ind = document.getElementById('recordIndicator');
      if (ind) ind.style.display = 'none';
    };
    pendingRecorder.start();
    const ind = document.getElementById('recordIndicator');
    if (ind) { ind.style.display = 'flex'; ind.textContent = (kind === 'video' ? '📹' : '🎤') + ' جاري التسجيل... اضغط لإيقاف'; }
  } catch (e) {
    alert('تعذّر الوصول لـ' + (kind === 'video' ? 'الكاميرا/الميكروفون' : 'الميكروفون') + ': ' + e.message);
  }
};
