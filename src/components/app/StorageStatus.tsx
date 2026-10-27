import { useTranslation, useTranslatedMessage, useLanguageStore } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { ChevronDown, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorReportAction } from './DiagnosticsButton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { formatBytes, getBrowserCapacity, requestPersistentStorage, storageError } from '@/lib/browserStorage';

export function StorageStatus({ compact = false }: { compact?: boolean }) {
  const t = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const message = useTranslatedMessage();
  const [capacity, setCapacity] = useState<Awaited<ReturnType<typeof getBrowserCapacity>> | null>(null);
  const [error, setError] = useState('');
  const [persistenceMessage, setPersistenceMessage] = useState('');
  const [requestingPersistence, setRequestingPersistence] = useState(false);
  const explanation = t('Your videos and annotations are stored in this browser on this device. Persistent storage helps your browser keep them available between visits.');
  const backupTip = t('You can also export your projects as JSON and keep the original videos for an extra copy.');
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getBrowserCapacity().then((next) => {
        if (active) { setCapacity(next); setError(''); }
      }).catch((err: unknown) => { if (active) setError(storageError(err)); });
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener('ohv-storage-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('ohv-storage-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return <div className="rounded-md border bg-card px-4 py-3 text-sm" aria-label={t("Browser storage")}>
    {error ? <div role="alert" className="space-y-2"><p>{message(error)}</p><ErrorReportAction /></div> : capacity ? <>
      {!capacity.persistent ? <details open={!compact} className="group mb-4 rounded-lg border border-amber-500/60 bg-amber-500/10 p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center gap-3 text-base font-semibold text-amber-800 dark:text-amber-300 [&::-webkit-details-marker]:hidden">
          <ShieldAlert className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="flex-1">{t('Protect your saved work')}</span>
          <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
          <div className="mt-3 min-w-0 space-y-3 sm:ml-9">
            <p>{explanation}</p>
            <p>{t('Enable persistent storage to help your browser retain your projects when it manages available space.')}</p>
            <Button className="h-auto min-h-10 whitespace-normal bg-amber-400 py-2 text-amber-950 hover:bg-amber-300" disabled={requestingPersistence} onClick={async () => {
              setRequestingPersistence(true);
              setPersistenceMessage('');
              try {
                const persistent = await requestPersistentStorage();
                if (persistent) setCapacity(previous => previous ? { ...previous, persistent: true } : previous);
                setPersistenceMessage(persistent ? '' : 'Your browser has not enabled persistent storage yet. You can try again or export a project copy.');
                window.dispatchEvent(new Event('ohv-storage-changed'));
              } catch (error) { setPersistenceMessage(storageError(error)); }
              finally { setRequestingPersistence(false); }
            }}>{requestingPersistence ? t('Requesting protection…') : t('Enable persistent storage')}</Button>
            <p className="text-muted-foreground">{backupTip}</p>
          </div>
      </details> : <Dialog>
        <div className="mb-3 flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span role="status" className="font-semibold">{t('Persistent storage enabled.')}</span>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 rounded-full border border-emerald-600/40 text-inherit hover:bg-emerald-500/10 hover:text-inherit" aria-label={t('About persistent storage')} title={t('About persistent storage')}>?</Button>
          </DialogTrigger>
        </div>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('About persistent storage')}</DialogTitle>
            <DialogDescription>{explanation}</DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300">{t('Your browser has granted persistent storage for this site. It is active and helps protect your saved projects from automatic cleanup.')}</p>
          <p className="text-sm text-muted-foreground">{backupTip}</p>
        </DialogContent>
      </Dialog>}
      {!capacity.persistent && persistenceMessage && <p role="alert" className="mb-4 rounded-md border border-amber-500/60 bg-amber-500/10 p-3 font-medium">{message(persistenceMessage)}</p>}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <strong>{capacity.remainingBytes === null ? t("Available storage unknown") : t("{0} available", formatBytes(capacity.remainingBytes))}</strong>
        <span>{capacity.projectsLeft === null ? t("Projects remaining: not yet available") : t("About {0} more projects", capacity.projectsLeft.toLocaleString(language))}</span>
        <span className="text-muted-foreground">{t("{0} in saved projects", formatBytes(capacity.totalBytes))}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {capacity.averageBytes === null ? t("Add a video to calculate average project size.") : t("Based on {0} average per project, including video and JSON.", formatBytes(capacity.averageBytes))}
        {' '}{t("Browser space is an estimate; available disk space can change.")}
      </p>
    </> : <p>{t("Checking browser storage…")}</p>}
  </div>;
}
