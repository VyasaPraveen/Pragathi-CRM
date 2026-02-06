import { db } from './firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from 'firebase/firestore';

export function listenCollection(col, cb, ob = 'createdAt', dir = 'desc') {
  let q;
  try {
    q = query(collection(db, col), orderBy(ob, dir));
  } catch {
    q = collection(db, col);
  }
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })), null);
  }, err => cb(null, err));
}

export async function addDocument(col, data) {
  const ref = await addDoc(collection(db, col), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref.id;
}

export async function updateDocument(col, id, data) {
  await updateDoc(doc(db, col, id), {
    ...data,
    updatedAt: serverTimestamp()
  });
}

export async function deleteDocument(col, id) {
  await deleteDoc(doc(db, col, id));
}
