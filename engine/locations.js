(function(){
'use strict';
/**
 * قائمة الفروع والمستودعات كما كانت في لوحة Google Sheets الأصلية.
 * odooLocationId: يُملأ بعد المزامنة بربط كل فرع/مستودع بموقعه أو مستودعه في Odoo (stock.warehouse / stock.location).
 * يمكن تعديل هذه القوائم لاحقًا من واجهة "ربط المواقع" دون الحاجة لتعديل الكود.
 */
const BRANCHES = [
  ['online', 'الاونلاين', ['الاونلاين', 'اونلاين', 'online']],
  ['shati', 'الشاطئ', ['الشاطئ', 'الشاطي', 'shati']],
  ['aziziyah', 'العزيزية', ['العزيزية']],
  ['fakhriyah', 'الفاخرية', ['الفاخرية']],
  ['jubail', 'الجبيل', ['الجبيل']],
  ['tarout', 'تاروت', ['تاروت']],
  ['hofuf', 'الهفوف', ['الهفوف', 'السلمانية']],
  ['hyper', 'الهايبر', ['الهايبر', 'هايبر', 'hyper']],
  ['mubarraz', 'المبرز', ['المبرز']],
  ['hafr', 'حفر الباطن', ['حفر الباطن', 'الحفر']],
  ['olaya', 'العليا', ['العليا']],
  ['shahabiyah', 'الشهابية', ['الشهابية', 'شهابية']],
  ['saihat', 'سيهات', ['سيهات']],
  ['khafji', 'الخفجي', ['الخفجي']],
  ['bustan', 'بستان', ['بستان', 'البستان']],
  ['fursan', 'الفرسان', ['الفرسان']],
  ['dahiyah', 'الضاحية', ['الضاحية']],
  ['muntazah', 'المنتزه', ['المنتزه']],
  ['narjis', 'النرجس', ['النرجس', 'الرنجس', 'نرجس']],
  // 4 فروع جديدة (تمت إضافتها). ملاحظة مهمة جدًا: "العزيزية الأمواج" و"الضاحية لبن" أسماؤهم
  // تشترك بكلمة مع فروع موجودة أصلًا (فرع "العزيزية" وفرع "الضاحية") - فتعمّدنا ما نحط الاسم
  // المشترك المجرد وحده ("العزيزية"/"الضاحية") كمرادف هنا، حتى ما يصير خلط تلقائي بينهم وبين
  // الفرعين الأصليين وقت قراءة ملفات الإكسل (نفس مبدأ حل تعارض النرجس/مستودع النرجس سابقًا).
  ['tuwaiq', 'الطويق', ['الطويق', 'طويق', 'الرياض طويق']],
  ['dahiyah_laban', 'الضاحية لبن', ['الضاحية لبن', 'ضاحية لبن', 'الرياض ضاحية لبن']],
  ['aziziyah_amwaj', 'العزيزية الأمواج', ['العزيزية الأمواج', 'عزيزية الامواج', 'الامواج']],
  ['faaliyah', 'الفعالية', ['الفعالية', 'فعالية']]
];

const WAREHOUSES = [
  ['cups_wh', 'مستودع الأكواب', ['مستودع الأكواب', 'اكواب', 'الأكواب']],
  ['fursan_main_wh', 'مستودع الفرسان 2 الرئيسي', ['الرئيسي 2', 'رئيسي فرسان', 'مستودع الرئيسي2 الفرسان']],
  ['wh_main_khaldiyah', 'مستودع الخالدية', ['الرئيسي', 'مستودع الخالدية', 'الخالدية']],
  ['wh_beauty', 'مستودع التجميل', ['مستودع التجميل', 'التجميل']],
  // 3 مستودعات جديدة (تمت إضافتها). ملاحظة مهمة: "مستودع الضاحية" و"مستودع النرجس" أسماؤهم
  // قريبة جدًا من فروع موجودة أصلًا بنفس الاسم تمامًا (فرع "الضاحية" وفرع "النرجس") - فتعمّدنا
  // ما نحط الاسم المجرد وحده ("الضاحية"/"النرجس") كمرادف هنا، حتى ما يصير خلط تلقائي بين الفرع
  // والمستودع وقت قراءة ملفات الإكسل (كل مرادف هنا يبدأ بكلمة "مستودع" أو له صيغة مختلفة واضحة).
  ['dahiyah_wh', 'مستودع الضاحية', ['مستودع الضاحية']],
  ['narjis_wh', 'مستودع النرجس', ['مستودع النرجس']],
  ['gee_wh', 'مستودع جي', ['مستودع جي', 'جي']]
];

function norm(v) {
  return String(v || '')
    .trim()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\s_\-\/\\]+/g, ' ')
    .toLowerCase();
}

