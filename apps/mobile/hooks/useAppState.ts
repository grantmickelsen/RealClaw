import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Fires `onForeground` when the app transitions from background/inactive to active.
 * Useful for re-running security checks or refreshing data on resume.
 */
export function useAppState(onForeground: () => void): void {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        onForeground();
      }
      appState.current = nextState;
    });

    return () => subscription.remove();
  }, [onForeground]);
}
