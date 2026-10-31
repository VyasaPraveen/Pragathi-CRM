// ============================================================================
// The order materials appear in on a Bill of Materials.
//
// The company's printed BOM sheet is a fixed list, S.No 1 to 25, and everyone
// reads it by position: the panels are line 1, the inverter line 2, the
// earthing block lines 5 to 9, and so on. Picking materials on screen in a
// different order used to carry that order straight through to the printed
// BOM, so two purchase orders for the same job could list the same materials
// in two different sequences and neither matched the sheet people check
// against.
//
// Sorting happens here, in one place, and is applied when materials are picked,
// when a PO is saved, and again when a BOM is drawn — so purchase orders
// already on file print in the right order too, without being rewritten.
//
// Keep this list in step with DEFAULT_BOM_MATERIALS in src/pages/Leads.js and
// with PO_BOM_ORDER in server/api/lib/po_pdf.php.
// ============================================================================

export const BOM_REFERENCE_ORDER = [
  'Solar PV Module',
  'Grid Tie Inverter',
  'Junction Box / ACDB',
  'Junction Box / DCDB',
  'Earthing Rods',
  'LA',
  'MC4 Connectors',
  'Earth Chemical Bags',
  'Earth Chambers',
  'DC Cable',
  'AC Cable',
  'Earthing Cable',
  'MMS -2/4 (PPS Standard)',
  'If Any Elevated MMS (Height)',
  'Additional AC Cable',
  'Additional DC Cable',
  'Additional Earth Cable',
  'UPVC Pipes & Fittings',
  'Civil Works',
  'Additional Relay',
  'DISCOM Charges',
  'Ladder (Height)',
  'MCS - Cleaning System',
  'Additional Load',
  'Any Misc / Others',
];

// "Junction Box / ACDB", "Junction Box/ACDB" and "junction box acdb" are the
// same line on the sheet, so spacing and punctuation are ignored.
const key = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const RANK = (() => {
  const m = new Map();
  BOM_REFERENCE_ORDER.forEach((name, i) => m.set(key(name), i));
  return m;
})();

// Where this material sits on the printed sheet, or null if it is not on it.
export function bomRank(materialName) {
  const r = RANK.get(key(materialName));
  return r === undefined ? null : r;
}

export const isReferenceMaterial = (materialName) => bomRank(materialName) !== null;

// Materials in the order the sheet lists them. Anything not on the sheet — a
// kW-specific inverter, or something an Admin added under Manage Options —
// keeps its own relative order and follows on after the twenty-five.
//
// The sort is stable in both directions: re-sorting an already-sorted list
// changes nothing, which matters because this runs on every pick.
export function sortBomItems(items, nameOf = (it) => (it && it.materialName)) {
  return (items || [])
    .map((item, i) => ({ item, i, rank: bomRank(nameOf(item)) }))
    .sort((a, b) => {
      if (a.rank === null && b.rank === null) return a.i - b.i;   // both extra
      if (a.rank === null) return 1;                               // extras last
      if (b.rank === null) return -1;
      return a.rank === b.rank ? a.i - b.i : a.rank - b.rank;
    })
    .map(x => x.item);
}

// The same, for the rows a quotation holds (they carry `material`, not
// `materialName`).
export const sortQuoteBomRows = (rows) => sortBomItems(rows, (r) => (r && r.material));
