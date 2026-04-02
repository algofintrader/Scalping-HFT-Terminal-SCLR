import { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useConnectionStore } from '../stores/connection';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { useTranslation } from '../i18n';
import { InstrumentPanelV2 } from './InstrumentPanelV2';

const API_URL = import.meta.env.DEV
  ? 'http://localhost:3001'
  : '/api';

// Custom event for centering all orderbooks
export const CENTER_ALL_EVENT = 'sclr:center-all-orderbooks';

export function MobileWorkspace() {
  const { t } = useTranslation();
  const { instruments, addInstrument } = useWorkspaceStore();
  const storeSymbols = useConnectionStore((s) => s.availableSymbols);
  const toggleAutoScroll = useUIPreferencesStore((s) => s.toggleAutoScroll);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [fetchedSymbols, setFetchedSymbols] = useState<string[]>([]);
  const [isLoadingSymbols, setIsLoadingSymbols] = useState(false);

  const serverSymbols = storeSymbols.length > 0 ? storeSymbols : fetchedSymbols;
  const usedSymbols = new Set(instruments.map((i) => i.symbol));
  const availableSymbols = serverSymbols.filter((s) => !usedSymbols.has(s));

  // Ensure selectedIndex is valid
  useEffect(() => {
    if (selectedIndex >= instruments.length && instruments.length > 0) {
      setSelectedIndex(instruments.length - 1);
    }
  }, [instruments.length, selectedIndex]);

  // Fetch symbols when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && serverSymbols.length === 0) {
      setIsLoadingSymbols(true);
      fetch(`${API_URL}/symbols`)
        .then(res => res.json())
        .then(data => {
          setFetchedSymbols(data.symbols || []);
        })
        .catch(err => {
          console.error('[MobileWorkspace] Failed to fetch symbols:', err);
        })
        .finally(() => setIsLoadingSymbols(false));
    }
  }, [isDropdownOpen, serverSymbols.length]);

  // Global Shift key handler (same as desktop)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const activeElement = document.activeElement;
        if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') {
          return;
        }
        e.preventDefault();
        toggleAutoScroll();
        window.dispatchEvent(new CustomEvent(CENTER_ALL_EVENT));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleAutoScroll]);

  const handleSelectInstrument = (index: number) => {
    setSelectedIndex(index);
    setIsDropdownOpen(false);
  };

  const handleAddInstrument = (symbol: string) => {
    addInstrument(symbol);
    // Select the newly added instrument
    setSelectedIndex(instruments.length);
    setIsDropdownOpen(false);
  };

  const currentInstrument = instruments[selectedIndex];

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Mobile Header */}
      <header style={{
        height: '44px',
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          letterSpacing: '0.5px',
        }}>
          SCLR <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t.ui.beta}</span>
        </span>

        {/* Instrument Selector */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            {currentInstrument?.symbol || t.ui.select}
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {isDropdownOpen ? '▲' : '▼'}
            </span>
          </button>

          {/* Dropdown */}
          {isDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '4px',
              width: '180px',
              maxHeight: '300px',
              overflow: 'auto',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '4px',
              zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}>
              {/* Current instruments */}
              {instruments.length > 0 && (
                <>
                  <div style={{
                    padding: '6px 10px',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                  }}>
                    {t.ui.active}
                  </div>
                  {instruments.map((inst, idx) => (
                    <button
                      key={inst.id}
                      onClick={() => handleSelectInstrument(idx)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        textAlign: 'left',
                        fontSize: '13px',
                        fontWeight: idx === selectedIndex ? 600 : 400,
                        color: idx === selectedIndex ? 'var(--accent-color)' : 'var(--text-primary)',
                        background: idx === selectedIndex ? 'var(--bg-tertiary)' : 'transparent',
                        borderBottom: '1px solid var(--border-color)',
                      }}
                    >
                      {inst.symbol}
                    </button>
                  ))}
                </>
              )}

              {/* Available to add */}
              {availableSymbols.length > 0 && (
                <>
                  <div style={{
                    padding: '6px 10px',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border-color)',
                    background: 'var(--bg-tertiary)',
                  }}>
                    {t.ui.addNew}
                  </div>
                  {isLoadingSymbols ? (
                    <div style={{ padding: '10px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      {t.common.loading}
                    </div>
                  ) : (
                    availableSymbols.slice(0, 10).map((symbol) => (
                      <button
                        key={symbol}
                        onClick={() => handleAddInstrument(symbol)}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          textAlign: 'left',
                          fontSize: '13px',
                          color: 'var(--text-secondary)',
                          borderBottom: '1px solid var(--border-color)',
                        }}
                      >
                        + {symbol}
                      </button>
                    ))
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Instrument Panel - fills remaining space */}
      <main style={{
        flex: 1,
        padding: '4px',
        overflow: 'hidden',
      }}>
        {currentInstrument ? (
          <InstrumentPanelV2
            key={currentInstrument.id}
            instrument={currentInstrument}
          />
        ) : (
          <div style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-muted)',
            fontSize: '14px',
          }}>
            {t.ui.selectInstrument}
          </div>
        )}
      </main>

      {/* Close dropdown on outside click */}
      {isDropdownOpen && (
        <div
          onClick={() => setIsDropdownOpen(false)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999,
          }}
        />
      )}
    </div>
  );
}
