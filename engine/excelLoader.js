(function(){
'use strict';
const locations = (typeof require !== 'undefined') ? require('./locations') : window.LocationsModule;
const XLSX = (typeof require !== 'undefined') ? require('xlsx') : window.XLSX;

function norm(v) { return locations.norm(v).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function barcode(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return Number.isInteger(v) ? v.toFixed(0) : String(v);
  const s = String(v).trim();
  if (/^[0-9.]+e[+-]?\d+$/i.test(s)) { const n = Number(s); if (Number.isFinite(n)) return n.toFixed(0); }
  return s.replace(/^'+/, '').replace(/\.0+$/, '');
}
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function sheet(wb, names) {
  const keys = wb.SheetNames;
  for (const wanted of names) {
    const wn = norm(wanted);
    const found = keys.find(k => norm(k) === wn) || keys.find(k => norm(k).includes(wn) || wn.includes(norm(k)));
    if (found) return { name: found, ws: wb.Sheets[found] };
  }
  // مطابقة احتياطية: نفس الكلمات لكن بترتيب مختلف (مثل "A فئة" بدل "فئة A").
  for (const wanted of names) {
    const wantedWords = norm(wanted).split(' ').filter(Boolean).sort().join(' ');
    const found = keys.find(k => norm(k).split(' ').filter(Boolean).sort().join(' ') === wantedWords);
    if (found) return { name: found, ws: wb.Sheets[found] };
  }
  return null;
}
function rowsOf(hit) { return hit ? XLSX.utils.sheet_to_json(hit.ws, { header: 1, defval: '', raw: true }) : []; }
function locFromHeader(h) {
  const text = String(h || '')
    .replace(/مبيعات\s*3\s*أشهر|مبيعات\s*30\s*يوما?|تم الاستلام\s*10\s*أيام|في التحويل\s*إلى|نقل\s*من|المخزون|كمية/gi, ' ')
    .split('/')[0].trim();
  return locations.locByText({}, text) || locations.locByText({}, h);
}
function matrix(rows, startCol, target, products, resolve) {
  if (!rows.length) return;
  const headers = rows[0];
  const bc = barcodeCol(headers); const bcIdx = bc >= 0 ? bc : 0;
  const cols = [];
  for (let c = startCol; c < headers.length; c++) {
    if (c === bcIdx) continue;
    const loc = locFromHeader(headers[c]);
    if (loc) cols.push([c, loc.id]);
  }
  for (let r = 1; r < rows.length; r++) {
    const raw = barcode(rows[r][bcIdx]); if (!raw) continue;
    const b = (resolve && resolve(raw)) || raw;
    if (!products[b]) products[b] = { barcode: b, name: '', category: '', is_a: 0, product_id: null };
    if (!target[b]) target[b] = {};
    for (const [c, id] of cols) target[b][id] = n(rows[r][c]);
  }
}
function barcodeCol(h) {
  const nh = h.map(norm);
  for (let i = 0; i < nh.length; i++) if (nh[i].includes('باركود')) return i;
  return -1;
}
function nameCol(h) {
  const nh = h.map(norm);
  for (let i = 0; i < nh.length; i++) if (nh[i].includes('اسم المنتج') || nh[i].includes('اسم الصنف') || nh[i] === norm('الصنف') || nh[i].includes('المنتج')) return i;
  return -1;
}
/** يكتشف أزواج أعمدة "الفرع/الكمية" المرقمة بصفحة الاحتياج (الفرع1+الكمية1، الفرع2+الكمية2 ...). */
function needOverrideCols(h) {
  const pairs = [];
  for (let i = 0; i < h.length; i++) {
    const nm = String(h[i] || '').trim();
    const m = nm.match(/^الفرع\s*(\d+)$/);
    if (!m) continue;
    const num2 = m[1];
    let qtyIdx = -1;
    for (let j = 0; j < h.length; j++) {
      if (String(h[j] || '').trim().match(new RegExp('^الكمية\\s*' + num2 + '$'))) { qtyIdx = j; break; }
    }
    if (qtyIdx >= 0) pairs.push({ branchCol: i, qtyCol: qtyIdx });
  }
  return pairs;
}
function rowOverrides(row, pairs, locResolve) {
  const out = [];
  pairs.forEach(p => {
    const destTxt = row[p.branchCol], qty = n(row[p.qtyCol]);
    if (!String(destTxt || '').trim() || qty <= 0) return;
    const loc = locResolve(destTxt);
    if (loc) out.push({ dest: loc, qty });
  });
  return out;
}

// قائمة كل الصفحات التي يعمل عليها البرنامج - كلها إلزامية الآن: يتم التأكد من وجودها
// جميعًا أولًا، وإن كان ينقص أي واحدة منها يُرفض تحميل الملف بالكامل قبل أي تشغيل،
// مع توضيح أي صفحة بالضبط غير موجودة.
// كل الصفحات الـ12 اللي حددتها إلزامية: لو ناقصة أي وحدة، يُرفض تحميل الملف كامل قبل
// أي تشغيل، مع توضيح بالضبط أي صفحة (أو أكثر) ناقصة.
const REQUIRED_SHEETS = [
  { key: 'sales90', names: ['مبيعات 3 اشهر', 'مبيعات 3 أشهر'], label: 'مبيعات 3 أشهر' },
  { key: 'sales30', names: ['مبيعات 30 يوم'], label: 'مبيعات 30 يوم' },
  { key: 'purchases', names: ['المشتريات'], label: 'المشتريات' },
  { key: 'stock', names: ['المخزون'], label: 'المخزون' },
  { key: 'rec10', names: ['استلام اخر 10 ايام', 'استلام آخر 10 أيام'], label: 'استلام اخر 10 ايام' },
  { key: 'incoming', names: ['في التحويل الى', 'في التحويل إلى'], label: 'في التحويل الى' },
  { key: 'moved', names: ['نقل من'], label: 'نقل من' },
  { key: 'spec', names: ['التصنيع الخاص'], label: 'التصنيع الخاص' },
  { key: 'category', names: ['فئة المنتج', 'فئة المنتجات', 'التصنيف الخاص'], label: 'فئة المنتج' },
  { key: 'aclass', names: ['فئة A'], label: 'فئة A' },
  { key: 'need', names: ['المنتجات التي يحتاج لها توزيع'], label: 'المنتجات التي يحتاج لها توزيع' },
  { key: 'restrict', names: ['غير متحرك من الفروع'], label: 'غير متحرك من الفروع' }
];
const OPTIONAL_SHEETS = [];

function readWorkbook(filePathOrBuffer, browserFileName, browserModifiedAt) {
  const isBrowser = typeof window !== 'undefined';
  let wb;
  if (isBrowser) {
    if (!filePathOrBuffer) throw new Error('ملف Excel غير موجود. اختر الملف من جديد.');
    wb = XLSX.read(filePathOrBuffer, { type: 'array', cellDates: true, raw: true });
  } else {
    const fs = require('fs');
    if (!filePathOrBuffer || !fs.existsSync(filePathOrBuffer)) throw new Error('ملف Excel غير موجود. اختر الملف من جديد.');
    wb = XLSX.readFile(filePathOrBuffer, { cellDates: true, raw: true });
  }

  // 1) التحقق من كل الصفحات الإلزامية الـ12 أولًا، دفعة واحدة، قبل أي معالجة.
  const hits = {}, missing = [], warnings = [];
  REQUIRED_SHEETS.forEach(req => {
    const hit = sheet(wb, req.names);
    if (!hit) missing.push(req.label); else hits[req.key] = hit;
  });
  if (missing.length) {
    throw new Error('تعذّر تحميل الملف: الصفحات التالية إلزامية وغير موجودة فيه:\n- ' + missing.join('\n- ') + '\n\nأضف هذه الصفحات للملف بنفس الأسماء ثم أعد المحاولة.');
  }
  OPTIONAL_SHEETS.forEach(opt => {
    const hit = sheet(wb, opt.names);
    if (!hit) warnings.push('صفحة "' + opt.label + '" غير موجودة (اختيارية) - ' + opt.effect);
    else hits[opt.key] = hit;
  });

  const ctx = { products: {}, barcodes: [], stock: {}, sales30: {}, sales90: {}, incoming: {}, moved: {}, rec10: {}, spec: {}, purchases: {}, restricted: {}, needRows: [], stockDupList: [] };

  const stockRows = rowsOf(hits.stock);
  if (!stockRows.length) throw new Error('صفحة "المخزون" موجودة لكنها فارغة.');
  const stockHead = stockRows[0];
  const stockBc = barcodeCol(stockHead), stockNc = nameCol(stockHead);
  const stockBcIdx = stockBc >= 0 ? stockBc : 0, stockNcIdx = stockNc >= 0 ? stockNc : 1;
  const stockSeen = {}, stockDup = {};
  for (let r = 1; r < stockRows.length; r++) {
    const b = barcode(stockRows[r][stockBcIdx]); if (!b) continue;
    const nm = String(stockRows[r][stockNcIdx] || '');
    if (stockSeen[b] !== undefined) {
      if (!stockDup[b]) stockDup[b] = { barcode: b, name: nm, count: 1, firstRow: stockSeen[b] + 2 };
      stockDup[b].count++;
    } else stockSeen[b] = r - 1;
    ctx.products[b] = { barcode: b, name: nm, category: '', is_a: 0, product_id: null };
  }
  ctx.stockDupList = Object.values(stockDup);
  matrix(stockRows, Math.max(stockBcIdx, stockNcIdx) + 1, ctx.stock, ctx.products);

  // فهرس مساعد يتجاوز فروقات الأصفار البادئة بين الصفحات (مثال: "0847610" مقابل "847610")
  // - شائعة جدًا لما تُخزَّن نفس الباركودات كنص بصفحة وكرقم بصفحة أخرى بإكسل.
  const zeroStrip = s => String(s).replace(/^0+(?=\d)/, '');
  const barcodeIndex = {};
  Object.keys(ctx.products).forEach(b => { const z = zeroStrip(b); if (!barcodeIndex[z]) barcodeIndex[z] = b; });
  function resolveBarcode(b) { if (ctx.products[b]) return b; const z = barcodeIndex[zeroStrip(b)]; return z || null; }

  const specs = [
    [hits.sales30, 'sales30'], [hits.sales90, 'sales90'], [hits.incoming, 'incoming'],
    [hits.moved, 'moved'], [hits.rec10, 'rec10'], [hits.spec, 'spec']
  ];
  for (const [hit, key] of specs) {
    const rows = rowsOf(hit);
    if (rows.length) matrix(rows, 1, ctx[key], ctx.products, resolveBarcode);
  }

  if (hits.purchases) {
    const pur = rowsOf(hits.purchases);
    for (let r = 1; r < pur.length; r++) {
      const raw = barcode(pur[r][0]); if (!raw) continue;
      const b = resolveBarcode(raw) || raw;
      let d = pur[r][1];
      if (d instanceof Date) d = d.toISOString();
      else if (typeof d === 'number') d = XLSX.SSF.format('yyyy-mm-dd', d);
      ctx.purchases[b] = { date: d ? String(d) : '', qty: n(pur[r][2]) };
    }
  }

  // صفحة "فئة المنتج": تدعم الآن هيكلة 3 مستويات اختيارية (الفئة الرئيسية / الفئة الفرعية /
  // البراند) بالإضافة للشكل القديم (عمود فئة واحد). كلها اختيارية تمامًا - غياب أي عمود منها
  // لا يمنع معالجة المنتج إطلاقًا، فقط يترك ذلك الحقل فارغًا.
  if (hits.category) {
    const cat = rowsOf(hits.category);
    if (cat.length) {
      const catHead = cat[0].map(norm);
      const bcCat = catHead.findIndex(x => x.includes('باركود'));
      const mainCol = catHead.findIndex(x => x.includes(norm('رئيسي')));
      const subCol = catHead.findIndex(x => x.includes(norm('فرعي')));
      const brandCol = catHead.findIndex(x => x.includes(norm('براند')) || x.includes(norm('ماركة')) || x.includes(norm('العلامة')));
      // إذا لم توجد أي من أعمدة الهيكلة الجديدة، اعتمد الشكل القديم: أول عمود يحتوي "فئ"/"تصنيف".
      const legacyCol = (mainCol < 0 && subCol < 0 && brandCol < 0) ? catHead.findIndex(x => x.includes('فئ') || x.includes('تصنيف')) : -1;
      for (let r = 1; r < cat.length; r++) {
        const raw = barcode(cat[r][bcCat >= 0 ? bcCat : 0]); if (!raw) continue;
        const b = resolveBarcode(raw); if (!b) continue;
        const mainCat = mainCol >= 0 ? String(cat[r][mainCol] || '').trim() : '';
        const subCat = subCol >= 0 ? String(cat[r][subCol] || '').trim() : '';
        const brand = brandCol >= 0 ? String(cat[r][brandCol] || '').trim() : '';
        if (mainCat) ctx.products[b].mainCategory = mainCat;
        if (subCat) ctx.products[b].subCategory = subCat;
        if (brand) ctx.products[b].brand = brand;
        // العمود القديم "category" يبقى معبأ دائمًا للتوافق مع كل الأماكن التي تعرضه -
        // من الفئة الرئيسية إن وُجدت، وإلا الشكل القديم.
        if (mainCat) ctx.products[b].category = mainCat;
        else if (legacyCol >= 0) ctx.products[b].category = String(cat[r][legacyCol] || '');
      }
    }
  }

  // صفحة "فئة A": صفحة منفصلة تمامًا عن "فئة المنتج" - مجرد قائمة باركودات تعتبر "فئة A"
  // (وجود الباركود في هذه الصفحة = فئة A، بغض النظر عن القيمة المكتوبة في العمود الثاني).
  if (hits.aclass) {
    const aRows = rowsOf(hits.aclass);
    for (let r = 1; r < aRows.length; r++) {
      const raw = barcode(aRows[r][0]); if (!raw) continue;
      const b = resolveBarcode(raw) || raw;
      if (!ctx.products[b]) ctx.products[b] = { barcode: b, name: '', category: '', is_a: 0, product_id: null };
      ctx.products[b].is_a = 1;
    }
  }

  // صفحة "غير متحرك من الفروع": تحدد قيود عرض كل باركود. الصياغة تختلف من صف لصف، لذلك
  // لازم فهم القصد لا مجرد وجود اسم الفرع في النص:
  //  - صياغة إيجابية بسيطة (فرع1+فرع2+فرع3): قائمة سماح - مسموح فقط بهذي الفروع.
  //  - صياغة نفي مع اسم فرع محدد ("لا ينعرض في المبرز"): مستثنى هذا الفرع فقط - مسموح بالباقي.
  //  - صياغة نفي عامة بدون اسم فرع ("لا ينعرض في الفروع"): مستثنى من كل الفروع.
  const restrictRows = hits.restrict ? rowsOf(hits.restrict) : [];
  const allLocs = locations.allLocations({});
  const allBranchIds = allLocs.filter(l => l.type === 'branch').map(l => l.id);
  // كلمات تدل على المنع/الاستثناء - أي وجودها بالنص يعني "ممنوع/مستثنى" وليس "مسموح".
  // نتحقق منها أولًا قبل أي تفسير آخر. تشمل تنويعات كثيرة عمدًا لأن صياغة المستخدم تتغير.
  const NEG_RE = /لا(ي|ت)(نعرض|عرض|سمح|تم)|غير(معروض|مسموح|متاح)|ممنوع|مستثنى|بدون(عرض|ظهور)/;
  for (let r = 1; r < restrictRows.length; r++) {
    const row = restrictRows[r];
    const raw = barcode(row[0]); if (!raw) continue;
    const b = resolveBarcode(raw) || raw;
    // نص القيد فقط (الأعمدة بعد الباركود والاسم) - لا نفحص اسم المنتج نفسه لتفادي تطابقات خاطئة.
    const cellText = row.slice(2).join(' ') || String(row[1] || '');
    const txt = norm(cellText);
    const txtNoSpace = txt.replace(/\s+/g, '');
    const negated = NEG_RE.test(txtNoSpace);
    const matchedIds = allLocs.filter(loc => loc.aliases.some(a => txt.includes(norm(a)))).map(loc => loc.id);
    let allowedIds = null;
    if (negated) {
      if (matchedIds.length) allowedIds = allBranchIds.filter(id => !matchedIds.includes(id));
      else if (txt.includes(norm('فروع'))) allowedIds = [];
    } else if (matchedIds.length) {
      allowedIds = matchedIds;
    }
    if (allowedIds !== null) ctx.restricted[b] = allowedIds;
  }

  ctx.barcodes = Object.keys(ctx.products);

  // صفحة "المنتجات التي يحتاج لها توزيع": هي القائمة المعتمدة للتشغيل عليها (وليست كل
  // منتجات المخزون)، تمامًا كما في النسخة الأصلية على Google Sheets.
  const needRowsRaw = rowsOf(hits.need);
  if (!needRowsRaw.length) throw new Error('صفحة "المنتجات التي يحتاج لها توزيع" موجودة لكنها فارغة.');
  const head = needRowsRaw[0];
  const bc = barcodeCol(head), nc = nameCol(head);
  if (bc < 0) throw new Error('عمود الباركود غير موجود في صفحة "المنتجات التي يحتاج لها توزيع". تحقق من وجود عمود باسم يحتوي على "باركود".');
  const pairs = needOverrideCols(head);
  for (let r = 1; r < needRowsRaw.length; r++) {
    const row = needRowsRaw[r];
    const b = barcode(row[bc]); if (!b) continue;
    const name = nc >= 0 ? String(row[nc] || '') : (ctx.products[b] ? ctx.products[b].name : '');
    if (!ctx.products[b]) ctx.products[b] = { barcode: b, name, category: '', is_a: 0, product_id: null };
    else if (!ctx.products[b].name && name) ctx.products[b].name = name;
    const overrides = pairs.length ? rowOverrides(row, pairs, txt => locations.locByText({}, txt)) : [];
    ctx.needRows.push({ barcode: b, name, overrides });
  }
  ctx.needBarcodes = ctx.needRows.map(x => x.barcode);

  let name, modifiedAt;
  if (isBrowser) {
    name = browserFileName || 'ملف.xlsx';
    modifiedAt = browserModifiedAt || new Date().toISOString();
  } else {
    const path = require('path');
    const fs = require('fs');
    const stat = fs.statSync(filePathOrBuffer);
    name = path.basename(filePathOrBuffer);
    modifiedAt = stat.mtime.toISOString();
  }
  return { ctx, info: { name, sheets: wb.SheetNames.length, products: ctx.barcodes.length, needProducts: (ctx.needBarcodes || ctx.barcodes).length, modifiedAt, warnings } };
}
/**
 * يبني شجرة الفئات (رئيسية ← فرعية ← براند) من منتجات معينة (قائمة باركودات)، لتغذية
 * القوائم المنسدلة المتتالية بالواجهة. يتجاهل بصمت أي منتج ما عنده الفئة الرئيسية (لا يمنع
 * شيء، فقط لا يظهر ضمن الشجرة).
 */
function buildCategoryTree(ctx, barcodes) {
  const tree = {};
  (barcodes || ctx.barcodes).forEach(b => {
    const p = ctx.products[b]; if (!p || !p.mainCategory) return;
    const main = p.mainCategory, sub = p.subCategory || '(بدون فئة فرعية)', brand = p.brand || '(بدون براند)';
    if (!tree[main]) tree[main] = {};
    if (!tree[main][sub]) tree[main][sub] = new Set();
    tree[main][sub].add(brand);
  });
  const out = {};
  Object.keys(tree).forEach(main => {
    out[main] = {};
    Object.keys(tree[main]).forEach(sub => { out[main][sub] = Array.from(tree[main][sub]).sort(); });
  });
  return out;
}

/**
 * تدقيق الفئات: يفحص قائمة باركودات معينة (صفحة الاحتياج أو المخزون كامل) ويرجع كل تركيبة
 * (رئيسية > فرعية > براند) موجودة فيها مع عدد المنتجات لكل تركيبة، بما فيها "بدون فئة" لمن لا
 * فئة له إطلاقًا - حتى يتأكد المستخدم هل الفئات المفقودة كثيرة أو نادرة. لا يستبعد أي منتج.
 */
function categoryAudit(ctx, barcodes) {
  const counts = {};
  barcodes.forEach(b => {
    const p = ctx.products[b];
    const main = (p && p.mainCategory) || '(بدون فئة رئيسية)';
    const sub = (p && p.subCategory) || '(بدون فئة فرعية)';
    const brand = (p && p.brand) || '(بدون براند)';
    const key = main + ' > ' + sub + ' > ' + brand;
    if (!counts[key]) counts[key] = { mainCategory: main, subCategory: sub, brand: brand, count: 0 };
    counts[key].count++;
  });
  return Object.values(counts).sort((a, b) => b.count - a.count);
}

const __exports = { readWorkbook, buildCategoryTree, categoryAudit };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
else if (typeof window !== 'undefined') window.ExcelLoaderModule = __exports;

})();
