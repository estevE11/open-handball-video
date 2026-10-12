import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { languages, useLanguageStore, useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function LanguageSelector({ compact = false }: { compact?: boolean }) {
  const t = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  if (compact) return (
    <Select value={language} onValueChange={(value) => {
      const option = languages.find((item) => item.code === value);
      if (option) setLanguage(option.code);
    }}>
      <SelectTrigger aria-label={t('Language')} className="h-8 w-[140px] shrink-0 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {languages.map((option) => <SelectItem key={option.code} value={option.code} lang={option.code}>
          <span className="flex items-center gap-2"><LanguageFlag option={option} compact />{option.name}</span>
        </SelectItem>)}
      </SelectContent>
    </Select>
  );
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{t('Language')}</div>
      <div className="flex flex-wrap gap-3" role="group" aria-label={t('Language')}>
        {languages.map((option) => (
          <Button key={option.code} variant={language === option.code ? 'default' : 'outline'}
            className="h-11 gap-2 px-4"
            aria-pressed={language === option.code} aria-label={option.name} lang={option.code}
            onClick={() => setLanguage(option.code)}>
            <LanguageFlag option={option} />
            {option.name}
          </Button>
        ))}
      </div>
    </div>
  );
}

function LanguageFlag({ option, compact = false }: { option: typeof languages[number]; compact?: boolean }) {
  // Unicode has no Catalan flag emoji; show the Senyera at the same size.
  return option.code === 'ca' ? <svg viewBox="0 0 36 24" className={cn('shrink-0 rounded-sm', compact ? '!h-4 !w-6' : '!h-5 !w-7')} aria-hidden>
    <rect width="36" height="24" fill="#f9d900" />
    {[1, 3, 5, 7].map((stripe) => <rect key={stripe} x="0" y={stripe * 24 / 9} width="36" height={24 / 9} fill="#da121a" />)}
  </svg> : <span className={compact ? 'text-lg' : 'text-xl'} aria-hidden>{option.flag}</span>;
}
