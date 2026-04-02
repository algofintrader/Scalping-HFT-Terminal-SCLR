import { useUIPreferencesStore } from '../stores/uiPreferences';
import { useTranslation } from '../i18n';

/**
 */
export function AutoScrollIndicator() {
  const { t, format } = useTranslation();
  const autoScrollEnabled = useUIPreferencesStore((s) => s.autoScrollEnabled);
  const toggleAutoScroll = useUIPreferencesStore((s) => s.toggleAutoScroll);

  const status = autoScrollEnabled ? t.migration.on : t.migration.off;

  return (
    <button
      onClick={toggleAutoScroll}
      title={format(t.ui.autoScrollHint, { status })}
      style={{
        padding: '6px 12px',
        fontSize: '13px',
        background: autoScrollEnabled
          ? 'rgba(0, 200, 83, 0.2)'
          : 'var(--bg-tertiary)',
        border: `1px solid ${
          autoScrollEnabled
            ? 'rgba(0, 200, 83, 0.5)'
            : 'var(--border-color)'
        }`,
        borderRadius: '4px',
        color: autoScrollEnabled
          ? 'var(--accent-green, #00c853)'
          : 'var(--text-primary)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        userSelect: 'none',
      }}
    >
      {t.ui.autoScroll}
    </button>
  );
}
