/* eslint-disable react-refresh/only-export-components -- Class error boundaries do not support Fast Refresh. */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { recordDiagnostic } from '@/lib/diagnostics';
import { useTranslation } from '@/lib/i18n';
import { DiagnosticsButton } from './DiagnosticsButton';
import { Button } from '@/components/ui/button';

function ErrorScreen() {
  const t = useTranslation();
  return <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
    <div className="max-w-lg space-y-4"><h1 className="text-xl font-semibold">{t('The app encountered a problem.')}</h1>
      <p>{t('Share a diagnostic report to help us investigate, then reload the app.')}</p>
      <div className="flex flex-wrap gap-2"><DiagnosticsButton /><Button onClick={() => location.reload()}>{t('Reload app')}</Button></div>
    </div>
  </div>;
}
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { recordDiagnostic('error', 'runtime', 'react.render_failed', { componentStack: info.componentStack }, error); }
  render() { return this.state.failed ? <ErrorScreen /> : this.props.children; }
}
