import { useTranslation, useTranslatedMessage, useLanguageStore } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatBytes, getBrowserCapacity, requestPersistentStorage, storageError } from '@/lib/browserStorage';

export function StorageStatus() {
  const t = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const message = useTranslatedMessage();
  const [capacity, setCapacity] = useState<Awaited<ReturnType<typeof getBrowserCapacity>> | null>(null);
  const [error, setError] = useState('');
  const [persistenceMessage, setPersistenceMessage] = useState('');
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
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <strong>{capacity.remainingBytes === null ? t("Available storage unknown") : t("{0} available", formatBytes(capacity.remainingBytes))}</strong>
        <span>{capacity.projectsLeft === null ? t("Projects remaining: not yet available") : t("About {0} more projects", capacity.projectsLeft.toLocaleString(language))}</span>
        <span className="text-muted-foreground">{t("{0} in saved projects", formatBytes(capacity.totalBytes))}</span>
        {!capacity.persistent && <Button size="sm" variant="outline" onClick={async () => {
          const persistent = await requestPersistentStorage();
          setPersistenceMessage(persistent ? "Persistent storage enabled." : "Your browser did not grant persistent storage. Keep JSON and original video backups.");
          window.dispatchEvent(new Event('ohv-storage-changed'));
        }}>{t("Keep storage persistent")}</Button>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {capacity.averageBytes === null ? t("Add a video to calculate average project size.") : t("Based on {0} average per project, including video and JSON.", formatBytes(capacity.averageBytes))}
        {' '}{t("Browser space is an estimate; available disk space can change.")}{' '}{capacity.persistent ? t("Persistent storage enabled.") : t("Saved on this browser and device. Clearing site data removes saved projects.")}
      </p>
      {persistenceMessage && <p role="status" className="mt-1 text-xs">{message(persistenceMessage)}</p>}
    </> : <p>{t("Checking browser storage…")}</p>}
  </div>;
}
