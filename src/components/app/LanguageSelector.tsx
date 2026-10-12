import { Button } from '@/components/ui/button';
import { languages, useLanguageStore, useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const t = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  return (
    <div className={compact ? 'shrink-0' : 'space-y-2'}>
      {!compact && <div className="text-sm font-medium">{t('Language')}</div>}
      <div className={cn('flex flex-wrap', compact ? 'gap-1' : 'gap-3')} role="group" aria-label={t('Language')}>
        {languages.map((option) => (
          <Button key={option.code} variant={language === option.code ? 'default' : 'outline'}
            className={cn(compact ? 'h-8 gap-1.5 px-2 text-xs' : 'h-11 gap-2 px-4')}
            aria-pressed={language === option.code} aria-label={option.name} lang={option.code}
            onClick={() => setLanguage(option.code)}>
            {/* Unicode has no Catalan flag emoji; show the Senyera at the same size. */}
            {option.code === 'ca' ? <svg viewBox="0 0 36 24" className={cn('shrink-0 rounded-sm', compact ? '!h-4 !w-6' : '!h-5 !w-7')} aria-hidden>
              <rect width="36" height="24" fill="#f9d900" />
              {[1, 3, 5, 7].map((stripe) => <rect key={stripe} x="0" y={stripe * 24 / 9} width="36" height={24 / 9} fill="#da121a" />)}
            </svg> : <span className={compact ? 'text-lg' : 'text-xl'} aria-hidden>{option.flag}</span>}
            {option.name}
          </Button>
        ))}
      </div>
    </div>
  );
}
