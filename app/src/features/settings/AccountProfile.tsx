import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { readDataset, saveDataset } from '../../data/localDatabase';
import { maskPhone } from '../../data/phoneMask';
import { Sheet, SheetButtons } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { useModelContext } from '../context';

type Profile = { name?: string; avatar?: string; maskedPhone?: string };

async function profileImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15_000_000) {
    throw new Error('请选择 15 MB 以内的 JPG、PNG 或 WebP 图片。');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    if (!edge) throw new Error('无法读取这张图片。');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(image, (image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge, 0, 0, 256, 256);
    return canvas.toDataURL('image/jpeg', .9);
  } finally { URL.revokeObjectURL(url); }
}

function Avatar({ image }: { image?: string }) {
  return <span className="avatar">{image ? <img src={image} alt="" /> : <Icon name="user" size={24} />}</span>;
}

function ProfileEditor({ profile, canEnterPhone, save, close }: {
  profile: Profile; canEnterPhone: boolean; save: (profile: Profile) => Promise<void>; close: () => void;
}) {
  const [name, setName] = useState(profile.name ?? '');
  const [avatar, setAvatar] = useState(profile.avatar);
  const [phone, setPhone] = useState('');
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  async function choose(file: File) {
    setReading(true); setNote('');
    try { setAvatar(await profileImage(file)); }
    catch { setNote('无法读取头像，请选择 15 MB 以内的 JPG、PNG 或 WebP。'); }
    finally { setReading(false); }
  }
  async function submit() {
    const maskedPhone = phone ? maskPhone(phone) : profile.maskedPhone;
    if (phone && !maskedPhone) { setNote('请输入有效的 11 位手机号。'); return; }
    setSaving(true); setNote('');
    try { await save({ name: name.trim(), avatar, maskedPhone }); }
    catch { setNote('暂时无法保存资料，请重试。'); }
    finally { setSaving(false); }
  }
  return <Sheet title="编辑个人资料" close={saving ? undefined : close} showClose>
    <div className="profile-photo-edit"><Avatar image={avatar} />
      <label className="btn secondary sm">选择头像<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={reading || saving}
        onChange={event => { const file = event.target.files?.[0]; if (file) void choose(file); }} /></label>
      {avatar && <button className="link" onClick={() => setAvatar(undefined)} disabled={reading || saving}>恢复默认头像</button>}
    </div>
    <label className="field"><input aria-label="昵称" placeholder="昵称" maxLength={30} value={name} onChange={event => setName(event.target.value)} /></label>
    {canEnterPhone && <label className="field"><input type="tel" inputMode="tel" autoComplete="off" aria-label="本机显示手机号"
      placeholder={profile.maskedPhone ?? '登录手机号，仅保存脱敏结果'} value={phone} onChange={event => setPhone(event.target.value)} /></label>}
    {note && <p className="tiny muted" role="status">{note}</p>}
    <SheetButtons cancel={close} action={() => void submit()} label="保存资料" disabled={reading || saving} />
  </Sheet>;
}

export function AccountProfile() {
  const m = useModelContext();
  const [editing, setEditing] = useState(false);
  const key = 'account-profile:' + m.profileScope;
  const queryKey = ['local', 'account-profile', m.profileScope];
  const qc = useQueryClient();
  const { data, isPending } = useQuery({ queryKey, queryFn: async () => await readDataset<Profile>(key) ?? {}, staleTime: Infinity });
  const profile = data ?? {};
  const defaultName = m.demo ? '演示账号' : m.mode === 'ha' ? 'Home Assistant' : '零跑账号';
  const phone = m.demo ? '138****8821' : m.accountMaskedPhone || profile.maskedPhone;
  return <>
    <div className="profile"><button type="button" className="profile-edit" aria-label="编辑个人资料" disabled={isPending} onClick={() => setEditing(true)}>
      <Avatar image={profile.avatar} />
      <span className="profile-name"><b>{profile.name || defaultName}</b>
        <small className="muted">{m.mode === 'ha' ? '只读连接' : '车辆账号' + (phone ? ' · ' + phone : '')}</small>
      </span><Icon name="edit" size={15} />
    </button>{m.expired ? <Link className="link" to="/login">重新登录</Link> : <span className="pill green">已登录</span>}</div>
    {editing && <ProfileEditor key={key} profile={profile} canEnterPhone={m.mode === 'cloud' && !m.accountMaskedPhone}
      close={() => setEditing(false)} save={async next => {
        await saveDataset(key, next);
        qc.setQueryData(queryKey, next);
        setEditing(false);
      }} />}
  </>;
}
