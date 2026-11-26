import { noteRecording, recordingScope } from './recordingDiagnostics';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { focusManager } from '@tanstack/react-query';
import { hasBackgroundRecorder, recorder } from '../platform/recorder';

export function useBackgroundVehicleRecorder(scope: string, delay: number, poll: () => Promise<boolean>) {
  const [activeScope, setActiveScope] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastPoll, setLastPoll] = useState<{ scope: string; at: number }>();
  const supported = hasBackgroundRecorder();
  const requested = useRef('');
  const current = useRef({ scope, poll });
  useLayoutEffect(() => { current.current = { scope, poll }; }, [scope, poll]);

  useEffect(() => {
    if (!supported) return;
    const polling = recorder.addListener('poll', tick => {
      const session = requested.current;
      if (!session || session !== current.current.scope || (tick?.scope && tick.scope !== recordingScope(session))) return;
      const background = !focusManager.isFocused() || document.hidden;
      noteRecording(session, [background ? 'backgroundPoll' : 'foregroundSkip']);
      if (background) {
        void current.current.poll().then(ok => {
          if (ok && requested.current === session) setLastPoll({ scope: session, at: Date.now() });
        }).catch(() => {});
      }
    });
    const status = recorder.addListener('status', result => {
      if (result.running) {
        if (!requested.current || requested.current !== current.current.scope) {
          void recorder.stop({ reason: 'scope-change' }).catch(() => {});
          return;
        }
        setActiveScope(requested.current);
        setNotice('后台车况轮询已启动。');
      } else {
        requested.current = '';
        setActiveScope('');
        setNotice(result.reason === 'timeout' ? '已达到系统后台运行时限。可重新开启后台记录。' :
          result.reason === 'failed' ? '系统未能开启后台车况轮询。' : '后台车况轮询已停止。');
      }
      setBusy(false);
    });
    return () => {
      void polling.then(listener => listener.remove()).catch(() => {});
      void status.then(listener => listener.remove()).catch(() => {});
    };
  }, [supported]);

  useEffect(() => {
    if (requested.current && requested.current !== scope) {
      requested.current = '';
      void recorder.stop({ reason: 'scope-change' }).catch(() => {});
    }
  }, [scope]);

  const active = !!scope && activeScope === scope;
  useEffect(() => {
    if (active) void recorder.setDelay({ delay }).catch(() => {});
  }, [active, delay]);

  async function setActive(value: boolean) {
    if (!supported || busy || (value && !scope)) return;
    setBusy(true);
    setNotice('');
    try {
      if (value) {
        setLastPoll(undefined);
        requested.current = scope;
        await recorder.start({ delay, scope: recordingScope(scope) });
      } else {
        requested.current = '';
        await recorder.stop();
        setActiveScope('');
      }
    } catch {
      requested.current = '';
      setActiveScope('');
      setNotice('无法切换后台车况轮询，请让应用在前台后重试。');
    } finally { setBusy(false); }
  }

  return { active, busy, notice, supported, setActive, lastPollAt: lastPoll?.scope === scope ? lastPoll.at : undefined };
}