function allLocations(cfg) {
  const list = (cfg.branches || BRANCHES).concat(cfg.warehouses || WAREHOUSES);
  return list.map(x => ({ id: x[0], ar: x[1], aliases: x[2], type: (cfg.warehouses || WAREHOUSES).includes(x) ? 'wh' : 'branch' }));
}

function branchesOf(cfg) {
  return (cfg.branches || BRANCHES).map(x => ({ id: x[0], ar: x[1], aliases: x[2], type: 'branch' }));
}

function warehousesOf(cfg) {
  return (cfg.warehouses || WAREHOUSES).map(x => ({ id: x[0], ar: x[1], aliases: x[2], type: 'wh' }));
}

function locById(cfg, id) {
  return allLocations(cfg).find(x => x.id === id) || { id, ar: id, aliases: [id], type: 'branch' };
}

function locByText(cfg, txt) {
  const n = norm(txt);
  if (!n) return null;
  const all = allLocations(cfg);
  for (const loc of all) {
    const cands = [loc.id, loc.ar].concat(loc.aliases || []).map(norm);
    if (cands.includes(n)) return loc;
  }
  // مطابقة تقريبية (احتواء نص بنص) - مهم: نختار أفضل تطابق (أطول مرادف مطابق) عبر *كل*
  // المواقع، وليس أول موقع نلقى له أي تطابق بترتيب القائمة. هذا يحل بالضبط حالات التعارض بين
  // فرع ومستودع يشتركون بجزء من الاسم (مثال حقيقي واجهناه: عمود "الرياض نرجس/فرع النرجس"
  // (الفرع) وعمود "الرياض نرجس/مستودع النرجس" (المستودع) - نفس النص "الرياض نرجس" يطابق مرادف
  // الفرع "النرجس" (تطابق قصير) *و* مرادف المستودع "مستودع النرجس" (تطابق أطول وأكثر تحديدًا) -
  // فالمرادف الأطول يفوز دائمًا، لأنه الأكثر دقة بالضرورة.
  let best = null, bestLen = 0;
  for (const loc of all) {
    const cands = [loc.id, loc.ar].concat(loc.aliases || []).map(norm);
    for (const c of cands) {
      if (c && (n.includes(c) || c.includes(n)) && c.length > bestLen) { bestLen = c.length; best = loc; }
    }
  }
  if (best) return best;
  // الطبقة الثالثة والأخيرة (تصحيح ذكي للأخطاء الإملائية): تجرَّب فقط لو ما لقينا أي تطابق
  // دقيق ولا احتواء نصي إطلاقًا بالخطوتين فوق - عشان أي عمود إكسل فيه غلطة كتابية بسيطة (حرف
  // ناقص، حرف زايد، حرف مبدّل، أو حتى فراغ/شرطة زيادة أو ناقصة) يتعرّف عليه البرنامج صح برضو،
  // بدل ما يرفضه كليًا. نحسب "مسافة التحرير" (Levenshtein) بين النص المُدخَل وكل مرادف معروف،
  // ونختار الأقرب (أقل عدد اختلافات) - بس فقط لو الفرق ضمن نسبة تسامح صغيرة ومعقولة حسب طول
  // النص، وبشرط طول لا يقل عن 3 أحرف (لحماية الأسماء القصيرة جدًا مثل "جي" من تطابقات عشوائية
  // خطيرة لا علاقة لها بالاسم الحقيقي - القيود الأقصر لازم تُكتب صح 100% أو تُرفض).
  function editDistance(a, b) {
    const m = a.length, n2 = b.length;
    if (!m) return n2; if (!n2) return m;
    const dp = new Array(n2 + 1);
    for (let j = 0; j <= n2; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0]; dp[0] = i;
      for (let j = 1; j <= n2; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n2];
  }
  if (n.length >= 3) {
    let bestDist = Infinity, bestFuzzy = null;
    for (const loc of all) {
      const cands = [loc.id, loc.ar].concat(loc.aliases || []).map(norm);
      for (const c of cands) {
        if (!c || c.length < 3) continue; // مرادفات قصيرة جدًا مستبعدة من التصحيح التلقائي أمانًا
        const dist = editDistance(n, c);
        const threshold = Math.max(1, Math.floor(Math.max(n.length, c.length) * 0.18)); // ~18% تسامح
        if (dist <= threshold && dist < bestDist) { bestDist = dist; bestFuzzy = loc; }
      }
    }
    if (bestFuzzy) return bestFuzzy;
  }
  return null;
}

const __exports = { BRANCHES, WAREHOUSES, norm, allLocations, branchesOf, warehousesOf, locById, locByText };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
else if (typeof window !== 'undefined') window.LocationsModule = __exports;

})();
