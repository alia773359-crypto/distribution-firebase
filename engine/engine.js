(function(){
'use strict';
const locations = (typeof require !== 'undefined') ? require('./locations') : window.LocationsModule;

function num(v) { v = Number(v || 0); return isNaN(v) ? 0 : v; }

function runId() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return 'RUN-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function fmtTime(ms) {
  let s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return [h, m, x].map(n => String(n).padStart(2, '0')).join(':');
}

/** يبني دوال قراءة قيم منتج/موقع من سياق البيانات المتزامنة من Odoo. */
function makeReaders(ctx) {
  function v(map, b, locId) { return num(map[b] && map[b][locId]); }
  function vals(b, locId) {
    return {
      s30: v(ctx.sales30, b, locId),
      s90: v(ctx.sales90, b, locId),
      stock: v(ctx.stock, b, locId),
      incoming: v(ctx.incoming, b, locId),
      moved: v(ctx.moved, b, locId),
      rec10: v(ctx.rec10, b, locId)
    };
  }
  function daily(vv) { return Math.max(vv.s30 / 30, vv.s90 / 90); }
  function purch(b) {
    const p = ctx.purchases[b];
    return p ? { date: p.date || '', qty: (p.qty || p.qty === 0) ? p.qty : 'N/A' } : { date: '', qty: 'N/A' };
  }
  function category(b) { return (ctx.products[b] && ctx.products[b].category) || ''; }
  function isA(b) { return !!(ctx.products[b] && ctx.products[b].is_a); }
  function restricted(b) { return ctx.restricted[b] || null; }
  function spec(b, locId) { return v(ctx.spec, b, locId); }
  return { vals, daily, purch, category, isA, restricted, spec };
}

function priority(readers, b, selectedDests) {
  let sum30 = 0, sum90 = 0, minDays = 9999, hasA = readers.isA(b) ? 1 : 0;
  selectedDests.forEach(loc => {
    const vv = readers.vals(b, loc.id), d = readers.daily(vv);
    sum30 += vv.s30; sum90 += vv.s90;
    if (d > 0) minDays = Math.min(minDays, Math.floor(vv.stock / d));
  });
  let score = 0;
  score += Math.min(35, sum30 / 3);
  score += Math.min(25, sum90 / 9);
  score += hasA ? 20 : 0;
  score += minDays <= 3 ? 15 : minDays <= 7 ? 10 : minDays <= 15 ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function whThreshold(cfg, locId) {
  if (cfg.whLimits && Object.prototype.hasOwnProperty.call(cfg.whLimits, locId)) return cfg.whLimits[locId];
  return cfg.whMin;
}
function sourceReserve(sv, isWh, cfg, isExceptional, locId, readers) {
  if (isExceptional) return 0;
  if (isWh) {
    const thr = whThreshold(cfg, locId);
    return sv.stock > thr ? 0 : Math.max(0, sv.stock);
  }
  const daily = readers.daily(sv);
  if (daily > 0) return Math.ceil(daily * cfg.keep);
  return Number(cfg.zeroSalesKeep || 0) || 0;
}
function available(sv, isWh, cfg, isExceptional, locId, readers) {
  const reserve = sourceReserve(sv, isWh, cfg, isExceptional, locId, readers);
  return Math.max(0, sv.stock - reserve - sv.moved);
}
function sourceScore(so, cfg, readers) {
  const daily = readers.daily(so.sv), coverAfter = daily > 0 ? ((so.sv.stock - so.av) / daily) : 9999;
  let score = 0;
  score += so.isWh ? 10000 : 0;
  score += so.av * 10;
  score -= daily * 20;
  score -= so.sv.moved * 5;
  score -= so.sv.incoming * 2;
  score += coverAfter > cfg.keep ? 50 : 0;
  return score;
}

function reject(arr, rid, code, b, name, prio, target, targetAr, reason, type, detail, need, inc, rem, mode) {
  arr.push({ runId: rid, code, barcode: b, name, priority: prio, target, targetAr, reason, type, detail, need: need || 0, incoming: inc || 0, remaining: rem || 0, mode });
}

const ZERO_SALES_REJECT_REASON = 'مبيعات الوجهة صفر وتم ضبط كمية بلا مبيعات = 0، لذلك تم إلغاء التوزيع وإرسال المنتج لرفع الكمية';

/**
 * التشغيل الرئيسي للتوزيع. mode: 'Turbo' | 'BIG DATA' | 'السحب الكامل الاستثنائي' | 'حدود الفروع الخاصة' | 'Turbo يدوي'
 * ctx: مخرجات store.loadSyncedContext()
 * cfg: كل إعدادات اللوحة (نفس أسماء الحقول في اللوحة الأصلية) + selectedSources/selectedDests (مصفوفة IDs) + branchLimits + whLimits
 * onProgress(evt): تُستدعى دوريًا لتحديث واجهة المستخدم (شريط تقدم، مؤشرات، إلخ)
 */
function runDistribution(mode, manual, cfg, ctx, onProgress) {
  const t0 = Date.now(), rid = runId();
  const readers = makeReaders(ctx);
  const isExceptional = (mode === 'السحب الكامل الاستثنائي' || mode === 'exceptional');
  const isBranchLimitMode = (mode === 'حدود الفروع الخاصة');
  const isBigData = (mode === 'BIG DATA');

  const allLocs = locations.allLocations(cfg.locConfig || {});
  const srcSet = {}, dstSet = {};
  (cfg.selectedSources || []).forEach(id => srcSet[id] = 1);
  (cfg.selectedDests || []).forEach(id => dstSet[id] = 1);
  let selectedSources = allLocs.filter(x => srcSet[x.id]);
  let selectedDests = allLocs.filter(x => dstSet[x.id]);
  if (!selectedSources.length) throw new Error('لم يتم تحديد أي مصدر');
  if (!selectedDests.length) throw new Error('لم يتم تحديد أي وجهة');
  if (isBranchLimitMode) {
    selectedDests = selectedDests.filter(d => cfg.branchLimits[d.id] && cfg.branchLimits[d.id].min !== undefined);
    if (!selectedDests.length) throw new Error('لا توجد أي وجهة من ضمن الوجهات المحددة لها حد أدنى خاص. هذا الوضع يعمل فقط على الفروع التي أدخلت لها حد أدنى.');
  }

  // صفحة "المنتجات التي يحتاج لها توزيع" هي القائمة المعتمدة (وليست كل منتجات المخزون) - لكن
  // هذا لا يناسب زر "حدود الفروع الخاصة": هدفه بالضبط هو فحص *كل* منتجات المخزون (مو بس
  // القائمة المُعدَّة يدويًا) عشان يوصل كل فرع محدد له حد للحد المطلوب، حتى لو المنتج نفسه غير
  // مُدرَج أصلًا بصفحة "يحتاج توزيع". فبهذا الوضع تحديدًا نتجاهل تلك الصفحة ونستخدم كل باركودات
  // المخزون مباشرة (مع احترام فلاتر الفئة/البراند العادية أدناه كما هي).
  const needList = isBranchLimitMode
    ? ctx.barcodes.filter(b => b).map(b => ({ barcode: b, name: (ctx.products[b] && ctx.products[b].name) || '', overrides: [] }))
    : (ctx.needRows && ctx.needRows.length)
      ? ctx.needRows
      : ctx.barcodes.filter(b => b).map(b => ({ barcode: b, name: (ctx.products[b] && ctx.products[b].name) || '', overrides: [] }));
  const isTurboOrBigData = (mode === 'Turbo' || mode === 'BIG DATA');
  const toArrCat = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
  const fMainCat = toArrCat(cfg.filterMainCategory), fSubCat = toArrCat(cfg.filterSubCategory), fBrandCat = toArrCat(cfg.filterBrand);
  const catFilterActive = fMainCat.length || fSubCat.length || fBrandCat.length;
  let rows = needList
    .filter(item => {
      if (!catFilterActive) return true;
      const p = ctx.products[item.barcode] || {};
      if (fMainCat.length && !fMainCat.includes(p.mainCategory || '')) return false;
      if (fSubCat.length && !fSubCat.includes(p.subCategory || '')) return false;
      if (fBrandCat.length && !fBrandCat.includes(p.brand || '')) return false;
      return true;
    })
    .map(item => ({
      barcode: item.barcode,
      name: item.name || (ctx.products[item.barcode] && ctx.products[item.barcode].name) || '',
      overrides: item.overrides || [],
      priority: priority(readers, item.barcode, selectedDests)
    }));
  rows.sort((a, b) => b.priority - a.priority);

  const bout = [], wout = [], raise = [], history = [];
  let trans = 0, qtySum = 0, covered = 0;
  const summary = { products: rows.length, transfers: 0, qty: 0, rejected: 0, critical: [], overstock: [], heat: [], coveredPct: '0%' };
  const monitorEvery = Math.max(10, Math.min(200, Math.ceil(rows.length / 40)));

  rows.forEach((item, idx) => {
    const b = item.barcode, name = item.name, prio = item.priority;
    const rest = readers.restricted(b);
    const usedSrc = {}, addedDst = {};
    const usedOf = id => num(usedSrc[id]);
    const addedTo = id => num(addedDst[id]);
    const curDestStock = (dv, destId) => dv.stock + addedTo(destId);
    const safeAvail = so => Math.max(0, (so.baseAv || 0) - usedOf(so.s.id));
    const register = (srcId, destId, q) => { usedSrc[srcId] = usedOf(srcId) + q; addedDst[destId] = addedTo(destId) + q; };
    let productCovered = false;

    // كمية مخصصة لكل فرع من صفحة الاحتياج (أعمدة الفرع1/الكمية1 ...): تُنفذ بدل الحساب
    // التلقائي لهذا المنتج بالكامل، بنفس شروط التوزيع المعتادة (مصدر أفضل، أقل تحويل،
    // منع تكدس، كمية الإبقاء، قيود العرض). تعمل فقط بـ Turbo وBIG DATA.
    if (isTurboOrBigData && item.overrides && item.overrides.length) {
      const ordered = item.overrides.map(o => {
        const dv = readers.vals(b, o.dest.id), daily = readers.daily(dv);
        return { dest: o.dest, qty: o.qty, dv, daily };
      }).sort((a, b2) => b2.daily - a.daily);
      ordered.forEach(o => {
        const dest = o.dest, dv = o.dv, daily = o.daily;
        const beforeDays = daily > 0 ? Math.floor(dv.stock / daily) : 9999;
        if (rest && rest.indexOf(dest.id) < 0) {
          reject(raise, rid, 'R002', b, name, prio, dest.id, dest.ar, 'الصنف لا ينعرض في هذه الوجهة (كمية مخصصة من صفحة الاحتياج)', 'قيود العرض', 'مسموح فقط: ' + rest.map(x => locations.locById(cfg.locConfig || {}, x).ar).join('، '), o.qty, dv.incoming, 0, mode);
          return;
        }
        const sources = selectedSources.filter(s => s.id !== dest.id).map(s => {
          const sv = readers.vals(b, s.id), isWh = s.type === 'wh';
          const av = available(sv, isWh, cfg, false, s.id, readers);
          const obj = { s, sv, baseAv: av, av: Math.max(0, av - usedOf(s.id)), isWh };
          obj.score = sourceScore(obj, cfg, readers);
          return obj;
        }).filter(x => x.av > 0).sort((a, b2) => b2.score - a.score);
        let rem = o.qty;
        for (const so of sources) {
          if (rem <= 0) break;
          so.av = safeAvail(so);
          if (so.av <= 0) continue;
          let q = Math.min(rem, so.av);
          let capKeepQty = Infinity;
          if (cfg.keepQty > 0) { capKeepQty = Math.max(0, so.sv.stock - usedOf(so.s.id) - cfg.keepQty); q = Math.min(q, capKeepQty); }
          const dstStockNow = curDestStock(dv, dest.id);
          let capMaxCover = Infinity;
          if (daily > 0 && (dstStockNow + q) / daily > cfg.maxCover) {
            const qMax = Math.max(0, Math.floor(daily * cfg.maxCover - dstStockNow));
            if (qMax < cfg.minTr) { reject(raise, rid, 'R006', b, name, prio, dest.id, dest.ar, 'سيصبح الفرع مكدس', 'منع التكدس', 'التغطية ستتجاوز ' + cfg.maxCover + ' يوم (كمية مخصصة)', o.qty, dv.incoming, rem, mode); break; }
            capMaxCover = qMax; q = Math.min(q, qMax);
          }
          if (q <= 0) { reject(raise, rid, 'R010', b, name, prio, dest.id, dest.ar, 'تم إلغاء التوزيع لأن كمية التحويل المحسوبة = 0', 'تحويل صفر', 'الاحتياج المخصص: ' + o.qty + ' / المتبقي: ' + rem + ' / المصدر: ' + so.s.ar, o.qty, dv.incoming, rem, mode); continue; }
          const minTrEff = num(cfg.minTr);
          if (minTrEff > 0 && q < minTrEff) {
            if (cfg.raiseSmallNeed > 0) {
              const raiseCeil = Math.min(so.av, capKeepQty, capMaxCover);
              const raised = Math.min(cfg.raiseSmallNeed, raiseCeil);
              if (raised <= 0) { reject(raise, rid, 'R011', b, name, prio, dest.id, dest.ar, 'تم رفض التوزيع لأن الكمية أقل من أقل تحويل ولا توجد كمية كافية بالمصدر حتى بعد الرفع', 'أقل من الحد الأدنى', 'الكمية المحسوبة: ' + q + ' / أقل تحويل محدد: ' + minTrEff + ' / رفع الاحتياج إلى: ' + cfg.raiseSmallNeed + ' / المصدر: ' + so.s.ar, o.qty, dv.incoming, rem, mode); continue; }
              q = raised;
            } else {
              reject(raise, rid, 'R011', b, name, prio, dest.id, dest.ar, 'تم رفض التوزيع لأن الكمية أقل من أقل تحويل', 'أقل من الحد الأدنى', 'الكمية المحسوبة: ' + q + ' / أقل تحويل محدد: ' + minTrEff + ' / المصدر: ' + so.s.ar, o.qty, dv.incoming, rem, mode); continue;
            }
          }
          const pur = readers.purch(b), cat = readers.category(b), af = readers.isA(b) ? 'A' : '', risk = beforeDays <= 3 ? 'مرتفع' : beforeDays <= 7 ? 'متوسط' : 'منخفض';
          const afterDays = daily > 0 ? Math.floor((curDestStock(dv, dest.id) + q) / daily) : 9999, remainSrc = Math.max(0, so.sv.stock - usedOf(so.s.id) - q);
          const reason = (so.isWh ? 'مستودع مختار - أولوية المستودعات' : 'أفضل مصدر حسب درجة الفائض والمبيعات والنقل الحالي') + ' / فائض: ' + so.av + ' / درجة المصدر: ' + Math.round(so.score) + ' / كمية مخصصة من صفحة الاحتياج: ' + o.qty;
          const record = { runId: rid, barcode: b, name, priority: prio, category: cat, purchaseDate: pur.date, purchaseQty: pur.qty, rec10: dv.rec10, srcId: so.s.id, srcAr: so.s.ar, srcS90: so.sv.s90, srcS30: so.sv.s30, srcStock: so.sv.stock, srcRemain: remainSrc, destId: dest.id, destAr: dest.ar, destS90: dv.s90, destS30: dv.s30, destStock: dv.stock, destIncoming: dv.incoming, qty: q, aClass: af, mode, need: o.qty, coverTarget: cfg.cover, reason, beforeDays, afterDays, risk };
          (so.isWh ? wout : bout).push(record);
          history.push([rid, new Date().toISOString(), b, name, so.s.id, so.s.ar, dest.id, dest.ar, q, mode, reason]);
          register(so.s.id, dest.id, q);
          rem -= q; trans++; qtySum += q; productCovered = true;
        }
        if (rem > 0) reject(raise, rid, 'R014', b, name, prio, dest.id, dest.ar, 'لم تتوفر الكمية المخصصة كاملة من المصادر المحددة', 'كمية مخصصة غير مكتملة', 'المطلوب: ' + o.qty + ' / المتبقي غير المغطى: ' + rem, o.qty, dv.incoming, rem, mode);
      });
      if (productCovered) covered++;
      if (onProgress && idx % monitorEvery === 0) {
        const done = idx + 1, elapsedMs = Date.now() - t0;
        const speed = elapsedMs > 0 ? Math.round(done / (elapsedMs / 1000)) : 0;
        onProgress({
          status: isBigData ? ('BIG DATA يعمل - المنتج ' + done + ' من ' + rows.length) : 'جاري التشغيل',
          progress: Math.round(done / rows.length * 100), products: rows.length, done, speed,
          transfers: trans, qty: qtySum, rejected: raise.length, critical: summary.critical.length,
          coveredPct: Math.round((covered / rows.length) * 100) + '%', elapsed: fmtTime(elapsedMs)
        });
      }
      return;
    }

    const dests = selectedDests.map(dest => {
      const dv = readers.vals(b, dest.id), daily = readers.daily(dv);
      const bl = cfg.branchLimits[dest.id];
      let baseNeed, bypassStack = false, raisedSales = false;
      if (isExceptional) {
        baseNeed = (bl && bl.max !== undefined) ? Math.max(0, bl.max - dv.stock - dv.incoming) : Math.max(0, cfg.exceptionQty);
      } else if (manual) {
        baseNeed = Math.max(0, cfg.manualQty);
      } else if (isBranchLimitMode) {
        // العطل كان هنا بالضبط: كنا نستخدم "bl.min" كما هو (رقم الحد نفسه، مثلاً 12) كاحتياج
        // مباشر، بدل حساب "الناقص فعليًا للوصول للحد" (الحد - المخزون الحالي - اللي بالطريق).
        // هذا كان يخلي هذا الوضع (الزر المستقل "حدود الفروع الخاصة") يتصرف بشكل عشوائي/وهمي
        // (يرسل كمية الحد كاملة حتى لو الفرع عنده مخزون قريب من الحد أصلًا). الآن نستخدم نفس
        // منطق "العجز" المستخدم بباقي أوضاع التشغيل (Turbo/BIG DATA) كأرضية دنيا: لو الحد = 12
        // والمخزون = 8 (وما فيه شي بالطريق)، الناقص = 12 - 8 = 4، فيصير الاحتياج 4 بالضبط.
        const minFloorNeed = Math.max(0, bl.min - dv.stock - dv.incoming);
        const salesNeed = daily > 0 ? Math.max(0, Math.ceil(daily * cfg.cover - dv.stock - dv.incoming)) : 0;
        if (String(cfg.branchLimitMode) === 'المبيعات') baseNeed = salesNeed;
        else if (salesNeed <= minFloorNeed) { baseNeed = minFloorNeed; bypassStack = true; }
        else baseNeed = salesNeed; // المبيعات أعلى من الحد - نوزّع حسب المبيعات والتغطية بدل الحد
      } else if (daily > 0) {
        baseNeed = Math.max(0, Math.ceil(daily * cfg.cover - dv.stock - dv.incoming));
      } else if (!manual && cfg.salesRaise > 0) {
        const effDaily = cfg.salesRaise / 30;
        baseNeed = Math.max(0, Math.ceil(effDaily * cfg.cover - dv.stock - dv.incoming));
        raisedSales = true;
      } else if (bl && bl.max !== undefined) {
        baseNeed = Math.max(0, bl.max - dv.stock - dv.incoming);
      } else {
        baseNeed = Math.max(0, cfg.noSales);
      }
      // الحد الأدنى الخاص بالفرع (من "حدود الفروع الخاصة") يُطبَّق الآن كأرضية دنيا على كل
      // أوضاع التشغيل العادية (Turbo وBIG DATA و"Turbo يدوي" وغيرها) - وليس فقط بزر "حدود
      // الفروع الخاصة" المستقل. هذا تغيير إضافي بحت: يفعّل فقط للفرع اللي حددت له حدًا أدنى
      // صراحة، ولا يُنقص الاحتياج المحسوب أصلًا أبدًا - فقط يرفعه لو كان أقل من الحد الأدنى
      // المطلوب لذاك الفرع (يعني ياخذ الأكبر بين احتياج المبيعات/الكمية اليدوية وبين "الحد -
      // المخزون الحالي"). ملاحظة: "Turbo يدوي" (manual) كان مستثنى من هذا سابقًا بالغلط، وهذا
      // كان يخلي الكمية اليدوية المحددة تتجاهل حدود الفروع بالكامل - تم تفعيله له الآن أيضًا.
      if (!isExceptional && !isBranchLimitMode && bl && bl.min !== undefined) {
        const minFloorNeed = Math.max(0, bl.min - dv.stock - dv.incoming);
        if (minFloorNeed > baseNeed) baseNeed = minFloorNeed;
      }
      const days = daily > 0 ? Math.floor(dv.stock / daily) : 9999;
      if (daily > 0) {
        const status = days < cfg.cover ? '🔴 احتياج' : (days > cfg.maxCover ? '🟡 فائض' : '🔵 متوازن');
        summary.heat.push({ barcode: b, loc: dest.ar, status, note: 'تغطية حالية ' + days + ' يوم' });
        if (days <= 3) summary.critical.push({ barcode: b, name, loc: dest.ar, days });
        if (days >= cfg.maxCover) summary.overstock.push({ barcode: b, name, loc: dest.ar, days });
      }
      return { dest, dv, daily, baseNeed, bypassStack, raisedSales, score: baseNeed + (daily * 10) + prio };
    }).sort((a, b) => b.score - a.score);

    // السحب الاستثنائي - وضع "سحب كامل وتقسيم على الوجهات": يسحب فائض كل مصدر بالكامل
    // دفعة واحدة ويقسمه بالتساوي على الوجهات المؤهلة (والباقي لأعلى الوجهات)، بدون أقل
    // تحويل عام ولا كمية بلا مبيعات ولا منع تكدس ولا قيود عرض - فقط "أقل كمية للتحويل
    // في السحب الكامل" كحد أدنى لكل وجهة.
    if (isExceptional && String(cfg.exceptionMode || '').indexOf('سحب كامل') >= 0) {
      const sources = selectedSources.map(s => {
        const sv = readers.vals(b, s.id), isWh = s.type === 'wh';
        const av = available(sv, isWh, cfg, true, s.id, readers);
        const obj = { s, sv, baseAv: av, av, isWh };
        obj.score = sourceScore(obj, cfg, readers);
        return obj;
      }).filter(x => x.av > 0).sort((a, b) => b.score - a.score);
      const minUnit = Math.max(0, num(cfg.exceptionSplitMin));
      sources.forEach(so => {
        let left = safeAvail(so);
        if (left <= 0) return;
        let eligible = dests.filter(d => d.dest.id !== so.s.id);
        let assigned = false;
        while (eligible.length) {
          const cnt = eligible.length;
          const base = Math.floor(left / cnt);
          if (base < minUnit && cnt > 1) { eligible = eligible.slice(0, cnt - 1); continue; }
          const remainder = left - base * cnt;
          eligible.forEach((d, i) => {
            const dest = d.dest, dv = d.dv, daily = d.daily;
            const unit = base + (i < remainder ? 1 : 0);
            if (unit <= 0) return;
            const pur = readers.purch(b), cat = readers.category(b), af = readers.isA(b) ? 'A' : '';
            const beforeDays = daily > 0 ? Math.floor(dv.stock / daily) : 9999;
            const risk = beforeDays <= 3 ? 'مرتفع' : beforeDays <= 7 ? 'متوسط' : 'منخفض';
            const afterDays = daily > 0 ? Math.floor((curDestStock(dv, dest.id) + unit) / daily) : 9999;
            const remainSrc = Math.max(0, so.sv.stock - usedOf(so.s.id) - unit);
            const reason = 'سحب كامل وتقسيم بالتساوي على ' + cnt + ' وجهة / نصيب هذه الوجهة: ' + unit + ' / درجة المصدر: ' + Math.round(so.score) + ' / المتبقي من المصدر بعد السحب: ' + remainSrc;
            const record = { runId: rid, barcode: b, name, priority: prio, category: cat, purchaseDate: pur.date, purchaseQty: pur.qty, rec10: dv.rec10, srcId: so.s.id, srcAr: so.s.ar, srcS90: so.sv.s90, srcS30: so.sv.s30, srcStock: so.sv.stock, srcRemain: remainSrc, destId: dest.id, destAr: dest.ar, destS90: dv.s90, destS30: dv.s30, destStock: dv.stock, destIncoming: dv.incoming, qty: unit, aClass: af, mode, need: so.av, coverTarget: cfg.cover, reason, beforeDays, afterDays, risk };
            (so.isWh ? wout : bout).push(record);
            history.push([rid, new Date().toISOString(), b, name, so.s.id, so.s.ar, dest.id, dest.ar, unit, mode, reason]);
            register(so.s.id, dest.id, unit);
            trans++; qtySum += unit; productCovered = true;
          });
          left = 0; assigned = true; break;
        }
        if (!assigned && left > 0) {
          reject(raise, rid, 'R007', b, name, prio, so.s.id, so.s.ar, 'متبقي في المصدر أقل من أقل كمية للتحويل حتى بعد التقسيم بالتساوي', 'سحب كامل', 'المتبقي في المصدر: ' + left + ' / أقل كمية للسحب الكامل: ' + minUnit, so.av, 0, left, mode);
        }
      });
      if (productCovered) covered++;
      if (onProgress && idx % monitorEvery === 0) {
        const done = idx + 1, elapsedMs = Date.now() - t0;
        const speed = elapsedMs > 0 ? Math.round(done / (elapsedMs / 1000)) : 0;
        onProgress({
          status: isBigData ? ('BIG DATA يعمل - المنتج ' + done + ' من ' + rows.length) : 'جاري التشغيل',
          progress: Math.round(done / rows.length * 100), products: rows.length, done, speed,
          transfers: trans, qty: qtySum, rejected: raise.length, critical: summary.critical.length,
          coveredPct: Math.round((covered / rows.length) * 100) + '%', elapsed: fmtTime(elapsedMs)
        });
      }
      return;
    }

    dests.forEach(d => {
      const dest = d.dest, dv = d.dv, daily = d.daily;
      if (!isExceptional && rest && rest.indexOf(dest.id) < 0) {
        reject(raise, rid, 'R002', b, name, prio, dest.id, dest.ar, 'الصنف لا ينعرض في هذه الوجهة', 'قيود العرض', 'مسموح فقط: ' + rest.map(x => locations.locById(cfg.locConfig || {}, x).ar).join('، '), 0, 0, 0, mode);
        return;
      }
      let need = d.baseNeed;
      const blDest = cfg.branchLimits[dest.id];
      if (!isExceptional && !manual && !isBranchLimitMode && !d.raisedSales && daily <= 0) {
        const hasBranchLimit = blDest && (blDest.min !== undefined || blDest.max !== undefined);
        if (!hasBranchLimit) {
          if (cfg.noSales <= 0) {
            reject(raise, rid, 'R008', b, name, prio, dest.id, dest.ar, ZERO_SALES_REJECT_REASON, 'مبيعات صفر', 'كمية بلا مبيعات في الإعدادات = ' + cfg.noSales, 0, dv.incoming, 0, mode);
            return;
          } else {
            const limit = num(cfg.zeroSalesStockLimit), blocked = limit <= 0 ? dv.stock > 0 : dv.stock >= limit;
            if (blocked) {
              reject(raise, rid, 'R012', b, name, prio, dest.id, dest.ar, 'تم رفض التوزيع: مبيعات الوجهة صفرية ويوجد مخزون يعتبر تكديس', 'مبيعات صفرية مع مخزون', 'مخزون الوجهة: ' + dv.stock + ' / حد المخزون: ' + limit, cfg.noSales, dv.incoming, 0, mode);
              return;
            }
          }
        }
        // لو فيه حد فرع محدد (أدنى أو أعلى)، نتجاوز قاعدة رفض "مبيعات صفرية" الافتراضية،
        // ونعتمد على الاحتياج (need) المحسوب مسبقًا واللي أصلًا يطبّق الحد الأدنى كأرضية دنيا.
      }
      need = Math.max(0, num(need));
      const sp = readers.spec(b, dest.id);
      if (sp > 0) need = Math.min(need, Math.max(0, sp - dv.stock - dv.incoming));
      if (need <= 0) {
        reject(raise, rid, 'R009', b, name, prio, dest.id, dest.ar, 'لا يوجد احتياج محسوب بعد تطبيق الفلاتر', 'احتياج صفر', 'مخزون الوجهة: ' + dv.stock + ' / في التحويل: ' + dv.incoming + (sp > 0 ? (' / سقف التصنيع الخاص: ' + sp) : ''), need, dv.incoming, 0, mode);
        return;
      }
      if (dv.incoming >= need && !manual) {
        reject(raise, rid, 'R004', b, name, prio, dest.id, dest.ar, 'في التحويل يغطي الاحتياج', 'مغطى بالتحويل', 'لا يحتاج زيادة حتى لا يتكدس', need, dv.incoming, 0, mode);
        return;
      }
      const sources = selectedSources.filter(s => s.id !== dest.id).map(s => {
        const sv = readers.vals(b, s.id), isWh = s.type === 'wh';
        const av = available(sv, isWh, cfg, isExceptional, s.id, readers);
        const obj = { s, sv, baseAv: av, av: Math.max(0, av - usedOf(s.id)), isWh };
        obj.score = sourceScore(obj, cfg, readers);
        return obj;
      }).filter(x => x.av > 0).sort((a, b) => b.score - a.score);

      let rem = need;
      const beforeDays = daily > 0 ? Math.floor(dv.stock / daily) : 9999;
      for (const so of sources) {
        if (rem <= 0) break;
        so.av = safeAvail(so);
        if (so.av <= 0) continue;
        let q = Math.min(rem, so.av);
        let capKeepQty = Infinity;
        if (!isExceptional && cfg.keepQty > 0) {
          capKeepQty = Math.max(0, so.sv.stock - usedOf(so.s.id) - cfg.keepQty);
          q = Math.min(q, capKeepQty);
        }
        const dstStockNow = curDestStock(dv, dest.id);
        let capMaxCover = Infinity;
        if (!isExceptional && !d.bypassStack && daily > 0 && (dstStockNow + q) / daily > cfg.maxCover) {
          const qMax = Math.max(0, Math.floor(daily * cfg.maxCover - dstStockNow));
          if (qMax < cfg.minTr) { reject(raise, rid, 'R006', b, name, prio, dest.id, dest.ar, 'سيصبح الفرع مكدس', 'منع التكدس', 'التغطية ستتجاوز ' + cfg.maxCover + ' يوم', need, dv.incoming, rem, mode); break; }
          capMaxCover = qMax; q = Math.min(q, qMax);
        }
        if (q <= 0) { reject(raise, rid, 'R010', b, name, prio, dest.id, dest.ar, 'كمية التحويل المحسوبة = 0', 'تحويل صفر', 'الاحتياج: ' + need + ' / المتبقي: ' + rem, need, dv.incoming, rem, mode); continue; }
        const minTrEff = isExceptional ? num(cfg.exceptionSplitMin) : num(cfg.minTr);
        // "أقل تحويل" (minTr) مصمم أصلًا لمنع تحويلات صغيرة/مهدرة بالتوزيع العادي المعتمد على
        // المبيعات - لكن لو الفرع له حد خاص محدد (حدود الفروع الخاصة)، فالكمية المحسوبة أصلًا
        // *دقيقة ومقصودة* (بالضبط الفرق بين المخزون الحالي والحد المطلوب)، فرضها لأعلى (رفع)
        // أو رفضها بسبب "أقل تحويل" يُفسد الدقة المطلوبة تمامًا (يوصّل الفرع لأكثر أو أقل من
        // حده الفعلي). لذلك: الفروع اللي عندها حد خاص تتجاوز فحص "أقل تحويل" كليًا، وتُنفَّذ
        // بالضبط بالكمية المحسوبة مهما كانت صغيرة. الفروع بدون حد خاص تبقى بنفس السلوك القديم.
        const hasLimit = !isExceptional && blDest && blDest.min !== undefined;
        if (!hasLimit && minTrEff > 0 && q < minTrEff) {
          if (!isExceptional && cfg.raiseSmallNeed > 0) {
            const raiseCeil = Math.min(so.av, capKeepQty, capMaxCover);
            const raised = Math.min(cfg.raiseSmallNeed, raiseCeil);
            if (raised <= 0) { reject(raise, rid, 'R011', b, name, prio, dest.id, dest.ar, 'أقل من أقل تحويل ولا توجد كمية كافية حتى بعد الرفع', 'أقل من الحد الأدنى', 'الكمية: ' + q + ' / أقل تحويل: ' + minTrEff, need, dv.incoming, rem, mode); continue; }
            q = raised;
          } else {
            reject(raise, rid, 'R011', b, name, prio, dest.id, dest.ar, 'أقل من أقل تحويل', 'أقل من الحد الأدنى', 'الكمية: ' + q + ' / أقل تحويل: ' + minTrEff, need, dv.incoming, rem, mode); continue;
          }
        }
        const pur = readers.purch(b), cat = readers.category(b), af = readers.isA(b) ? 'A' : '', risk = beforeDays <= 3 ? 'مرتفع' : beforeDays <= 7 ? 'متوسط' : 'منخفض';
        const afterDays = daily > 0 ? Math.floor((curDestStock(dv, dest.id) + q) / daily) : 9999;
        const remainSrc = Math.max(0, so.sv.stock - usedOf(so.s.id) - q);
        const reason = (so.isWh ? 'مستودع مختار - أولوية المستودعات' : 'أفضل مصدر حسب الفائض والمبيعات') + ' / فائض: ' + so.av + ' / درجة المصدر: ' + Math.round(so.score);
        const record = { runId: rid, barcode: b, name, priority: prio, category: cat, purchaseDate: pur.date, purchaseQty: pur.qty, rec10: dv.rec10, srcId: so.s.id, srcAr: so.s.ar, srcS90: so.sv.s90, srcS30: so.sv.s30, srcStock: so.sv.stock, srcRemain: remainSrc, destId: dest.id, destAr: dest.ar, destS90: dv.s90, destS30: dv.s30, destStock: dv.stock, destIncoming: dv.incoming, qty: q, aClass: af, mode, need, coverTarget: cfg.cover, reason, beforeDays, afterDays, risk, specCap: sp };
        (so.isWh ? wout : bout).push(record);
        history.push([rid, new Date().toISOString(), b, name, so.s.id, so.s.ar, dest.id, dest.ar, q, mode, reason]);
        register(so.s.id, dest.id, q);
        rem -= q; trans++; qtySum += q; productCovered = true;
      }
      if (rem > 0) reject(raise, rid, 'R001', b, name, prio, dest.id, dest.ar, 'كمية غير مغطاة', 'غير مغطى', 'المتبقي: ' + rem, need, dv.incoming, rem, mode);
    });

    if (productCovered) covered++;
    if (onProgress && idx % monitorEvery === 0) {
      const done = idx + 1, elapsedMs = Date.now() - t0;
      const speed = elapsedMs > 0 ? Math.round(done / (elapsedMs / 1000)) : 0;
      onProgress({
        status: isBigData ? ('BIG DATA يعمل - المنتج ' + done + ' من ' + rows.length) : 'جاري التشغيل',
        progress: Math.round(done / rows.length * 100), products: rows.length, done, speed,
        transfers: trans, qty: qtySum, rejected: raise.length, critical: summary.critical.length,
        coveredPct: Math.round((covered / rows.length) * 100) + '%', elapsed: fmtTime(elapsedMs)
      });
    }
  });

  // فلتر أمان نهائي: يمنع أي تحويل كميته صفر أو أقل من الحد الأدنى - إلا لو الوجهة عندها حد
  // خاص محدد (حدود الفروع الخاصة)، فهذي الكمية دقيقة ومقصودة ولازم تمر كما هي بدون رفض.
  function finalFilter(list) {
    return list.filter(r => {
      const isExc = (r.mode === 'السحب الكامل الاستثنائي' || r.mode === 'exceptional');
      const minTr = isExc ? num(cfg.exceptionSplitMin) : num(cfg.minTr);
      const blR = cfg.branchLimits && cfg.branchLimits[r.destId];
      const hasLimitR = !isExc && blR && blR.min !== undefined;
      if (r.qty <= 0) { reject(raise, rid, 'R010', r.barcode, r.name, r.priority, r.destId, r.destAr, 'كمية التحويل = 0', 'تحويل صفر', '', r.need, 0, 0, r.mode); return false; }
      if (!hasLimitR && minTr > 0 && r.qty < minTr) { reject(raise, rid, 'R011', r.barcode, r.name, r.priority, r.destId, r.destAr, 'أقل من أقل تحويل', 'أقل من الحد الأدنى', '', r.need, 0, r.qty, r.mode); return false; }
      return true;
    });
  }
  const boutF = finalFilter(bout), woutF = finalFilter(wout);
  const finalTrans = boutF.length + woutF.length;
  const finalQty = boutF.reduce((a, r) => a + r.qty, 0) + woutF.reduce((a, r) => a + r.qty, 0);
  summary.transfers = finalTrans; summary.qty = finalQty; summary.rejected = raise.length;
  summary.coveredPct = Math.round((covered / Math.max(1, rows.length)) * 100) + '%';

  if (onProgress) onProgress({ status: isBigData ? 'BIG DATA اكتمل' : 'جاهز', progress: 100, products: rows.length, done: rows.length, transfers: finalTrans, qty: finalQty, rejected: raise.length, critical: summary.critical.length, coveredPct: summary.coveredPct, elapsed: fmtTime(Date.now() - t0) });

  return {
    runId: rid, branchRows: boutF, warehouseRows: woutF, raiseRows: raise, history, summary,
    elapsed: fmtTime(Date.now() - t0),
    message: 'تم التنفيذ: ' + finalTrans + ' تحويل بكمية إجمالية ' + finalQty + (raise.length ? (' / ' + raise.length + ' صنف بحاجة لمراجعة') : '')
  };
}

/**
 * يحسب "الاحتياج الحقيقي" لوجهة معينة بنفس المنطق المستخدم بالضبط في تشغيل BIG DATA/Turbo
 * (بما فيها قاعدة المبيعات الصفرية وحدود الفروع الخاصة وسقف التصنيع الخاص) دون تنفيذ أي
 * تحويل فعلي. تُستخدم في تقارير النواقص حتى يكون الاحتياج المحسوب متطابقًا تمامًا مع ما كان
 * سيحسبه BIG DATA لنفس المنتج والوجهة، بنفس الإعدادات السريعة المستخدمة بالتشغيل العادي.
 * يرجع {need, blocked, reason}. blocked=true تعني BIG DATA لن يعتبر هذا احتياجًا فعليًا.
 */
function computeBigDataNeed(cfg, readers, b, dest, dv, daily) {
  const bl = cfg.branchLimits[dest.id];
  let need, raisedSales = false;
  if (daily > 0) {
    need = Math.max(0, Math.ceil(daily * cfg.cover - dv.stock - dv.incoming));
  } else if (num(cfg.salesRaise) > 0) {
    const effDaily = num(cfg.salesRaise) / 30;
    need = Math.max(0, Math.ceil(effDaily * cfg.cover - dv.stock - dv.incoming));
    raisedSales = true;
  } else {
    need = 0;
  }
  if (!raisedSales && daily <= 0) {
    // العطل هنا: كنا نتحقق فقط من bl.max (الحد الأعلى) لمعرفة "هل عند هذا الفرع حد خاص؟"،
    // بينما طريقة الاستخدام المعتادة هي تحديد "الحد الأدنى" فقط (bl.min) بدون حد أعلى - فكان
    // أي فرع بدون مبيعات (daily=0) ومحدد له حد أدنى فقط (بدون حد أعلى) يُعامَل وكأنه ما عنده
    // أي حد خاص أصلًا، ويدخل قاعدة "مبيعات صفرية" العادية ويُحظر بالكامل - متجاهلًا حده الأدنى.
    if (bl && (bl.min !== undefined || bl.max !== undefined)) {
      if (need > 0 && bl.min !== undefined && need < bl.min) {
        return { need: 0, blocked: true, reason: 'الاحتياج المحسوب أقل من الحد الأدنى الخاص لهذا الفرع (حدود الفروع الخاصة)' };
      }
    } else if (num(cfg.noSales) <= 0) {
      return { need: 0, blocked: true, reason: 'مبيعات الوجهة صفرية، و"كمية بلا مبيعات" بالإعدادات السريعة = 0' };
    } else {
      const limit = num(cfg.zeroSalesStockLimit), blockedByStock = limit <= 0 ? dv.stock > 0 : dv.stock >= limit;
      if (blockedByStock) return { need: 0, blocked: true, reason: 'مبيعات الوجهة صفرية ومخزونها (' + dv.stock + ') عند حد اعتبار التكديس (' + limit + ') أو أعلى منه' };
    }
  }
  need = Math.max(0, num(need));
  const sp = readers.spec(b, dest.id);
  if (sp > 0) need = Math.min(need, Math.max(0, sp - dv.stock - dv.incoming));
  if (need <= 0) return { need: 0, blocked: true, reason: 'لا يوجد احتياج محسوب حسب المبيعات والمخزون الحاليين' };
  return { need, blocked: false, reason: '' };
}

/**
 * الاحتياج/النقص لوجهة معينة: نفس احتياج BIG DATA بالضبط، مع إضافة خيار "حد اعتبار
 * الفرع ناقص" كطبقة إضافية تكتشف حتى المنتجات التي يرفضها BIG DATA بسبب قاعدة المبيعات
 * الصفرية (مثل المنتجات الجديدة التي مبيعاتها صفر لكن مخزونها منخفض جدًا أو صفر).
 * يرجع {qty, isShortage, why}. qty=0 و isShortage=false يعني ليس نقصًا لهذا المنتج بهذه الوجهة.
 */
function shortageNeed(dv, readers, opt, cfg, b, dest, daily) {
  const bd = computeBigDataNeed(cfg, readers, b, dest, dv, daily);
  const stockFlag = num(opt.shortageStockThreshold) > 0 && dv.stock <= num(opt.shortageStockThreshold);
  // الحد الأدنى الخاص بالفرع (لو محدد بحدود الفروع الخاصة) يُضاف الآن كطبقة كشف نقص إضافية
  // بتقارير النواقص أيضًا - إضافة بحتة، ما تُغيّر منطق BIG DATA المشترك (computeBigDataNeed)
  // ولا تُنقص أي كشف نقص موجود أصلًا، فقط تضيف/ترفع الكمية لو الفرع تحت حده الأدنى المحدد.
  const bl = cfg.branchLimits && cfg.branchLimits[dest.id];
  const minFloorQty = (bl && bl.min !== undefined) ? Math.max(0, bl.min - dv.stock - dv.incoming) : 0;
  if (!bd.blocked && bd.need > 0) {
    let qty = bd.need, why = 'احتياج محسوب بنفس منطق BIG DATA (المبيعات، تغطية ' + cfg.cover + ' يوم، وحدود الفروع الخاصة)';
    if (stockFlag) { qty = Math.max(qty, num(opt.shortageStockThreshold) - dv.stock); why += ' + مخزون الوجهة عند حد اعتبار النقص'; }
    if (minFloorQty > qty) { qty = minFloorQty; why += ' + الحد الأدنى الخاص لهذا الفرع'; }
    return { qty, isShortage: true, why };
  }
  if (stockFlag || minFloorQty > 0) {
    let qty = stockFlag ? Math.max(0, num(opt.shortageStockThreshold) - dv.stock) : 0;
    let why = stockFlag ? ('مخزون الوجهة (' + dv.stock + ') عند حد اعتبار النقص (' + opt.shortageStockThreshold + ') أو أقل منه، رغم أن BIG DATA لن يحوّل له بسبب: ' + bd.reason) : '';
    if (minFloorQty > qty) { qty = minFloorQty; why = (why ? why + ' + ' : '') + 'الحد الأدنى الخاص لهذا الفرع (' + bl.min + ')'; }
    return { qty, isShortage: true, why };
  }
  return { qty: 0, isShortage: false, why: '' };
}

/**
 * تقرير نواقص الفروع من المستودعات: قراءة وحساب فقط، لا ينفذ أي تحويل فعلي.
 * لكل منتج/وجهة فيها نقص، يقترح كل مستودع مصدر فيه فائض فوق حده (صف مستقل لكل مصدر - لا يخصم
 * من نفس الفائض بين الوجهات المختلفة، لأنها اقتراحات مستقلة وليست تنفيذًا فعليًا).
 * يرجع {ok, message, sheets:{sheetName:[rows]}, raiseRows}.
 */
function shortageFromWarehouses(cfg, ctx, opt) {
  const readers = makeReaders(ctx);
  const products = ctx.barcodes.filter(b => b);
  if (!products.length) throw new Error('لا توجد أي منتجات في بيانات المخزون أو المبيعات');
  const locCfg = cfg.locConfig || {};
  const whSet = {}; locations.warehousesOf(locCfg).forEach(w => whSet[w.id] = 1);
  const selectedSources = (cfg.selectedSources || []).map(id => locations.locById(locCfg, id)).filter(x => whSet[x.id]);
  const selectedDests = (cfg.selectedDests || []).map(id => locations.locById(locCfg, id));
  if (!selectedSources.length) throw new Error('لم يتم تحديد أي مستودع كمصدر (هذا التقرير يعمل على المستودعات فقط)');
  if (!selectedDests.length) throw new Error('لم يتم تحديد أي وجهة');

  const rid = 'SHORTAGE-WH-' + runId();
  const bySheet = {}, noSupplyRaise = [];
  const toArr = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
  const fMain = toArr(opt.filterMainCategory), fSub = toArr(opt.filterSubCategory), fBrand = toArr(opt.filterBrand);
  products.forEach(b => {
    const p = ctx.products[b] || {};
    if (fMain.length && !fMain.includes(p.mainCategory || '')) return;
    if (fSub.length && !fSub.includes(p.subCategory || '')) return;
    if (fBrand.length && !fBrand.includes(p.brand || '')) return;
    const name = p.name || '';
    const cat = readers.category(b);
    const rest = readers.restricted(b);
    const srcAvail = selectedSources.map(so => {
      const sv = readers.vals(b, so.id);
      const thr = whThreshold(cfg, so.id);
      const avail = Math.max(0, sv.stock > thr ? (sv.stock - sv.moved) : 0);
      return { so, sv, avail, thr };
    });
    selectedDests.forEach(dest => {
      const dv = readers.vals(b, dest.id), daily = readers.daily(dv);
      const sh = shortageNeed(dv, readers, opt, cfg, b, dest, daily);
      if (!sh.isShortage) return;
      if (rest && rest.indexOf(dest.id) < 0) {
        reject(noSupplyRaise, rid, 'RSH3', b, name, 0, dest.id, dest.ar, 'يوجد نقص لكن الصنف مقيد بقيود العرض ولا ينعرض في هذه الوجهة', 'مقيد بقيود العرض', 'مسموح فقط بالعرض في: ' + rest.map(x => locations.locById(locCfg, x).ar).join('، '), sh.qty, dv.incoming, sh.qty, 'نواقص من المستودعات');
        return;
      }
      let anyPlaced = false, anyBelowMinTr = false;
      srcAvail.forEach(x => {
        if (x.avail <= 0) return;
        let suggestQty = Math.min(sh.qty, x.avail);
        const minTr = num(cfg.minTr);
        if (minTr > 0 && suggestQty < minTr) {
          if (x.avail >= minTr) suggestQty = minTr; else { anyBelowMinTr = true; return; }
        }
        anyPlaced = true;
        const sheetName = ('نواقص من ' + x.so.ar).substring(0, 31);
        if (!bySheet[sheetName]) bySheet[sheetName] = [];
        bySheet[sheetName].push({ barcode: b, name, category: cat, srcAr: x.so.ar, destId: dest.id, destAr: dest.ar, destS90: dv.s90, destS30: dv.s30, destStock: dv.stock, destIncoming: dv.incoming, need: sh.qty, cover: cfg.cover, srcStock: x.sv.stock, srcAvail: x.avail, qty: suggestQty, why: sh.why });
      });
      if (!anyPlaced) {
        const reason = anyBelowMinTr ? 'يوجد نقص وفائض بالمستودعات لكنه أقل من أقل كمية تحويل محددة بالإعدادات السريعة' : 'يوجد نقص لكن لا توجد كمية فوق حد المستودع في أي مستودع مصدر محدد';
        reject(noSupplyRaise, rid, 'RSH1', b, name, 0, dest.id, dest.ar, reason, 'لا يوجد فائض كافٍ بالمستودعات', 'النقص المحسوب: ' + sh.qty + ' / حد المستودع: ' + cfg.whMin + ' / أقل كمية تحويل: ' + cfg.minTr, sh.qty, dv.incoming, sh.qty, 'نواقص من المستودعات');
      }
    });
  });

  const names = Object.keys(bySheet);
  let message;
  if (!names.length) {
    message = noSupplyRaise.length ? ('لا يوجد أي نقص يمكن تغطيته من المستودعات المحددة حاليًا؛ تم رصد ' + noSupplyRaise.length + ' صنف بحاجة لمراجعة.') : 'لا يوجد أي نقص حسب الإعدادات الحالية. جرب تقليل حد اعتبار النقص أو زيادة تغطية الأيام.';
  } else {
    const sum = names.map(nm => nm + ' (' + bySheet[nm].length + ' تحويل)');
    message = 'تم إنشاء تقرير نواقص الفروع من المستودعات على ' + names.length + ' صفحة: ' + sum.join('، ') + (noSupplyRaise.length ? (' / تم رصد ' + noSupplyRaise.length + ' صنف بدون فائض متاح') : '');
  }
  return { ok: true, message, sheets: bySheet, raiseRows: noSupplyRaise };
}

/**
 * تقرير نواقص الفروع من الفروع: لكل نقص، يختار أفضل فرع مصدر واحد (الأعلى فائضًا) ويخصم
 * الكمية المقترحة من فائضه المتاح داخل هذا التقرير حتى لا يُقترح نفس الفائض مرتين لنفس المصدر.
 * يرجع {ok, message, rows, raiseRows}.
 */
function shortageBranchToBranch(cfg, ctx, opt) {
  const readers = makeReaders(ctx);
  const products = ctx.barcodes.filter(b => b);
  if (!products.length) throw new Error('لا توجد أي منتجات في بيانات المخزون أو المبيعات');
  const locCfg = cfg.locConfig || {};
  const brSet = {}; locations.branchesOf(locCfg).forEach(w => brSet[w.id] = 1);
  const selectedSources = (cfg.selectedSources || []).map(id => locations.locById(locCfg, id)).filter(x => brSet[x.id]);
  const selectedDests = (cfg.selectedDests || []).map(id => locations.locById(locCfg, id));
  if (!selectedSources.length) throw new Error('لم يتم تحديد أي فرع كمصدر (هذا التقرير يعمل على الفروع فقط)');
  if (!selectedDests.length) throw new Error('لم يتم تحديد أي وجهة');

  const rid = 'SHORTAGE-BR-' + runId();
  const out = [], noSourceRaise = [];
  const toArr2 = v => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
  const fMain = toArr2(opt.filterMainCategory), fSub = toArr2(opt.filterSubCategory), fBrand = toArr2(opt.filterBrand);
  products.forEach(b => {
    const p = ctx.products[b] || {};
    if (fMain.length && !fMain.includes(p.mainCategory || '')) return;
    if (fSub.length && !fSub.includes(p.subCategory || '')) return;
    if (fBrand.length && !fBrand.includes(p.brand || '')) return;
    const name = p.name || '';
    const rest = readers.restricted(b);
    const srcVals = selectedSources.map(so => ({ so, sv: readers.vals(b, so.id) }));
    const usedSrc = {};
    selectedDests.forEach(dest => {
      const dv = readers.vals(b, dest.id), daily = readers.daily(dv);
      const sh = shortageNeed(dv, readers, opt, cfg, b, dest, daily);
      if (!sh.isShortage) return;
      if (rest && rest.indexOf(dest.id) < 0) {
        reject(noSourceRaise, rid, 'RSH3', b, name, 0, dest.id, dest.ar, 'يوجد نقص لكن الصنف مقيد بقيود العرض ولا ينعرض في هذه الوجهة', 'مقيد بقيود العرض', 'مسموح فقط بالعرض في: ' + rest.map(x => locations.locById(locCfg, x).ar).join('، '), sh.qty, dv.incoming, sh.qty, 'نواقص من الفروع');
        return;
      }
      let best = null, bestSv = null, bestAvail = 0;
      srcVals.forEach(x => {
        if (x.so.id === dest.id) return;
        const av = available(x.sv, false, cfg, false, x.so.id, readers) - num(usedSrc[x.so.id]);
        if (av > bestAvail) { bestAvail = av; best = x.so; bestSv = x.sv; }
      });
      let suggestQty = best ? Math.min(sh.qty, bestAvail) : 0;
      const minTr = num(cfg.minTr);
      let belowMinTr = false;
      if (best && suggestQty > 0 && minTr > 0 && suggestQty < minTr) {
        if (bestAvail >= minTr) suggestQty = minTr; else belowMinTr = true;
      }
      if (best && suggestQty > 0 && !belowMinTr) {
        usedSrc[best.id] = num(usedSrc[best.id]) + suggestQty;
        const remainSrc = Math.max(0, bestSv.stock - usedSrc[best.id]);
        out.push({ barcode: b, name, srcId: best.id, srcAr: best.ar, srcS90: bestSv.s90, srcS30: bestSv.s30, srcStock: bestSv.stock, srcRemain: remainSrc, destId: dest.id, destAr: dest.ar, destS90: dv.s90, destS30: dv.s30, destStock: dv.stock, destIncoming: dv.incoming, need: sh.qty, cover: cfg.cover, qty: suggestQty, why: sh.why });
      } else {
        const reason = belowMinTr ? 'يوجد نقص وفائض من الفروع لكنه أقل من أقل كمية تحويل محددة بالإعدادات السريعة' : 'يوجد نقص لكن لا يوجد فائض كافٍ من الفروع المصدر المحددة';
        reject(noSourceRaise, rid, 'RSH2', b, name, 0, dest.id, dest.ar, reason, 'لا يوجد فائض كافٍ من الفروع المحددة', 'النقص المحسوب: ' + sh.qty + ' / أقل كمية تحويل: ' + cfg.minTr, sh.qty, dv.incoming, sh.qty, 'نواقص من الفروع');
      }
    });
  });

  let message;
  if (!out.length) {
    message = noSourceRaise.length ? ('لا يوجد أي نقص يمكن تغطيته من الفروع المحددة حاليًا؛ تم رصد ' + noSourceRaise.length + ' صنف بحاجة لمراجعة.') : 'لا يوجد أي نقص حسب الإعدادات الحالية. جرب تقليل حد اعتبار النقص أو زيادة تغطية الأيام.';
  } else {
    message = 'تم إنشاء تقرير نواقص الفروع من الفروع بعدد ' + out.length + ' تحويل' + (noSourceRaise.length ? (' / تم رصد ' + noSourceRaise.length + ' صنف بدون فائض متاح') : '');
  }
  return { ok: true, message, rows: out, raiseRows: noSourceRaise };
}

const __exports = { runDistribution, priority, makeReaders, fmtTime, runId, shortageFromWarehouses, shortageBranchToBranch, shortageNeed };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
else if (typeof window !== 'undefined') window.EngineModule = __exports;

})();
