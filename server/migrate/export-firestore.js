// ============================================================================
// Migration step 1 — export all Firestore data to local JSON.
// Run locally with the Firebase Admin service-account key:
//   node server/migrate/export-firestore.js <path-to-service-account.json>
// Output: server/migrate/export/<collection>.json  and  _settings.json
// (Firestore Auth passwords cannot be exported — logins are recreated fresh.)
// ============================================================================

const fs = require('fs');
const path = require('path');

const keyPath = process.argv[2];
if (!keyPath || !fs.existsSync(keyPath)) {
  console.error('Usage: node export-firestore.js <path-to-service-account.json>');
  process.exit(1);
}

let admin;
try { admin = require('firebase-admin'); }
catch { console.error('firebase-admin not installed. Run: npm i firebase-admin'); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(keyPath))) });
const db = admin.firestore();

const COLLECTIONS = [
  'leads', 'customers', 'installations', 'team', 'materials', 'ongoingWork',
  'income', 'expenses', 'reminders', 'gallery', 'purchaseOrders', 'retailers',
  'influencers', 'employeeTasks', 'leadPOs', 'expenditures', 'bomTemplates',
  'activityLog', 'notifications', 'users',
];

const OUT = path.join(__dirname, 'export');
fs.mkdirSync(OUT, { recursive: true });

// Convert Firestore Timestamps to ISO strings recursively.
function normalize(v) {
  if (v == null) return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, val] of Object.entries(v)) o[k] = normalize(val);
    return o;
  }
  return v;
}

(async () => {
  let grand = 0;
  for (const col of COLLECTIONS) {
    const snap = await db.collection(col).get();
    const docs = snap.docs.map(d => ({ id: d.id, ...normalize(d.data()) }));
    fs.writeFileSync(path.join(OUT, col + '.json'), JSON.stringify(docs, null, 2));
    console.log(`${col}: ${docs.length}`);
    grand += docs.length;
  }
  // Single app-wide settings document (company/settings)
  try {
    const s = await db.doc('company/settings').get();
    fs.writeFileSync(path.join(OUT, '_settings.json'), JSON.stringify(s.exists ? s.data() : {}, null, 2));
    console.log('company/settings: ' + (s.exists ? 'exported' : 'empty'));
  } catch (e) { console.log('settings export skipped: ' + e.message); }

  console.log(`\nDone. ${grand} documents → ${OUT}`);
  process.exit(0);
})().catch(e => { console.error('EXPORT_ERROR:', e.message); process.exit(1); });
