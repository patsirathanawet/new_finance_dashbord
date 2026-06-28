import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSessionStore } from '../store/sessionStore';
import LoginPage from '../pages/LoginPage';

export function RequireAuth({ children }: { children: ReactNode }) {
  const isConnected = useSessionStore((s) => s.isConnected);
  const location = useLocation();

  if (!isConnected) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

export function RedirectIfAuthed() {
  const isConnected = useSessionStore((s) => s.isConnected);
  if (isConnected) {
    return <Navigate to="/" replace />;
  }

  return <LoginPage />;
}
