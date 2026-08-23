import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, getDocsFromServer, getCountFromServer, serverTimestamp, Timestamp, increment, query, where, addDoc, orderBy, limit, startAfter, documentId, onSnapshot, arrayUnion, arrayRemove } from 'firebase/firestore';
import { getStorage, ref, uploadString, uploadBytes, getBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// Callable Functions 는 서울 리전 — 기본(us-central1)으로 부르면 404 가 난다
export const functions = getFunctions(app, 'asia-northeast3');

export {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  signInWithCustomToken,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  increment,
  collection,
  getDocs,
  getDocsFromServer,
  getCountFromServer,
  serverTimestamp,
  ref,
  uploadString,
  uploadBytes,
  getBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  addDoc,
  orderBy,
  limit,
  startAfter,
  documentId,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  Timestamp,
};
