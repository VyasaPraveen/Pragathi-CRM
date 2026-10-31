// ============================================================================
// The team structure, read off the accounts (Req 5, 30-Oct).
//
// A team is a Team Leader and the people whose account says they report to
// that leader (teamLeader = the leader's email). Nothing is stored twice:
// this is the same link the leads, the payment requests and the leave flow
// already follow, so the Total Users screen and the rest of the CRM can
// never disagree about who is in which team.
// ============================================================================
import { normalizeRole } from './permissions';

const lc = (v) => String(v || '').trim().toLowerCase();

// Where an account stands: active, hold, deactivated — or pending, when the
// login has not been approved yet.
export function userStatus(u) {
  if (!u) return 'active';
  if (u.approved === false) return 'pending';
  const s = lc(u.status);
  return s === 'hold' || s === 'deactivated' ? s : 'active';
}

export const STATUS_LABEL = { active: 'Active', hold: 'On hold', deactivated: 'Deactivated', pending: 'Pending approval' };

// The roles that sit outside the sales teams (they are "Other users").
export const STAFF_ROLES = ['super_admin', 'management', 'admin', 'operation_manager', 'technical_manager', 'sales_manager', 'accountant', 'bco', 'warehouse_admin'];

export const isLeaderAccount = (users, u) =>
  normalizeRole(u.role) === 'team_leader' || (users || []).some(m => m.id !== u.id && lc(m.teamLeader) && lc(m.teamLeader) === lc(u.email));

// Teams in a stable order: by when the leader's account was made, then by
// name, so "Team 3" stays Team 3 when a member joins or leaves.
export function teamStructure(users) {
  const list = (users || []).filter(Boolean);
  const byEmail = new Map(list.map(u => [lc(u.email), u]));
  const leaders = list.filter(u => isLeaderAccount(list, u))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
  const placed = new Set();
  const teams = leaders.map((leader, i) => {
    placed.add(leader.id);
    const members = list.filter(u => u.id !== leader.id && lc(u.teamLeader) === lc(leader.email))
      .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
    members.forEach(m => placed.add(m.id));
    const all = [leader, ...members];
    return {
      key: lc(leader.email),
      index: i + 1,
      label: String(leader.teamName || '').trim() || `Team ${i + 1}`,
      leader,
      members,
      active: all.filter(u => userStatus(u) === 'active').length,
      hold: all.filter(u => userStatus(u) === 'hold').length,
      deactivated: all.filter(u => userStatus(u) === 'deactivated').length,
    };
  });
  // Someone whose leader has no account (or whose leader is themselves) is
  // not in any team.
  const rest = list.filter(u => !placed.has(u.id));
  const others = rest.filter(u => STAFF_ROLES.includes(normalizeRole(u.role)))
    .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
  const unassigned = rest.filter(u => !STAFF_ROLES.includes(normalizeRole(u.role)))
    .sort((a, b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email)));
  // A member whose stored leader has no matching account: worth flagging.
  const brokenLinks = rest.filter(u => lc(u.teamLeader) && !byEmail.has(lc(u.teamLeader)));
  const counts = {
    users: list.length,
    teams: teams.length,
    active: list.filter(u => userStatus(u) === 'active').length,
    hold: list.filter(u => userStatus(u) === 'hold').length,
    deactivated: list.filter(u => userStatus(u) === 'deactivated').length,
    pending: list.filter(u => userStatus(u) === 'pending').length,
    unassigned: unassigned.length,
  };
  return { teams, others, unassigned, brokenLinks, counts };
}

// The team (label) a person belongs to, or '' — for the Team page and pickers.
export function teamLabelOf(users, u) {
  const { teams } = teamStructure(users);
  const t = teams.find(x => x.leader.id === u.id || x.members.some(m => m.id === u.id));
  return t ? t.label : '';
}

// Who may lead a team: an active, approved account that is not an Owner.
export const leaderCandidates = (users) =>
  (users || []).filter(u => userStatus(u) === 'active' && normalizeRole(u.role) !== 'super_admin');
