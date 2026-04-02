import { useEffect, useState, useCallback } from 'react';
import { useAuthStore, selectAuthStatus, selectUser } from '../stores/auth';
import { useTranslation } from '../i18n';
import { CLIENT_CONFIG } from '../config';

// ============================================================
// Types
// ============================================================

interface AuthTrigger {
  action: string;
  symbol?: string;
  price?: string;
  side?: string;
  clickType?: string;
}

type AuthTab = 'login' | 'register';

// ============================================================
// AuthModal Component
// ============================================================

export function AuthModal() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [trigger, setTrigger] = useState<AuthTrigger | null>(null);
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Auth store
  const status = useAuthStore(selectAuthStatus);
  const user = useAuthStore(selectUser);
  const setUser = useAuthStore((s) => s.setUser);
  const setLoading = useAuthStore((s) => s.setLoading);
  const guestId = useAuthStore((s) => s.guestId);

  useEffect(() => {
    const handleAuthRequired = (e: CustomEvent<AuthTrigger>) => {
      setTrigger(e.detail);
      setIsOpen(true);
      setError(null);
    };

    const handleShowAuthModal = () => {
      setTrigger(null);
      setIsOpen(true);
      setError(null);
    };

    window.addEventListener('sclr:auth-required', handleAuthRequired as EventListener);
    window.addEventListener('sclr:show-auth-modal', handleShowAuthModal);

    return () => {
      window.removeEventListener('sclr:auth-required', handleAuthRequired as EventListener);
      window.removeEventListener('sclr:show-auth-modal', handleShowAuthModal);
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && user) {
      setIsOpen(false);
      resetForm();
    }
  }, [status, user]);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const handleClose = useCallback(() => {
    setIsOpen(false);
    resetForm();
  }, []);

  const validateForm = (): string | null => {
    if (!email.trim()) return t.auth.errors.enterEmail;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return t.auth.errors.invalidEmail;
    if (!password) return t.auth.errors.enterPassword;
    if (password.length < 6) return t.auth.errors.passwordMinLength;

    if (activeTab === 'register') {
      if (password !== confirmPassword) return t.auth.errors.passwordMismatch;
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setLoading();

    try {
      const endpoint = activeTab === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = {
        email: email.trim().toLowerCase(),
        password,
        ...(activeTab === 'register' && guestId ? { guestId } : {}),
      };

      const response = await fetch(`${CLIENT_CONFIG.auth.apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || t.auth.errors.authError);
      }

      setUser(data.user, data.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.auth.errors.authError);
      // Reset to guest status on error
      useAuthStore.getState().logout();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Escape to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '400px',
          width: '90%',
          border: '1px solid var(--border-color)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>
            {activeTab === 'login' ? t.auth.login : t.auth.register}
          </h2>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '4px',
            }}
          >
            &times;
          </button>
        </div>

        {/* Trigger context */}
        {trigger?.price && (
          <div style={{
            background: 'var(--bg-tertiary)',
            padding: '12px',
            borderRadius: '4px',
            marginBottom: '16px',
            fontSize: '13px',
          }}>
            {t.auth.tradeRequiresAuth}
            <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
              {trigger.side === 'bid' ? t.auth.buy : t.auth.sell} {trigger.symbol} @ {trigger.price}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            onClick={() => { setActiveTab('login'); setError(null); }}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '4px',
              border: 'none',
              background: activeTab === 'login' ? 'var(--accent-green)' : 'var(--bg-tertiary)',
              color: activeTab === 'login' ? 'white' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {t.auth.login}
          </button>
          <button
            onClick={() => { setActiveTab('register'); setError(null); }}
            style={{
              flex: 1,
              padding: '10px',
              borderRadius: '4px',
              border: 'none',
              background: activeTab === 'register' ? 'var(--accent-green)' : 'var(--bg-tertiary)',
              color: activeTab === 'register' ? 'white' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {t.auth.register}
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Email */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {t.auth.email}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="example@mail.com"
              autoComplete="email"
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
              {t.auth.password}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.auth.minChars}
              autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Confirm Password (only for register) */}
          {activeTab === 'register' && (
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                {t.auth.confirmPassword}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t.auth.confirmPassword}
                autoComplete="new-password"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '4px',
              background: 'rgba(255, 23, 68, 0.1)',
              color: 'var(--accent-red)',
              fontSize: '13px',
              marginBottom: '12px',
            }}>
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: 'none',
              background: isSubmitting ? 'var(--bg-tertiary)' : 'var(--accent-green)',
              color: 'white',
              fontSize: '14px',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? t.auth.loading : (activeTab === 'login' ? t.auth.submit.login : t.auth.submit.register)}
          </button>
        </form>

        {/* Later button */}
        <button
          onClick={handleClose}
          style={{
            width: '100%',
            padding: '10px',
            marginTop: '12px',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          {t.auth.later}
        </button>
      </div>
    </div>
  );
}
