import { useState, useEffect, useMemo } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useConnectionStore } from '../stores/connection';
import { useTranslation } from '../i18n';

const API_URL = import.meta.env.DEV
  ? 'http://localhost:3001'
  : '/api';

export function AddInstrumentButton() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [fetchedSymbols, setFetchedSymbols] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { addInstrument, instruments } = useWorkspaceStore();
  const storeSymbols = useConnectionStore((s) => s.availableSymbols);

  const serverSymbols = storeSymbols.length > 0 ? storeSymbols : fetchedSymbols;

  useEffect(() => {
    if (isOpen && serverSymbols.length === 0) {
      setIsLoading(true);
      fetch(`${API_URL}/symbols`)
        .then(res => res.json())
        .then(data => {
          setFetchedSymbols(data.symbols || []);
        })
        .catch(err => {
          console.error('[AddInstrument] Failed to fetch symbols:', err);
        })
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, serverSymbols.length]);

  const availableSymbols = useMemo(() => {
    const usedSymbols = new Set(instruments.map((i) => i.symbol));
    return serverSymbols.filter((s) => !usedSymbols.has(s));
  }, [instruments, serverSymbols]);

  const handleSelect = (symbol: string) => {
    addInstrument(symbol);
    setIsOpen(false);
  };

  if (isOpen) {
    return (
      <div style={{
        width: '200px',
        background: 'var(--bg-secondary)',
        borderRadius: '4px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignSelf: 'stretch',
      }}>
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>{t.ui.addSymbol}</span>
          <button
            onClick={() => setIsOpen(false)}
            style={{ fontSize: '14px', color: 'var(--text-secondary)' }}
          >
            ×
          </button>
        </div>
        <div style={{
          flex: 1,
          overflow: 'auto',
        }}>
          {isLoading ? (
            <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {t.common.loading}
            </div>
          ) : availableSymbols.length === 0 ? (
            <div style={{ padding: '12px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {t.ui.noSymbols}
            </div>
          ) : availableSymbols.map((symbol) => (
            <button
              key={symbol}
              onClick={() => handleSelect(symbol)}
              style={{
                width: '100%',
                padding: '8px 12px',
                textAlign: 'left',
                borderBottom: '1px solid var(--border-color)',
                fontSize: '13px',
              }}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setIsOpen(true)}
      style={{
        width: '48px',
        background: 'var(--bg-secondary)',
        borderRadius: '4px',
        border: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
        color: 'var(--text-muted)',
        alignSelf: 'stretch',
      }}
    >
      +
    </button>
  );
}
