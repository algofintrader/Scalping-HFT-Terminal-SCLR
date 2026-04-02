import { useState } from 'react';
import { useSessionStore, type UserSettings } from '../stores/session';
import { useTranslation } from '../i18n';

// ============================================================
// MigrationModal - Conflict resolution when both local and server have settings
// ============================================================

export function MigrationModal() {
  const { t } = useTranslation();
  const { migrationPending, serverSettings, localSettings, resolveConflict, dismissMigration } =
    useSessionStore();
  const [isLoading, setIsLoading] = useState(false);

  if (!migrationPending || !serverSettings || !localSettings) {
    return null;
  }

  const handleChoice = async (choice: 'local' | 'server') => {
    setIsLoading(true);
    try {
      await resolveConflict(choice);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
    >
      <div
        style={{
          background: '#1a1a2e',
          borderRadius: '8px',
          padding: '24px',
          minWidth: '500px',
          maxWidth: '700px',
          border: '1px solid #333',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
        }}
      >
        <h2
          style={{
            margin: '0 0 8px 0',
            color: '#fff',
            fontSize: '18px',
            fontWeight: 600,
          }}
        >
          {t.migration.title}
        </h2>

        <p
          style={{
            margin: '0 0 20px 0',
            color: '#888',
            fontSize: '13px',
          }}
        >
          {t.migration.description}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          {/* Local settings */}
          <SettingsCard
            title={t.migration.local}
            settings={localSettings}
            selected={false}
            disabled={isLoading}
            onSelect={() => handleChoice('local')}
            buttonLabel={t.migration.keepLocal}
            buttonStyle={{
              background: '#2a2a4a',
              color: '#fff',
            }}
            t={t}
          />

          {/* Server settings */}
          <SettingsCard
            title={t.migration.server}
            settings={serverSettings}
            selected={false}
            disabled={isLoading}
            onSelect={() => handleChoice('server')}
            buttonLabel={t.migration.loadServer}
            buttonStyle={{
              background: '#4a9eff',
              color: '#fff',
            }}
            t={t}
          />
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <button
            onClick={dismissMigration}
            disabled={isLoading}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              fontSize: '12px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              padding: '8px 16px',
            }}
          >
            {t.migration.decideLater}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SettingsCard - Display settings summary
// ============================================================

interface SettingsCardProps {
  title: string;
  settings: UserSettings;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  buttonLabel: string;
  buttonStyle: React.CSSProperties;
  t: ReturnType<typeof useTranslation>['t'];
}

function SettingsCard({
  title,
  settings,
  disabled,
  onSelect,
  buttonLabel,
  buttonStyle,
  t,
}: SettingsCardProps) {
  return (
    <div
      style={{
        background: '#0f0f1a',
        borderRadius: '6px',
        padding: '16px',
        border: '1px solid #333',
      }}
    >
      <h3
        style={{
          margin: '0 0 12px 0',
          color: '#ccc',
          fontSize: '13px',
          fontWeight: 500,
        }}
      >
        {title}
      </h3>

      {/* Instruments list */}
      <div
        style={{
          marginBottom: '12px',
        }}
      >
        <div
          style={{
            color: '#666',
            fontSize: '11px',
            marginBottom: '6px',
          }}
        >
          {t.migration.instruments} ({settings.instruments.length}):
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
          }}
        >
          {settings.instruments.length > 0 ? (
            settings.instruments.map((inst) => (
              <span
                key={inst.id}
                style={{
                  background: '#2a2a4a',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: '#fff',
                }}
              >
                {inst.symbol.replace('USDT', '')}
              </span>
            ))
          ) : (
            <span style={{ color: '#666', fontSize: '11px' }}>{t.migration.noInstruments}</span>
          )}
        </div>
      </div>

      {/* Auto-scroll */}
      <div
        style={{
          color: '#666',
          fontSize: '11px',
          marginBottom: '16px',
        }}
      >
        {t.migration.autoScroll}: {settings.autoScrollEnabled ? t.migration.on : t.migration.off}
      </div>

      {/* Action button */}
      <button
        onClick={onSelect}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '10px',
          borderRadius: '4px',
          border: 'none',
          fontSize: '13px',
          fontWeight: 500,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          transition: 'opacity 0.2s',
          ...buttonStyle,
        }}
      >
        {disabled ? t.common.loading : buttonLabel}
      </button>
    </div>
  );
}
