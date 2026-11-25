import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { nativeSettings } from '../../platform/settings';
import { Sheet, asset } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useExternalLink } from './useExternalLink';

const rewardImage = asset('wechat-reward-qr.png');

export function RewardSheet({ close }: { close: () => void }) {
  const { open, error } = useExternalLink();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  async function saveImage() {
    if (saving) return;
    setSaving(true);
    setNotice('');
    try {
      const result = await nativeSettings.saveRewardImage();
      if (result.saved) setNotice('微信赞赏码已保存。');
    } catch { setNotice('无法保存赞赏码，请重试。'); }
    finally { setSaving(false); }
  }

  return <Sheet title="赞赏作者" className="reward-sheet" close={close} showClose>
    <a className="row" href="https://afdian.com/a/mirato" target="_blank" rel="noreferrer" onClick={open}>
      <span className="ic"><Icon name="heart" size={19} /></span><span className="t">爱发电赞赏</span>
      <span className="v"><Icon name="external" size={16} /></span>
    </a>
    {error && <p role="status" className="small">{error}</p>}
    <div className="reward-wechat">
      <details><summary>微信赞赏码</summary>
        <img src={rewardImage} alt="作者的微信赞赏码" width={504} height={504} />
      </details>
      {Capacitor.isNativePlatform() ?
        <button className="link reward-download" aria-label="下载微信赞赏码" disabled={saving} onClick={() => void saveImage()}>{saving ? '保存中…' : '下载'}</button> :
        <a className="link reward-download" aria-label="下载微信赞赏码" href={rewardImage} download="LeapMore-微信赞赏码.png">下载</a>}
    </div>
    {notice && <p role="status" className="small">{notice}</p>}
  </Sheet>;
}
