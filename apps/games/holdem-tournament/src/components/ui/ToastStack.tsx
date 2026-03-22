import { useEffect } from 'react';
import { useGameStore } from 'holdem/app/store/useGameStore';
import styles from 'holdem/components/ui/ToastStack.module.css';
import type { ToastMessage } from 'holdem/types/ui';

function toastClass(kind: ToastMessage['kind']) {
  if (kind === 'success') {
    return styles.success;
  }

  if (kind === 'warning') {
    return styles.warning;
  }

  return styles.info;
}

export function ToastStack() {
  const toasts = useGameStore((state) => state.game.ui.toastQueue);
  const dismissToast = useGameStore((state) => state.dismissToast);

  useEffect(() => {
    if (toasts.length === 0) {
      return undefined;
    }

    const timers = toasts.map((toast) => window.setTimeout(() => dismissToast(toast.id), 3000));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismissToast, toasts]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className={styles.stack}>
      {toasts.map((toast) => (
        <button key={toast.id} className={[styles.toast, toastClass(toast.kind)].join(' ')} onClick={() => dismissToast(toast.id)}>
          {toast.text}
        </button>
      ))}
    </div>
  );
}
