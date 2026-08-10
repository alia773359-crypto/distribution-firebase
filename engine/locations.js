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
  ['narjis', 'النرجس', ['النرجس', 'الرنجس', 'نرجس']]
];

const WAREHOUSES = [
  ['dabab_wh', 'مستودع الضباب', ['مستودع الضباب', 'الضباب']],
  ['cups_wh', 'مستودع الأكواب', ['مستودع الأكواب', 'اكواب', 'الأكواب']],
  ['fursan_main_wh', 'مستودع الفرسان 2 الرئيسي', ['الرئيسي 2', 'رئيسي فرسان', 'مستودع الرئيسي2 الفرسان']],
  ['wh_main_khaldiyah', 'مستودع الخالدية', ['الرئيسي', 'مستودع الخالدية', 'الخالدية']],
  ['wh_beauty', 'مستودع التجميل', ['مستودع التجميل', 'التجميل']]
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
  for (const loc of all) {
    const cands = [loc.id, loc.ar].concat(loc.aliases || []).map(norm);
    if (cands.some(c => c && (n.includes(c) || c.includes(n)))) return loc;
  }
  return null;
}

const __exports = { BRANCHES, WAREHOUSES, norm, allLocations, branchesOf, warehousesOf, locById, locByText };
if (typeof module !== 'undefined' && module.exports) module.exports = __exports;
else if (typeof window !== 'undefined') window.LocationsModule = __exports;

})();
