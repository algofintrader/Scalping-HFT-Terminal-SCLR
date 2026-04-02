import { useTranslation } from '../i18n';

export function LanguageSwitcher() {
  const { locale, toggleLocale } = useTranslation();

  return (
    <button
      onClick={toggleLocale}
      style={{
        padding: '6px 12px',
        fontSize: '13px',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        cursor: 'pointer',
        color: 'var(--text-primary)',
        fontWeight: 500,
        minWidth: '40px',
      }}
      title={locale === 'ru' ? 'Switch to English' : 'Переключить на русский'}
    >
      {locale.toUpperCase()}
    </button>
  );
}
