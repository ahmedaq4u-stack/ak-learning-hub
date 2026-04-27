import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getFirestore, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCdgmik_Skd3wjRVn60EtTZGBtHD-AZ7jA",
  authDomain: "ak-learning-hub-b629c.firebaseapp.com",
  projectId: "ak-learning-hub-b629c",
  storageBucket: "ak-learning-hub-b629c.firebasestorage.app",
  messagingSenderId: "1563011786",
  appId: "1:1563011786:web:2c063698671051be0a2233"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function getDisplayName(user) {
  if (!user) return "";
  if (user.displayName) return user.displayName;
  if (user.email) return user.email.split("@")[0] || user.email;
  return "Learner";
}

async function upsertUserDoc(user, extra = {}) {
  if (!user) return;
  const payload = {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    photoURL: user.photoURL || null,
    lastLoginAt: serverTimestamp(),
    ...extra
  };
  await setDoc(doc(db, "users", user.uid), payload, { merge: true });
}

async function signUp({ name, email, password }) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (name) {
    await updateProfile(credential.user, { displayName: name });
  }
  try {
    await upsertUserDoc(credential.user, { createdAt: serverTimestamp() });
    window.AK_FIREBASE_LAST_PROFILE_ERROR = "";
  } catch (error) {
    window.AK_FIREBASE_LAST_PROFILE_ERROR = error?.message || String(error);
    console.warn("Firestore user profile write failed:", error);
  }
  return credential.user;
}

async function signIn({ email, password }) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  try {
    await upsertUserDoc(credential.user);
    window.AK_FIREBASE_LAST_PROFILE_ERROR = "";
  } catch (error) {
    window.AK_FIREBASE_LAST_PROFILE_ERROR = error?.message || String(error);
    console.warn("Firestore user profile write failed:", error);
  }
  return credential.user;
}

async function signOutUser() {
  await signOut(auth);
}

window.AK_FIREBASE = {
  auth,
  db,
  onAuthStateChanged: (callback) => onAuthStateChanged(auth, callback),
  getUser: () => auth.currentUser,
  getDisplayName,
  signUp,
  signIn,
  signOut: signOutUser
};
