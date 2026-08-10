'use strict';
/**
 * منطق صفحة "💬 الدردشة" - نفس تصميم النسخة السابقة، معدّل ليتوافق مع بنية Firebase:
 * - بدون بث لحظي (SSE) - تحديث عند فتح الصفحة + كل بضع ثوانٍ أثناء وجودك فيها.
 * - الملفات المرفقة (بما فيها الصوت والفيديو) تُعرض مباشرة من البيانات المرفقة بالرسالة نفسها
 *   بدون رابط تنزيل منفصل أو دورة مراجعة/موافقة (تبسيط مقصود لهذي المرحلة).
 */
let _chatMyId = null, _chatMyRole = null;
let currentConversationId = null;
let pendingChatFile = null;
let _tplCache = null;
let _chatPollTimer = null;

async function initChatPage() {
  const s = await window.api.session.me();
  _chatMyRole = s.role;
  _chatMyId = s.role === 'admin' ? 'admin' : s.branchId;
  document.getElementById('chatAdminTools').style.display = s.role === 'admin' ? 'block' : 'none';
  document.getElementById('chatBranchTools').style.display = s.role === 'branch' ? 'block' : 'none';
  document.getElementById('chatTemplatesBtn').style.display = s.role === 'admin' ? '' : 'none';
  if (s.role === 'admin') { loadGroupCandidates(); loadTemplatesAdmin(); loadChatTrash(); loadPeerRequestsAdmin(); }
  if (s.role === 'branch') loadPeerCandidates();
  loadConversations();
  if (_chatPollTimer) clearInterval(_chatPollTimer);
  _chatPollTimer = setInterval(() => {
    const pageChat = document.getElementById('page-chat');
    if (!pageChat || !pageChat.classList.contains('active')) return;
    if (currentConversationId) openConversation(currentConversationId); else loadConversations();
  }, 6000);
}

// ---- طلب دردشة بين فرعين (يحتاج موافقة الإدارة) ----
async function loadPeerCandidates() {
  const sel = document.getElementById('peerTargetSelect');
  if (!sel) return;
  const r = await window.api.chat.peerCandidates();
  sel.innerHTML = r.ok ? ('<option value="">اختر فرعًا...</option>' + r.rows.map(b => `<option value="${b.id}">${esc(b.displayName)}</option>`).join('')) : '<option value="">تعذّر تحميل القائمة</option>';
}
window.sendPeerRequest = async function () {
  const sel = document.getElementById('peerTargetSelect');
  const msgEl = document.getElementById('peerRequestMsg');
  if (!sel.value) { msgEl.style.color = '#991b1b'; msgEl.textContent = 'اختر فرعًا أولًا.'; return; }
  const r = await window.api.chat.peerRequest(sel.value);
  msgEl.style.color = r.ok ? '#166534' : '#991b1b';
  msgEl.textContent = r.message || (r.ok ? 'تم الإرسال.' : 'تعذّر الإرسال.');
};
async function loadPeerRequestsAdmin() {
  const el = document.getElementById('peerRequestsList');
  if (!el) return;
  const r = await window.api.chat.peerRequests('pending');
  if (!r.ok || !r.rows.length) { el.textContent = 'لا توجد طلبات دردشة بين الفروع بانتظار الموافقة حاليًا.'; return; }
  el.innerHTML = r.rows.map(req => `
    <div class="brRow">
      <div class="brInfo"><b>${esc(req.requesterName)} ↔ ${esc(req.targetName)}</b><span>أُرسل: ${new Date(req.createdAt).toLocaleString('ar-SA')}</span></div>
      <div class="brActions">
        <button class="btnGreen" onclick="approvePeerRequest('${req.id}')">✅ موافقة</button>
        <button class="btnRed" onclick="rejectPeerRequest('${req.id}')">❌ رفض</button>
      </div>
    </div>`).join('');
}
window.approvePeerRequest = async function (id) { await window.api.chat.peerApprove(id); loadPeerRequestsAdmin(); loadConversations(); };
window.rejectPeerRequest = async function (id) { await window.api.chat.peerReject(id); loadPeerRequestsAdmin(); };

