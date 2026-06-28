import { useEffect, useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import { useBmsSession } from './hooks/useBmsSession';
import LoadingSpinner from './components/ui/LoadingSpinner';
import { useSessionStore } from './store/sessionStore';
import { useUploadStore } from './store/uploadStore';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function AppInitializer({ children }: { children: React.ReactNode }) {
  const [initializing, setInitializing] = useState(true);
  const { initFromStorage } = useBmsSession();

  useEffect(() => {
    initFromStorage().then((success) => {
      if (success) {
        const { hospitalCode, isAdmin } = useSessionStore.getState();
        useUploadStore.getState().loadByHospital(isAdmin ? '*' : hospitalCode ?? '*');
      } else {
        // ถ้ายังไม่ได้ login ใน finance dashboard → ใช้ loginSession ของระบบหลักแทน
        try {
          const mainSession = JSON.parse(localStorage.getItem('loginSession') || 'null');
          const TIMEOUT = 8 * 60 * 60 * 1000;
          if (mainSession?.loginTime && (Date.now() - mainSession.loginTime) < TIMEOUT) {
            useSessionStore.getState().setSession({
              sessionId: `main:${mainSession.name ?? 'user'}`,
              apiUrl: '',
              apiAuthKey: '',
              databaseName: '',
              databaseType: '',
              availableTables: [],
              bmsUrl: '',
              bmsSessionCode: '',
              userName: mainSession.name ?? '',
              location: '',
            });
          }
        } catch { /* ignore */ }
      }
    }).finally(() => {
      setInitializing(false);
    });
  }, [initFromStorage]);

  if (initializing) {
    return <LoadingSpinner fullScreen text="กำลังเริ่มต้นระบบ..." />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInitializer>
        <RouterProvider router={router} />
      </AppInitializer>
    </QueryClientProvider>
  );
}
