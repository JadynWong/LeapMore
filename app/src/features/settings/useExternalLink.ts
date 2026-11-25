import { useState, type MouseEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import { nativeSettings } from '../../platform/settings';

export function useExternalLink() {
  const [error, setError] = useState('');
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (Capacitor.getPlatform() !== 'openharmony') return;
    event.preventDefault();
    setError('');
    void nativeSettings.openRelease({ url: event.currentTarget.href }).catch(() => setError('无法打开系统浏览器。'));
  }
  return { open, error };
}
