import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBdaZspHdpWxv0Z6uDYEAdKtlqOqMZp5RY",
  authDomain: "rnr-social.firebaseapp.com",
  projectId: "rnr-social",
  storageBucket: "rnr-social.firebasestorage.app",
  messagingSenderId: "21141699518",
  appId: "1:21141699518:web:ab2952a5a8d080ed4417ef",
  measurementId: "G-JT96XKP1QT"
};

// Placeholder for Firebase app and Firestore instances
let app: any; // Placeholder for FirebaseApp
let db: any; // Placeholder for Firestore

// Check if Firebase has already been initialized
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

db = getFirestore(app);

console.log("Firebase SDK initialized (simulated). Replace with actual Firebase initialization.");

export { app, db };
