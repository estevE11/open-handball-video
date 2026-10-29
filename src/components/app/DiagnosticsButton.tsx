import { useEffect, useState } from 'react';
import { Bug, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { createDiagnosticReport, projectDiagnosticSummary } from '@/lib/diagnostics';
import { useTranslation } from '@/lib/i18n';
import { useProjectStore } from '@/store/projectStore';

export function DiagnosticsButton({ compact = false, errorId, forError = false }: { compact?: boolean; errorId?: string; forError?: boolean }) {
  const t = useTranslation();
  const label = t(forError ? 'Share report' : 'Share diagnostics');
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Awaited<ReturnType<typeof createDiagnosticReport>> | null>(null);
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void createDiagnosticReport(projectDiagnosticSummary(useProjectStore.getState()), errorId).then(next => {
      if (active) setReport(next);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [open, errorId]);
  const contents = report ? JSON.stringify(report, null, 2) : '';
  return <Dialog open={open} onOpenChange={next => {
    setOpen(next);
    if (next) { setReport(null); setFeedback(''); setFailed(false); }
  }}>
    <DialogTrigger asChild>
      <Button variant={forError ? 'default' : 'outline'} size={compact ? 'icon' : 'sm'} aria-label={label} title={label}>
        <Bug className={`h-4 w-4 shrink-0 ${compact ? '' : 'mr-2'}`} aria-hidden="true" />{!compact && label}
      </Button>
    </DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[680px]">
      <DialogHeader>
        <DialogTitle>{t('Beta diagnostic report')}</DialogTitle>
        <DialogDescription>{t('Download or copy this report and share it with the development team. Include what you were doing when the problem occurred.')}</DialogDescription>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">{t('Reports include technical details, clip timings, media properties, and error traces. Videos, label text, and full project data are not included. Nothing is sent automatically.')}</p>
      {failed ? <p role="alert">{t('Could not prepare the diagnostic report. Please retry.')}</p> : report ? <>
        <p className="break-all text-xs text-muted-foreground">{t('Report ID: {0}', report.reportId)}</p>
        {report.storage.diagnosticHistory === 'memory' && <p className="text-sm">{t('Diagnostic history is available for this session only.')}</p>}
        <details className="min-w-0 rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">{t('Preview report')}</summary>
          <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{contents}</pre>
        </details>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={async () => {
            try { await navigator.clipboard.writeText(contents); setFeedback('Report copied.'); }
            catch { setFeedback('Could not copy the report. Download it instead.'); }
          }}><Copy className="mr-2 h-4 w-4" aria-hidden="true" />{t('Copy report')}</Button>
          <Button onClick={() => {
            const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url; link.download = `ohv-diagnostics-${report.reportId}.json`;
            document.body.appendChild(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            setFeedback('Report download started.');
          }}><Download className="mr-2 h-4 w-4" aria-hidden="true" />{t('Download report')}</Button>
        </div>
      </> : <p role="status">{t('Preparing diagnostic report…')}</p>}
      {feedback && <p role="status" className="text-sm">{t(feedback as 'Report copied.' | 'Could not copy the report. Download it instead.' | 'Report download started.')}</p>}
    </DialogContent>
  </Dialog>;
}

export function ErrorReportAction({ errorId }: { errorId?: string }) {
  const t = useTranslation();
  return <div className="flex flex-wrap items-center gap-3">
    <DiagnosticsButton errorId={errorId} forError />
    <p className="text-xs text-muted-foreground">{t('Please share a report with us so we can investigate this error.')}</p>
  </div>;
}
