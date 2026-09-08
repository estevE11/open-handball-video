import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatBytes, getBrowserCapacity, requestPersistentStorage, storageError } from '@/lib/browserStorage';

export function StorageStatus() {
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

  return <div className="rounded-md border bg-card px-4 py-3 text-sm" aria-label="Browser storage">
    {error ? <p role="alert">{error}</p> : capacity ? <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <strong>{capacity.remainingBytes === null ? 'Available storage unknown' : `${formatBytes(capacity.remainingBytes)} available`}</strong>
        <span>{capacity.projectsLeft === null ? 'Projects remaining: not yet available' : `About ${capacity.projectsLeft.toLocaleString()} more projects`}</span>
        <span className="text-muted-foreground">{formatBytes(capacity.totalBytes)} in saved projects</span>
        {!capacity.persistent && <Button size="sm" variant="outline" onClick={async () => {
          const persistent = await requestPersistentStorage();
          setPersistenceMessage(persistent ? 'Persistent storage enabled.' : 'Your browser did not grant persistent storage. Keep JSON and original video backups.');
          window.dispatchEvent(new Event('ohv-storage-changed'));
        }}>Keep storage persistent</Button>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {capacity.averageBytes === null ? 'Add a video to calculate average project size.' : `Based on ${formatBytes(capacity.averageBytes)} average per project, including video and JSON.`}
        {' '}Browser space is an estimate; available disk space can change.
        {' '}{capacity.persistent ? 'Persistent storage enabled.' : 'Saved on this browser and device. Clearing site data removes saved projects.'}
      </p>
      {persistenceMessage && <p role="status" className="mt-1 text-xs">{persistenceMessage}</p>}
    </> : <p>Checking browser storage…</p>}
  </div>;
}
