import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { hasAccess } from '../services/helpers';
import { db } from '../services/firebase';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';

const NEW_BOM_MATERIALS = [
  { materialName: 'Solar PV Module', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (1KW - 1 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (2KW - 1 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (3KW - 1 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (4KW - 1 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (5KW - 1 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (5KW - 3 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (6KW - 3 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (8KW - 3 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Grid Tie Inverter (10KW - 3 Ph)', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Others', unit: 'Nos', make: 'Tata / Others' },
  { materialName: 'Junction Box / ACDB', unit: 'Nos', make: '' },
  { materialName: 'Junction Box / DCDB', unit: 'Nos', make: '' },
  { materialName: 'Earthing Rods', unit: 'Nos', make: '' },
  { materialName: 'Earth Chemical Bags', unit: 'Nos', make: '' },
  { materialName: 'Earth Chambers', unit: 'Nos', make: '' },
  { materialName: 'MC4 Connectors', unit: 'Nos', make: '' },
  { materialName: 'DC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'AC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Earthing Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Module Mounting Structure (2-4) Default Structure', unit: 'Nos', make: 'HOD DIP/Other' },
  { materialName: 'If Any Elevated MMS (Mention Height)', unit: 'Nos', make: 'HOD DIP/Other' },
  { materialName: 'Additional AC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Additional DC Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'Additional Earth Cable', unit: 'Mtrs', make: 'Polycab/Others' },
  { materialName: 'UPVC Pipes & Fittings', unit: 'Mtrs', make: 'Finolex/Others' },
  { materialName: 'Civil Works', unit: 'Nos', make: 'Finolex/Others' },
  { materialName: 'Additional Relay', unit: 'Nos', make: '' },
  { materialName: 'DISCOM Charges', unit: 'Rs.', make: '' },
  { materialName: 'Ladder (Height)', unit: 'Nos', make: '' },
  { materialName: 'MCS - Cleaning System', unit: 'Nos', make: '' },
];

// Module permissions that admin can toggle per user
const PERMISSION_MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'leads', label: 'Leads', icon: 'leaderboard' },
  { key: 'customers', label: 'Customers', icon: 'people' },
  { key: 'installations', label: 'Installations', icon: 'solar_power' },
  { key: 'ongoing_work', label: 'Ongoing Work', icon: 'engineering' },
  { key: 'materials', label: 'Materials', icon: 'inventory_2' },
  { key: 'revenue', label: 'Revenue', icon: 'account_balance' },
  { key: 'purchase_orders', label: 'Purchase Orders', icon: 'receipt_long' },
  { key: 'retailers', label: 'Retailers', icon: 'storefront' },
  { key: 'influencers', label: 'Influencers', icon: 'record_voice_over' },
  { key: 'tasks', label: 'Tasks', icon: 'task_alt' },
  { key: 'team', label: 'Team', icon: 'groups' },
  { key: 'reminders', label: 'Reminders', icon: 'notifications_active' },
  { key: 'reports', label: 'Reports', icon: 'assessment' },
  { key: 'gallery', label: 'Gallery', icon: 'photo_library' },
];

export default function Settings() {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const isAdmin = hasAccess(role, 'admin');

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [perms, setPerms] = useState({});
  const [saving, setSaving] = useState(false);

  // Load all users for permission management (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    getDocs(collection(db, 'users')).then(snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.approved).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      setUsers(list);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isAdmin]);

  // When a user is selected, load their permissions
  const selectUser = (u) => {
    setSelectedUser(u);
    // Default: all permissions ON if no permissions object exists
    const existing = u.permissions || {};
    const p = {};
    PERMISSION_MODULES.forEach(m => {
      p[m.key] = existing[m.key] !== undefined ? existing[m.key] : true;
    });
    setPerms(p);
  };

  const togglePerm = (key) => {
    setPerms(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleAll = (val) => {
    const p = {};
    PERMISSION_MODULES.forEach(m => { p[m.key] = val; });
    setPerms(p);
  };

  const savePermissions = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', selectedUser.id), { permissions: perms });
      setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, permissions: perms } : u));
      setSelectedUser(prev => ({ ...prev, permissions: perms }));
      toast('Permissions saved');
    } catch (err) {
      toast('Failed to save: ' + err.message, 'er');
    }
    setSaving(false);
  };

  // Bulk apply: apply selected user's permissions to multiple users
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState([]);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState(null);

  /* Migrate all existing leadPOs: update items to new BOM template + PO number format */
  const migrateBOMData = async () => {
    if (!window.confirm('This will update ALL existing POs with:\n\n1. New BOM items (matching PPS template)\n2. New PO number format (PO-PPSPO-XXXX/date)\n\nExisting quantities, rates & amounts will be preserved where material names match.\n\nProceed?')) return;
    setMigrating(true);
    setMigrateResult(null);
    try {
      const snap = await getDocs(collection(db, 'leadPOs'));
      const allPOs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      let updated = 0;

      for (let idx = 0; idx < allPOs.length; idx++) {
        const po = allPOs[idx];
        const oldItems = po.items || [];
        const updates = {};

        // Migrate items: map old items into new template, preserving data where names match
        const newItems = NEW_BOM_MATERIALS.map(tpl => {
          const existing = oldItems.find(old =>
            (old.materialName || '').toLowerCase().trim() === tpl.materialName.toLowerCase().trim() ||
            (old.materialName || '').toLowerCase().includes(tpl.materialName.toLowerCase().split('(')[0].trim()) ||
            tpl.materialName.toLowerCase().includes((old.materialName || '').toLowerCase().split('(')[0].trim())
          );
          if (existing) {
            return {
              materialName: tpl.materialName,
              unit: tpl.unit || existing.unit || 'Nos',
              make: existing.make || tpl.make || '',
              specification: existing.specification || '',
              quantity: existing.quantity || 0,
              rate: existing.rate || 0,
              amount: existing.amount || 0,
              scopePragathi: existing.scopePragathi || false,
              scopeCustomer: existing.scopeCustomer || false,
            };
          }
          return {
            materialName: tpl.materialName,
            unit: tpl.unit,
            make: tpl.make,
            specification: '',
            quantity: 0,
            rate: 0,
            amount: 0,
            scopePragathi: false,
            scopeCustomer: false,
          };
        });

        // Also add any old items that don't match any new template item (preserve custom items)
        oldItems.forEach(old => {
          const alreadyMapped = newItems.find(ni =>
            ni.materialName.toLowerCase().trim() === (old.materialName || '').toLowerCase().trim()
          );
          if (!alreadyMapped && old.materialName) {
            newItems.push({
              materialName: old.materialName,
              unit: old.unit || 'Nos',
              make: old.make || '',
              specification: old.specification || '',
              quantity: old.quantity || 0,
              rate: old.rate || 0,
              amount: old.amount || 0,
              scopePragathi: old.scopePragathi || false,
              scopeCustomer: old.scopeCustomer || false,
            });
          }
        });

        updates.items = newItems;

        // Migrate PO number if old format
        if (po.poNumber && !po.poNumber.startsWith('PO-PPSPO-')) {
          const dateStr = (po.poDate || new Date().toISOString().slice(0, 10));
          updates.poNumber = 'PO-PPSPO-' + String(idx + 1).padStart(4, '0') + '/' + dateStr;
        }

        await updateDoc(doc(db, 'leadPOs', po.id), updates);
        updated++;
      }

      // Also migrate purchaseOrders collection
      const poSnap = await getDocs(collection(db, 'purchaseOrders'));
      const allPurchaseOrders = poSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      for (let idx = 0; idx < allPurchaseOrders.length; idx++) {
        const po = allPurchaseOrders[idx];
        const oldItems = po.items || [];
        const updates = {};

        const newItems = NEW_BOM_MATERIALS.map(tpl => {
          const existing = oldItems.find(old =>
            (old.materialName || '').toLowerCase().trim() === tpl.materialName.toLowerCase().trim() ||
            (old.materialName || '').toLowerCase().includes(tpl.materialName.toLowerCase().split('(')[0].trim()) ||
            tpl.materialName.toLowerCase().includes((old.materialName || '').toLowerCase().split('(')[0].trim())
          );
          if (existing) {
            return {
              materialName: tpl.materialName, unit: tpl.unit || existing.unit || 'Nos',
              make: existing.make || tpl.make || '', specification: existing.specification || '',
              quantity: existing.quantity || 0, rate: existing.rate || 0, amount: existing.amount || 0,
              scopePragathi: existing.scopePragathi || false, scopeCustomer: existing.scopeCustomer || false,
            };
          }
          return { materialName: tpl.materialName, unit: tpl.unit, make: tpl.make, specification: '', quantity: 0, rate: 0, amount: 0, scopePragathi: false, scopeCustomer: false };
        });

        oldItems.forEach(old => {
          const alreadyMapped = newItems.find(ni => ni.materialName.toLowerCase().trim() === (old.materialName || '').toLowerCase().trim());
          if (!alreadyMapped && old.materialName) {
            newItems.push({ materialName: old.materialName, unit: old.unit || 'Nos', make: old.make || '', specification: old.specification || '', quantity: old.quantity || 0, rate: old.rate || 0, amount: old.amount || 0, scopePragathi: old.scopePragathi || false, scopeCustomer: old.scopeCustomer || false });
          }
        });

        updates.items = newItems;
        if (po.poNumber && !po.poNumber.startsWith('PO-PPSPO-')) {
          const dateStr = (po.poDate || new Date().toISOString().slice(0, 10));
          updates.poNumber = 'PO-PPSPO-' + String(allPOs.length + idx + 1).padStart(4, '0') + '/' + dateStr;
        }
        await updateDoc(doc(db, 'purchaseOrders', po.id), updates);
        updated++;
      }

      setMigrateResult({ success: true, count: updated });
      toast(`Migration complete! Updated ${updated} PO(s)`);
    } catch (err) {
      setMigrateResult({ success: false, error: err.message });
      toast('Migration failed: ' + err.message, 'er');
    }
    setMigrating(false);
  };

  const toggleBulkUser = (uid) => {
    setBulkSelected(prev => prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);
  };

  const applyBulkPermissions = async () => {
    if (bulkSelected.length === 0) { toast('Select at least one user', 'er'); return; }
    if (!window.confirm(`Apply current permissions to ${bulkSelected.length} user(s)?`)) return;
    setSaving(true);
    try {
      for (const uid of bulkSelected) {
        await updateDoc(doc(db, 'users', uid), { permissions: perms });
      }
      setUsers(prev => prev.map(u => bulkSelected.includes(u.id) ? { ...u, permissions: perms } : u));
      setBulkSelected([]);
      setBulkMode(false);
      toast(`Permissions applied to ${bulkSelected.length} user(s)`);
    } catch (err) {
      toast('Failed: ' + err.message, 'er');
    }
    setSaving(false);
  };

  return (
    <>
      {/* Account Info */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="ch"><h3>Account</h3></div>
        <div className="cb">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Email</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>{user?.email || '-'}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Role</span><span style={{ fontSize: '.95rem', fontWeight: 500, textTransform: 'capitalize' }}>{role}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Display Name</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>{user?.displayName || 'Not set'}</span></div>
            <div><span style={{ fontSize: '.76rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Project</span><span style={{ fontSize: '.95rem', fontWeight: 500 }}>pps-crm-new</span></div>
          </div>
        </div>
      </div>

      {/* Permission Management — admin only */}
      {isAdmin && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="ch" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3><span className="material-icons-round" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>admin_panel_settings</span>Permission Management</h3>
          </div>
          <div className="cb">
            {loading ? (
              <div style={{ textAlign: 'center', padding: 20 }}><div className="spin"></div></div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18, minHeight: 300 }}>
                {/* User List */}
                <div style={{ borderRight: '1px solid var(--bor)', paddingRight: 18 }}>
                  <p style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 10 }}>Select User</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 400, overflowY: 'auto' }}>
                    {users.map(u => (
                      <div key={u.id} onClick={() => selectUser(u)} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                        background: selectedUser?.id === u.id ? 'rgba(var(--pri-rgb,59,130,246),.1)' : 'transparent',
                        border: selectedUser?.id === u.id ? '1px solid var(--pri)' : '1px solid transparent',
                      }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg,var(--pri),var(--pri-l))', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.68rem', fontWeight: 700, flexShrink: 0 }}>
                          {(u.displayName || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
                        </div>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontSize: '.84rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.displayName || u.email}</div>
                          <div style={{ fontSize: '.72rem', color: 'var(--muted)' }}>{u.designation || u.role}</div>
                        </div>
                        {u.permissions && <span className="material-icons-round" style={{ fontSize: 14, color: 'var(--pri)', marginLeft: 'auto' }}>tune</span>}
                      </div>
                    ))}
                    {users.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '.84rem' }}>No approved users found.</p>}
                  </div>
                </div>

                {/* Permissions Panel */}
                <div>
                  {selectedUser ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1rem' }}>{selectedUser.displayName || selectedUser.email}</h4>
                          <p style={{ margin: '2px 0 0', fontSize: '.78rem', color: 'var(--muted)' }}>{selectedUser.designation || selectedUser.role} &bull; {selectedUser.email}</p>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn" onClick={() => toggleAll(true)} style={{ padding: '4px 10px', fontSize: '.76rem' }}>Select All</button>
                          <button className="btn" onClick={() => toggleAll(false)} style={{ padding: '4px 10px', fontSize: '.76rem' }}>Deselect All</button>
                        </div>
                      </div>

                      {/* Permission toggles grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8, marginBottom: 16 }}>
                        {PERMISSION_MODULES.map(m => (
                          <label key={m.key} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                            border: '1px solid var(--bor)', background: perms[m.key] ? 'rgba(39,174,96,.06)' : 'rgba(231,76,60,.04)',
                            transition: 'all .15s',
                          }}>
                            <input type="checkbox" checked={perms[m.key] || false} onChange={() => togglePerm(m.key)} style={{ accentColor: 'var(--pri)' }} />
                            <span className="material-icons-round" style={{ fontSize: 18, color: perms[m.key] ? '#27ae60' : '#e74c3c' }}>{m.icon}</span>
                            <span style={{ fontSize: '.84rem', fontWeight: 500 }}>{m.label}</span>
                          </label>
                        ))}
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button className="btn bp" onClick={savePermissions} disabled={saving} style={{ padding: '8px 20px', fontSize: '.86rem' }}>
                          {saving ? <><span className="ssm"></span> Saving...</> : <><span className="material-icons-round" style={{ fontSize: 16 }}>save</span> Save Permissions</>}
                        </button>
                        <button className="btn" onClick={() => { setBulkMode(!bulkMode); setBulkSelected([]); }} style={{ padding: '8px 16px', fontSize: '.86rem' }}>
                          <span className="material-icons-round" style={{ fontSize: 16 }}>group_add</span> {bulkMode ? 'Cancel Bulk' : 'Apply to Multiple'}
                        </button>
                      </div>

                      {/* Bulk apply mode */}
                      {bulkMode && (
                        <div style={{ marginTop: 14, padding: 14, border: '1px solid var(--bor)', borderRadius: 10, background: 'var(--bg)' }}>
                          <p style={{ fontSize: '.82rem', fontWeight: 600, marginBottom: 10 }}>Select users to apply these same permissions to:</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12, maxHeight: 180, overflowY: 'auto' }}>
                            {users.filter(u => u.id !== selectedUser.id).map(u => (
                              <label key={u.id} style={{
                                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '.82rem',
                                border: bulkSelected.includes(u.id) ? '1px solid var(--pri)' : '1px solid var(--bor)',
                                background: bulkSelected.includes(u.id) ? 'rgba(var(--pri-rgb,59,130,246),.08)' : '#fff',
                              }}>
                                <input type="checkbox" checked={bulkSelected.includes(u.id)} onChange={() => toggleBulkUser(u.id)} />
                                {u.displayName || u.email}
                              </label>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button className="btn bp" onClick={applyBulkPermissions} disabled={saving || bulkSelected.length === 0} style={{ padding: '6px 16px', fontSize: '.82rem' }}>
                              <span className="material-icons-round" style={{ fontSize: 14 }}>check</span> Apply to {bulkSelected.length} user(s)
                            </button>
                            <button className="btn" onClick={() => setBulkSelected(users.filter(u => u.id !== selectedUser.id).map(u => u.id))} style={{ padding: '6px 12px', fontSize: '.78rem' }}>Select All</button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)' }}>
                      <span className="material-icons-round" style={{ fontSize: 48, marginBottom: 10 }}>person_search</span>
                      <p style={{ fontSize: '.9rem' }}>Select a user to manage permissions</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* BOM Data Migration — admin only */}
      {isAdmin && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="ch"><h3><span className="material-icons-round" style={{ fontSize: 20, verticalAlign: 'middle', marginRight: 6 }}>sync</span>BOM Data Migration</h3></div>
          <div className="cb">
            <p style={{ fontSize: '.86rem', color: 'var(--muted)', lineHeight: 1.6, marginBottom: 12 }}>
              Update all existing Purchase Orders (Leads & Customers) to use the new PPS BOM Template format with updated items, UOM, Make defaults, Scope fields, and new PO number format (<strong>PO-PPSPO-0001/YYYY-MM-DD</strong>).
            </p>
            <button className="btn bp" onClick={migrateBOMData} disabled={migrating} style={{ padding: '10px 24px', fontSize: '.88rem' }}>
              {migrating ? <><span className="ssm"></span> Migrating...</> : <><span className="material-icons-round" style={{ fontSize: 16 }}>update</span> Migrate All POs to New BOM Template</>}
            </button>
            {migrateResult && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: migrateResult.success ? 'rgba(39,174,96,.08)' : 'rgba(231,76,60,.08)', border: migrateResult.success ? '1px solid rgba(39,174,96,.3)' : '1px solid rgba(231,76,60,.3)', fontSize: '.84rem' }}>
                {migrateResult.success
                  ? <><span className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', color: '#27ae60', marginRight: 6 }}>check_circle</span>Successfully migrated {migrateResult.count} PO(s) to new BOM template</>
                  : <><span className="material-icons-round" style={{ fontSize: 16, verticalAlign: 'middle', color: '#e74c3c', marginRight: 6 }}>error</span>Error: {migrateResult.error}</>
                }
              </div>
            )}
          </div>
        </div>
      )}

      {/* Deployment */}
      <div className="card">
        <div className="ch"><h3>Deployment</h3></div>
        <div className="cb">
          <p style={{ fontSize: '.88rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            To deploy updates, run <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>npm run build</code> followed by <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>firebase deploy</code> from the project root.
          </p>
        </div>
      </div>
    </>
  );
}
