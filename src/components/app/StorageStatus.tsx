import { useTranslation, useTranslatedMessage, useLanguageStore } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { ChevronDown, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes, getBrowserCapacity, requestPersistentStorage, storageError } from '@/lib/browserStorage';

export function StorageStatus({ compact = false }: { compact?: boolean }) {
  const t = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const message = useTranslatedMessage();
  const [capacity, setCapacity] = useState<Awaited<ReturnType<typeof getBrowserCapacity>> | null>(null);
  const [error, setError] = useState('');
  const [persistenceMessage, setPersistenceMessage] = useState('');
  const [requestingPersistence, setRequestingPersistence] = useState(false);
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
    {error ? <p role="alert">{message(error)}</p> : capacity ? <>
      {!capacity.persistent ? <details open={!compact} className="group mb-4 rounded-lg border border-amber-500/60 bg-amber-500/10 p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center gap-3 text-base font-semibold text-amber-800 dark:text-amber-300 [&::-webkit-details-marker]:hidden">
          <ShieldAlert className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <span className="flex-1">{t('Protect your saved work')}</span>
          <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
          <div className="mt-3 min-w-0 space-y-3 sm:ml-9">
            <p>{t('Your videos and annotations are saved only in this browser on this device. There is no cloud backup. Without persistent storage, your browser may automatically delete them to free up space.')}</p>
            <p>{t('Enable persistent storage to help protect your projects from automatic cleanup. Your browser decides whether to grant it.')}</p>
            <Button className="h-auto min-h-10 whitespace-normal bg-amber-400 py-2 text-amber-950 hover:bg-amber-300" disabled={requestingPersistence} onClick={async () => {
              setRequestingPersistence(true);
              setPersistenceMessage('');
              try {
                const persistent = await requestPersistentStorage();
                if (persistent) setCapacity(previous => previous ? { ...previous, persistent: true } : previous);
                setPersistenceMessage(persistent ? 'Persistent storage enabled.' : 'Your browser did not grant persistent storage. Keep JSON and original video backups.');
                window.dispatchEvent(new Event('ohv-storage-changed'));
              } catch (error) { setPersistenceMessage(storageError(error)); }
              finally { setRequestingPersistence(false); }
            }}>{requestingPersistence ? t('Requesting protection…') : t('Enable persistent storage')}</Button>
            <p className="font-medium">{t('Keep backups: export each project as JSON and keep the original videos. Persistent storage does not protect against clearing site data, private browsing, or losing this device.')}</p>
          </div>
      </details> : <div className="mb-3 flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <div><p className="font-semibold">{t('Persistent storage enabled.')}</p><p className="mt-1 text-muted-foreground">{t('Keep backups: export each project as JSON and keep the original videos. Persistent storage does not protect against clearing site data, private browsing, or losing this device.')}</p></div>
      </div>}
      {persistenceMessage && <p role={capacity.persistent ? 'status' : 'alert'} className={`mb-4 rounded-md border p-3 font-medium ${capacity.persistent ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-amber-500/60 bg-amber-500/10'}`}>{message(persistenceMessage)}</p>}
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
