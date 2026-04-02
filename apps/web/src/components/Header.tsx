import { memo } from 'react';
import { useConnectionStore } from '../stores/connection';
import { useTranslation } from '../i18n';
import { AutoScrollIndicator } from './AutoScrollIndicator';
import { GuestIndicator } from './GuestIndicator';
import { LanguageSwitcher } from './LanguageSwitcher';

export const Header = memo(function Header() {
  const isConnected = useConnectionStore((state) => state.isConnected);
  const { t } = useTranslation();

  return (
    <header style={{
      height: 'var(--header-height)',
      background: 'var(--bg-secondary)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 16px',
      gap: '16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '20px', fontWeight: 700 }}>SCLR</span>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: isConnected ? 'var(--accent-green)' : 'var(--accent-red)',
        }} />
      </div>

      <div style={{ flex: 1 }} />

      <AutoScrollIndicator />

      <GuestIndicator />

      <LanguageSwitcher />

      <button
        disabled
        style={{
          padding: '6px 12px',
          background: 'var(--bg-tertiary)',
          borderRadius: '4px',
          border: '1px solid var(--border-color)',
          fontSize: '13px',
          opacity: 0.5,
          cursor: 'not-allowed',
        }}
      >
        {t.ui.settings}
      </button>
    </header>
  );
});
