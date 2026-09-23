import React, { Suspense, lazy, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Chat from './Chat.tsx';
import './styles.css';
const Admin = lazy(() => import('./Admin.tsx'));
const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15000 },
    mutations: { retry: false },
  },
});
function App() {
  const [route, setRoute] = useState(location.pathname);
  useEffect(() => {
    const listener = () => setRoute(location.pathname);
    addEventListener('popstate', listener);
    return () => removeEventListener('popstate', listener);
  }, []);
  const navigate = (path: string) => {
    history.pushState({}, '', path);
    setRoute(path);
  };
  return (
    <Suspense fallback={<div className="app-loading">正在打开工作台…</div>}>
      {route.startsWith('/admin') ? (
        <Admin navigate={navigate} />
      ) : (
        <Chat route={route} navigate={navigate} />
      )}
    </Suspense>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
