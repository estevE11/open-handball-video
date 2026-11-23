import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
import App from './App.tsx'
import { installDiagnostics } from './lib/diagnostics'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'

installDiagnostics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
    {import.meta.env.PROD && !window.electron && <Analytics />}
  </StrictMode>,
)
