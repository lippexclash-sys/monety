import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';

import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  increment
} from 'firebase/firestore';

import { auth, db } from '../firebase/firebase';

interface User {
  id: string;
  name: string;
  email: string;
  balance: number;
  inviteCode: string;
  referredBy?: string | null; // Alterado de invitedBy para referredBy conforme solicitado
  totalEarned: number;
  totalWithdrawn: number;
  spinsAvailable: number;
  role: string;
  createdAt: any;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, inviteCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateBalance: (amount: number) => Promise<void>;
  completeSpin: (prizeAmount: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/* =========================
   LÓGICA DE CÓDIGO ÚNICO
========================= */

const generateInviteCode = (): string => {
  // Gera 6 caracteres aleatórios (ex: ABC123)
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

const generateUniqueInviteCode = async (): Promise<string> => {
  let code = generateInviteCode();
  const usersRef = collection(db, 'users');
  
  // Verifica se já existe, se sim, tenta de novo (máximo 5 vezes)
  for (let i = 0; i < 5; i++) {
    const q = query(usersRef, where('inviteCode', '==', code));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return code;
    code = generateInviteCode();
  }
  return code;
};

/* =========================
   PROVIDER
========================= */

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribeUser: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser: FirebaseUser | null) => {
      if (!firebaseUser) {
        setUser(null);
        setToken(null);
        if (unsubscribeUser) unsubscribeUser();
        return;
      }

      const userDocRef = doc(db, 'users', firebaseUser.uid);

      // LISTENER EM TEMPO REAL
      unsubscribeUser = onSnapshot(userDocRef, async (docSnap) => {
        if (!docSnap.exists()) return;
        
        const data = docSnap.data();

        // --- TRAVA DE SEGURANÇA: GERA CÓDIGO SE NÃO EXISTIR ---
        if (!data.inviteCode) {
          const newCode = await generateUniqueInviteCode();
          await updateDoc(userDocRef, { inviteCode: newCode });
          return; // O onSnapshot disparará novamente com o novo código
        }

        setUser({
          id: firebaseUser.uid,
          name: data.name || '',
          email: firebaseUser.email || '',
          balance: data.balance || 0,
          inviteCode: data.inviteCode,
          totalEarned: data.totalEarned || 0,
          totalWithdrawn: data.totalWithdrawn || 0,
          spinsAvailable: data.spinsAvailable || 0,
          role: data.role || 'user',
          referredBy: data.referredBy || null,
          createdAt: data.createdAt
        } as User);
      });

      const idToken = await firebaseUser.getIdToken();
      setToken(idToken);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUser) unsubscribeUser();
    };
  }, []);

  /* =========================
     REGISTER (CORRIGIDO)
  ========================= */

  const register = async (email: string, password: string, name: string, inviteCodeInput?: string) => {
    try {
      // 1. Criar o usuário no Auth
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;

      let inviterUid: string | null = null;

      // 2. Buscar quem convidou (se houver código)
      if (inviteCodeInput && inviteCodeInput.trim() !== "") {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('inviteCode', '==', inviteCodeInput.trim().toUpperCase()));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          inviterUid = snapshot.docs[0].id;
        }
      }

      // 3. Gerar código de convite para o novo usuário
      const myInviteCode = await generateUniqueInviteCode();

      // 4. Criar documento no Firestore
      await setDoc(doc(db, 'users', uid), {
        name: name,
        email: email,
        balance: 0,
        inviteCode: myInviteCode,
        referredBy: inviterUid || null,
        totalEarned: 0,
        totalWithdrawn: 0,
        spinsAvailable: 1, // Bônus inicial
        role: 'user',
        createdAt: serverTimestamp()
      });

    } catch (error: any) {
      console.error("Erro no registro:", error);
      throw error;
    }
  };

  /* =========================
     OUTRAS FUNÇÕES (LOGIN/BALANÇO)
  ========================= */

  const login = async (email: string, password: string) => {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const idToken = await userCredential.user.getIdToken();
    setToken(idToken);
  };

  const logout = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setToken(null);
  };

  const updateBalance = async (amount: number) => {
    if (!auth.currentUser) return;
    const userRef = doc(db, 'users', auth.currentUser.uid);
    await updateDoc(userRef, {
      balance: increment(amount),
      totalEarned: increment(amount)
    });
  };

  const completeSpin = async (prizeAmount: number) => {
    if (!auth.currentUser) return;
    const userRef = doc(db, 'users', auth.currentUser.uid);
    await updateDoc(userRef, {
      spinsAvailable: increment(-1),
      balance: increment(prizeAmount),
      totalEarned: increment(prizeAmount)
    });
  };

  const refreshUser = async () => {
    if (auth.currentUser) await auth.currentUser.getIdToken(true);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, register, logout, refreshUser, updateBalance, completeSpin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
};
