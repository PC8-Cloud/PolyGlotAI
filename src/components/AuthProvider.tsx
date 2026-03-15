import { useEffect, useState, createContext, useContext, ReactNode } from "react";
import { auth } from "../firebase";
import { onAuthStateChanged, User } from "firebase/auth";

interface AuthContextType {
  user: User | null;
  ready: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, ready: false });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const unsubscribe = onAuthStateChanged(
        auth,
        (u) => {
          setUser(u);
          setReady(true);
        },
        (err) => {
          console.error("Auth error:", err);
          setReady(true);
        },
      );
      return unsubscribe;
    } catch (err) {
      console.error("Firebase init error:", err);
      setReady(true);
    }
  }, []);

  // Non-blocking: render children immediately, auth state updates in background
  return (
    <AuthContext.Provider value={{ user, ready }}>
      {children}
    </AuthContext.Provider>
  );
}
