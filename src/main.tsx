import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installDiagnostics } from './lib/diagnostics'
import { AppErrorBoundary } from './components/app/AppErrorBoundary'

installDiagnostics()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
)
