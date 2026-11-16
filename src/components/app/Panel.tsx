import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

type PanelProps = {
  title: string;
  headerContent?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
};

export function Panel({ title, headerContent, right, children, className, headerClassName }: PanelProps) {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col rounded-lg border bg-card', className)}>
      <div className={cn('flex h-10 shrink-0 items-center justify-between border-b px-3', headerClassName)}>
        <div className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {headerContent ? <div className="mx-3 min-w-0 flex-1">{headerContent}</div> : null}
        {right ? <div className="flex min-w-0 items-center gap-2">{right}</div> : null}
      </div>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </section>
  );
}

