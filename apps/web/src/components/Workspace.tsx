import { useEffect, memo } from 'react';
import { useWorkspaceStore } from '../stores/workspace';
import { useUIPreferencesStore } from '../stores/uiPreferences';
// V2: Virtual Skeleton Architecture
import { InstrumentPanelV2 } from './InstrumentPanelV2';
import { AddInstrumentButton } from './AddInstrumentButton';

// Custom event for centering all orderbooks
export const CENTER_ALL_EVENT = 'sclr:center-all-orderbooks';

export const Workspace = memo(function Workspace() {
  const { instruments } = useWorkspaceStore();
  const toggleAutoScroll = useUIPreferencesStore((s) => s.toggleAutoScroll);

  // Global Shift key handler for toggling autoscroll + centering all orderbooks
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if Shift is pressed (without other keys)
      if (e.key === 'Shift' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Ignore if focus is in input/textarea
        const activeElement = document.activeElement;
        if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') {
          return;
        }

        e.preventDefault();

        // Toggle autoscroll setting
        toggleAutoScroll();

        // Dispatch custom event that all orderbooks will listen for
        window.dispatchEvent(new CustomEvent(CENTER_ALL_EVENT));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleAutoScroll]);

  return (
    <main style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'row',
      gap: '4px',
      padding: '8px',
      overflow: 'hidden',
    }}>
      {instruments.map((instrument) => (
        <InstrumentPanelV2
          key={instrument.id}
          instrument={instrument}
        />
      ))}

      {instruments.length < 10 && <AddInstrumentButton />}
    </main>
  );
});
