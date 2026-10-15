// ============================================================================
// The names offered for lead assignment and supporting team, and how they are
// searched.
//
// These lists used to come from the `team` collection, which is a directory of
// everyone who has ever worked here — including people with no login and older
// spellings of names that already exist as accounts ("GOPI" beside "K Gopi",
// "JEEVAN" beside "V. Jeevan kumar"). Assigning a lead to one of those names
// meant nobody was really assigned: no notification could reach them and the
// lead was invisible to the person who was meant to work it.
//
// So the source of truth is now the accounts themselves. A name here always
// belongs to somebody who can log in and be notified.
// ============================================================================

// Strip everything that is not a letter or digit, so "K.J. Yogendra reddy",
// "kj yogendra reddy" and "KJYogendraReddy" all compare the same. Without this
// the dots and spaces in the real names break every partial search.
const squash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Two names are the same person when the letters and digits match — so
// "K Gopi", "k  gopi" and "K.Gopi" are one name. Comparing on the raw string
// let a stray double space slip somebody back into a list they were excluded
// from, which is the sort of thing nobody notices until a lead is assigned
// twice.
const sameName = (a, b) => squash(a) === squash(b);

// Everyone with a usable account, as { name, email, role }.
export function directoryPeople(users) {
  const seen = new Set();
  return (users || [])
    .filter(u => u && u.approved !== false)
    .map(u => ({ name: String(u.displayName || u.email || '').trim(), email: String(u.email || '').trim(), role: u.role || '' }))
    .filter(p => {
      if (!p.name) return false;
      const k = squash(p.name);
      if (seen.has(k)) return false;       // two accounts, one name — offer it once
      seen.add(k);
      return true;
    });
}

// Just the names, in the order the directory gives them.
export const directoryNames = (users) => directoryPeople(users).map(p => p.name);

// Are the letters of `q` found in `text`, in order but not necessarily
// together? This is what makes "yoa" find "K.J. Yogendra reddy" — y, o and a
// appear in that order inside "kjyogendrareddy".
function isSubsequence(text, q) {
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j++) {
    if (text[j] === q[i]) i++;
  }
  return i === q.length;
}

// How well does this name answer the query? Lower is better; null means no
// match at all. Ranking matters more than it looks: a plain substring hit is
// almost always what the person meant, so it must come above a scattered
// letter-by-letter hit ("gan" should put "P Ganesh" first, not last).
export function matchScore(name, query) {
  const q = squash(query);
  if (!q) return 0;                                   // no query: everything, in order
  const n = squash(name);
  if (!n) return null;
  if (n === q) return 0;                              // the whole name
  if (n.startsWith(q)) return 1;                      // starts with it
  // Does any word in the name start with it? "gan" -> "P Ganesh"
  const words = String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some(w => w.startsWith(q))) return 2;
  if (n.includes(q)) return 3;                        // somewhere inside
  if (isSubsequence(n, q)) return 4;                  // letters in order, spread out
  return null;
}

// The names that answer `query`, best first, then alphabetically so the order
// never jumps around between keystrokes.
export function searchNames(names, query) {
  return (names || [])
    .map(name => ({ name, score: matchScore(name, query) }))
    .filter(x => x.score !== null)
    .sort((a, b) => (a.score - b.score) || a.name.localeCompare(b.name))
    .map(x => x.name);
}

// The names a lead may be assigned to. Whoever it is already assigned to stays
// in the list even if their account has since gone, so opening an old lead can
// never silently clear its assignment.
export function assignableNames(users, current = '') {
  const list = directoryNames(users);
  const cur = String(current || '').trim();
  if (cur && !list.some(n => sameName(n, cur))) list.unshift(cur);
  return list;
}

// The names offered as supporting team: the directory, minus anyone already
// named in a field above (Team Leader, Sales Executive, Assigned To) and minus
// those already picked, because one person cannot be their own support.
export function supportingNames(users, usedAbove = [], selected = []) {
  const blocked = [...(usedAbove || []), ...(selected || [])].map(squash).filter(Boolean);
  return directoryNames(users).filter(n => !blocked.includes(squash(n)));
}
