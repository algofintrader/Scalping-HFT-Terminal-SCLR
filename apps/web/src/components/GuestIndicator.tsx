import { useAuthStore, selectAuthStatus, selectUser } from '../stores/auth';
import { useTranslation } from '../i18n';

/**
 */
export function GuestIndicator() {
  const { t } = useTranslation();
  const status = useAuthStore(selectAuthStatus);
  const user = useAuthStore(selectUser);
  const logout = useAuthStore((s) => s.logout);

  const handleLoginClick = () => {
    window.dispatchEvent(new CustomEvent('sclr:show-auth-modal'));
  };

  if (status === 'loading') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 12px',
        fontSize: '13px',
        color: 'var(--text-secondary)',
      }}>
        <span style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--text-muted)',
          animation: 'pulse 1s infinite',
        }} />
        {t.auth.loading}
      </div>
    );
  }

  if (status === 'authenticated' && user) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{
          fontSize: '13px',
          color: 'var(--text-primary)',
          maxWidth: '150px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {user.email}
        </span>
        <button
          onClick={logout}
          style={{
            padding: '4px 8px',
            fontSize: '12px',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-red)';
            e.currentTarget.style.color = 'white';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-tertiary)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          {t.auth.logout}
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={handleLoginClick}
      style={{
        padding: '6px 12px',
        fontSize: '13px',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-color)',
        borderRadius: '4px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        color: 'var(--text-primary)',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hover)';
        e.currentTarget.style.borderColor = 'var(--accent-green)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-tertiary)';
        e.currentTarget.style.borderColor = 'var(--border-color)';
      }}
    >
      <span style={{
        width: '6px',
        height: '6px',
        borderRadius: '50%',
        background: 'var(--text-muted)',
      }} />
      {t.auth.guest}
    </button>
  );
}
