import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PanelProps = {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Panel({ title, right, children, className }: PanelProps) {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col rounded-lg border bg-card', className)}>
      <div className="flex h-10 items-center justify-between border-b px-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {right ? <div className="flex items-center gap-2">{right}</div> : null}
      </div>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </section>
  );
}


