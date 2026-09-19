import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppGate } from './App.tsx';
import { CrashScreen } from './components/CrashScreen.tsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Outside the router and inside the provider: a crash must not cost the
          query cache (everything would be refetched on the retry), and the
          router is one of the things that can throw. */}
      <CrashScreen>
        <BrowserRouter>
          <AppGate />
        </BrowserRouter>
      </CrashScreen>
    </QueryClientProvider>
  </StrictMode>,
);