async function loadConversations() {
  const r = await window.api.chat.conversations();
  const el = document.getElementById('conversationList');
  if (!r.ok || !r.rows.length) { el.textContent = r.ok ? 'لا توجد محادثات بعد.' : (r.message || 'تعذّر التحميل.'); return; }
  el.innerHTML = r.rows.map(c => `
    <div class="convItem ${c.id === currentConversationId ? 'active' : ''}" onclick="openConversation('${c.id.replace(/'/g, "\\'")}')">
      <b>${c.type === 'group' ? '👥 ' : c.type === 'peer' ? '🤝 ' : '🏬 '}${esc(c.name || c.id)}${c.paused ? ' ⏸️' : ''}</b>
      <span class="prev">${c.lastMessage ? (c.lastMessage.hasFile ? '📎 ' : '') + esc(c.lastMessage.body || '(ملف)') : 'لا رسائل بعد'}</span>
    </div>`).join('');
}
function esc(s) { return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

window.openConversation = async function (id) {
  currentConversationId = id;
  document.querySelectorAll('.convItem').forEach(x => x.classList.remove('active'));
  loadConversations();
  const r = await window.api.chat.messages(id);
  const header = document.getElementById('chatHeader');
  const thread = document.getElementById('chatThread');
  const compose = document.getElementById('chatComposeBar');
  if (!r.ok) { header.textContent = 'تعذّر فتح المحادثة'; thread.innerHTML = '<div class="msg">' + esc(r.message || '') + '</div>'; compose.style.display = 'none'; return; }
  window._currentConvInfo = { otherId: r.conversation.otherId, name: r.conversation.name };
  const icon = r.conversation.type === 'group' ? '👥 ' : r.conversation.type === 'peer' ? '🤝 ' : '🏬 ';
  const pausedBadge = r.conversation.paused ? ' <span class="pill" style="color:#991b1b">⏸️ متوقفة من الإدارة</span>' : '';
  let adminBtns = '';
  if (_chatMyRole === 'admin') {
    adminBtns += `<button class="btnRed" style="min-height:auto;padding:4px 10px;font-size:10px;margin-right:8px" onclick="deleteConv('${id.replace(/'/g, "\\'")}')">🗑️ حذف المحادثة</button>`;
    if (r.conversation.type === 'peer' || r.conversation.type === 'group') {
      adminBtns += r.conversation.paused
        ? `<button class="btnGreen" style="min-height:auto;padding:4px 10px;font-size:10px;margin-right:6px" onclick="resumeConv('${id.replace(/'/g, "\\'")}')">▶️ رفع الإيقاف</button>`
        : `<button class="btnGold" style="min-height:auto;padding:4px 10px;font-size:10px;margin-right:6px" onclick="pauseConv('${id.replace(/'/g, "\\'")}')">⏸️ إيقاف مؤقت</button>`;
    }
  }
  let callBtns = '';
  if (r.conversation.otherId) {
    callBtns = `<button style="min-height:auto;padding:4px 10px;font-size:10px;margin-right:6px" onclick="startCall('audio')">📞</button><button style="min-height:auto;padding:4px 10px;font-size:10px;margin-right:4px" onclick="startCall('video')">📹</button>`;
  }
  header.innerHTML = icon + esc(r.conversation.name || r.conversation.id) + pausedBadge + callBtns + adminBtns;
  compose.style.display = 'block';
  renderThread(r.rows);
};
window.pauseConv = async function (id) { await window.api.chat.pauseConversation(id); openConversation(id); };
window.resumeConv = async function (id) { await window.api.chat.resumeConversation(id); openConversation(id); };

const AUDIO_EXT = ['webm', 'mp3', 'wav', 'ogg', 'm4a', 'aac'];
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'avi', 'mkv'];
function extOf(name) { const m = /\.([a-zA-Z0-9]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function base64ToBlobUrl(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
}

function renderThread(rows) {
  const thread = document.getElementById('chatThread');
  if (!rows.length) { thread.innerHTML = '<div class="tiny" style="text-align:center;margin-top:20px">لا توجد رسائل بعد - ابدأ المحادثة.</div>'; return; }
  thread.innerHTML = rows.map(m => {
    let fileHtml = '';
    if (m.hasFile && m._fileData) {
      const ext = extOf(m.fileName);
      const looksLikeVoiceMsg = /^رسالة-صوتية-/.test(m.fileName || '');
      const looksLikeVideoMsg = /^رسالة-فيديو-/.test(m.fileName || '');
      if (looksLikeVideoMsg || (VIDEO_EXT.includes(ext) && !looksLikeVoiceMsg)) {
        const url = base64ToBlobUrl(m._fileData, 'video/webm');
        fileHtml = `<div class="fileChip" style="flex-direction:column;align-items:stretch"><video controls style="width:100%;max-width:240px;border-radius:8px" src="${url}"></video></div>`;
      } else if (looksLikeVoiceMsg || AUDIO_EXT.includes(ext)) {
        const url = base64ToBlobUrl(m._fileData, 'audio/webm');
        fileHtml = `<div class="fileChip" style="flex-direction:column;align-items:stretch"><audio controls style="width:100%;max-width:220px" src="${url}"></audio></div>`;
      } else {
        const url = base64ToBlobUrl(m._fileData);
        fileHtml = `<div class="fileChip"><span>📎 ${esc(m.fileName || 'ملف')}</span><a href="${url}" download="${esc(m.fileName || 'file')}"><button>⬇️ تنزيل</button></a></div>`;
      }
    }
    const mine = m.senderId === _chatMyId;
    return `<div class="bubble ${mine ? 'me' : 'other'}">
      <div class="sndr">${esc(m.senderName)}</div>
      ${m.body ? esc(m.body).replace(/\n/g, '<br>') : ''}
      ${fileHtml}
      <div class="time">${fmtTime(m.createdAt)}</div>
    </div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}
function fmtTime(iso) { try { return new Date(iso).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); } catch (e) { return ''; } }

window.onChatFilePicked = function () {
  const inp = document.getElementById('chatFileInput');
  pendingChatFile = inp.files && inp.files[0] ? inp.files[0] : null;
  document.getElementById('chatFileName').textContent = pendingChatFile ? '📎 ' + pendingChatFile.name : '';
};

window.sendChatMessage = async function () {
  if (!currentConversationId) return;
  const input = document.getElementById('chatMsgInput');
  const body = input.value;
  if (!body.trim() && !pendingChatFile) return;
  const r = await window.api.chat.send(currentConversationId, body, pendingChatFile);
  if (r.ok) {
    input.value = ''; pendingChatFile = null; document.getElementById('chatFileInput').value = ''; document.getElementById('chatFileName').textContent = '';
    openConversation(currentConversationId);
  } else {
    alert(r.message || 'تعذّر الإرسال.');
  }
};

window.deleteConv = async function (id) {
  if (!confirm('نقل هذه المحادثة إلى سلة المحذوفات؟')) return;
  await window.api.chat.deleteConversation(id);
  currentConversationId = null;
  document.getElementById('chatHeader').textContent = 'اختر محادثة من القائمة';
  document.getElementById('chatThread').innerHTML = '';
  document.getElementById('chatComposeBar').style.display = 'none';
  loadConversations(); loadChatTrash();
};

// ---- القوالب (إدارة فقط) ----
window.toggleTemplatesBar = async function () {
  const bar = document.getElementById('chatTemplatesBar');
  if (bar.style.display === 'block') { bar.style.display = 'none'; return; }
  if (!_tplCache) { const r = await window.api.chat.templates(); _tplCache = r.ok ? r.rows : []; }
  bar.innerHTML = _tplCache.length ? _tplCache.map(t => `<span class="tplPick" onclick="useTemplate('${t.id}')">${esc(t.title)}</span>`).join('') : '<span class="tiny">لا توجد قوالب - أضف واحدًا من قسم "قوالب الرسائل" أعلاه.</span>';
  bar.style.display = 'block';
};
window.useTemplate = function (id) {
  const t = (_tplCache || []).find(x => x.id === id);
  if (t) document.getElementById('chatMsgInput').value = t.body;
  document.getElementById('chatTemplatesBar').style.display = 'none';
};
async function loadTemplatesAdmin() {
  const r = await window.api.chat.templates();
  _tplCache = r.ok ? r.rows : [];
  const el = document.getElementById('templatesList');
  if (!el) return;
  el.innerHTML = _tplCache.length ? _tplCache.map(t => `<div class="brRow"><div class="brInfo"><b>${esc(t.title)}</b><span>${esc(t.body)}</span></div><div class="brActions"><button class="btnRed" onclick="removeTemplate('${t.id}')">🗑️</button></div></div>`).join('') : '<div class="tiny">لا توجد قوالب بعد.</div>';
}
window.addNewTemplate = async function () {
  const title = document.getElementById('tplTitle').value, body = document.getElementById('tplBody').value;
  const r = await window.api.chat.addTemplate(title, body);
  if (r.ok) { document.getElementById('tplTitle').value = ''; document.getElementById('tplBody').value = ''; loadTemplatesAdmin(); }
  else alert(r.message || 'تعذّرت الإضافة.');
};
window.removeTemplate = async function (id) { await window.api.chat.deleteTemplate(id); loadTemplatesAdmin(); };

// ---- المجموعات (إدارة فقط) ----
async function loadGroupCandidates() {
  const r = await window.api.chat.groupCandidates();
  const el = document.getElementById('groupCandidates');
  if (!r.ok || !r.rows.length) { el.textContent = 'لا توجد فروع معتمدة بعد.'; return; }
  el.innerHTML = r.rows.map(b => `<label style="display:inline-flex;align-items:center;gap:5px;margin:3px 8px 3px 0;font-size:11px"><input type="checkbox" class="grpCand" value="${b.id}"> ${esc(b.displayName)}</label>`).join('');
}
window.createNewGroup = async function () {
  const name = document.getElementById('newGroupName').value;
  const ids = [...document.querySelectorAll('.grpCand:checked')].map(c => c.value);
  const msgEl = document.getElementById('newGroupMsg');
  const r = await window.api.chat.createGroup(name, ids);
  msgEl.style.color = r.ok ? '#166534' : '#991b1b';
  msgEl.textContent = r.message || (r.ok ? 'تم الإنشاء.' : 'تعذّر الإنشاء.');
  if (r.ok) { document.getElementById('newGroupName').value = ''; document.querySelectorAll('.grpCand').forEach(c => c.checked = false); loadConversations(); }
};

// ---- سلة محذوفات المحادثات (إدارة فقط) ----
async function loadChatTrash() {
  const r = await window.api.chat.conversations('trash');
  const el = document.getElementById('chatTrashList');
  if (!el) return;
  if (!r.ok || !r.rows.length) { el.textContent = 'سلة محذوفات المحادثات فارغة حاليًا.'; return; }
  el.innerHTML = r.rows.map(c => `<div class="brRow"><div class="brInfo"><b>${(c.type === 'group' ? '👥 ' : '🏬 ') + esc(c.name || c.id)}</b></div><div class="brActions"><button class="btnGreen" onclick="restoreConv('${c.id.replace(/'/g, "\\'")}')">♻️ استرجاع</button></div></div>`).join('');
}
window.restoreConv = async function (id) { await window.api.chat.restoreConversation(id); loadChatTrash(); loadConversations(); };

// ---- ربط زر "الدردشة" بالقائمة الجانبية بتحميل الصفحة (بدون تعديل renderer.js) ----
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('navChat');
  if (btn) btn.onclick = () => { if (typeof page === 'function') page('chat'); initChatPage(); };
});
