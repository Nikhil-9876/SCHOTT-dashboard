import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Header from './components/layout/Header';
import NavBar from './components/layout/NavBar';
import Dashboard from './pages/Dashboard';
import TOFUPage from './pages/TOFUPage';
import MOFUPage from './pages/MOFUPage';
import BOFUPage from './pages/BOFUPage';
import LinkedInCallback from './pages/LinkedInCallback';
import { SafetyProvider } from './context/SafetyContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 60,      // 1 hour
      gcTime:    1000 * 60 * 60 * 24, // 24 hours
      retry: false,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafetyProvider>
        <BrowserRouter>
          <Header />
          <NavBar />
          <Routes>
            <Route path="/"     element={<Dashboard />} />
            <Route path="/tofu" element={<TOFUPage />} />
            <Route path="/mofu" element={<MOFUPage />} />
            <Route path="/bofu" element={<BOFUPage />} />
            <Route path="/auth/callback" element={<LinkedInCallback />} />
          </Routes>
        </BrowserRouter>
      </SafetyProvider>
    </QueryClientProvider>
  );
}
