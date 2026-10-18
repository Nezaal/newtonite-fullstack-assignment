import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthProvider.tsx'
import { ToastProvider } from './components/ToastProvider.tsx'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // Data counts as fresh for 10 seconds; it also refreshes when the tab gets focus again.
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
