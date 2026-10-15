import { useEffect, useRef, useState } from 'react';
import type { Profile } from './domain';
import { sessionHeaders } from './session';
import { ActionButton } from './UiControls';

type Account = { id: string; company: Profile | null; revision: number; identity: 'guest'; authority: 'unverified'; esia: 'not_configured'; canSubmitApplications: false };
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const mutation = useRef(false);
  const request = async (path = '', method = 'GET', body?: unknown): Promise<Account> => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
    const response = await fetch('/api/account' + path, { method, headers: { ...sessionHeaders(), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: controller.signal });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Нет связи с сервером.'); return data;
    } finally { clearTimeout(timer); }
  };
  const refresh = async () => {
    if (mutation.current) return;
    const version = ++generation.current; setLoading(true);
    try { const next = await request(); if (version === generation.current) { setAccount(next); setError(''); } }
    catch (e) { if (version === generation.current) setError(e instanceof Error ? e.message : 'Нет связи с сервером.'); }
    finally { if (version === generation.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, []);
  const update = async (method: string, company?: Profile) => {
    if (mutation.current) throw new Error('Дождитесь сохранения профиля.');
    mutation.current = true; generation.current++; setLoading(true);
    try {
      const next = await request('/company', method, company ? { company, revision: account?.revision } : undefined);
      setAccount(next); setError(''); return next;
    } catch (error) { setError(error instanceof Error ? error.message : 'ACCOUNT_UPDATE_FAILED'); throw error; }
    finally { mutation.current = false; setLoading(false); }
  };
  return { account, error, loading, refresh,
    save: (company: Profile) => update('PUT', company),
    remove: () => update('DELETE') };
}
export function AccountPanel({ state, onRestore, onSave, hasCompany }: { state: ReturnType<typeof useAccount>; onRestore: (profile: Profile) => void; onSave: () => void; hasCompany: boolean }) {
  return <section className="profile-panel account-panel">
    <h3>Гостевая сессия</h3>
    <p>{state.account?.company ? 'Компания сохранена на сервере для этого браузера.' : state.account ? 'Профиль хранится на этом устройстве; его можно сохранить на сервере для этого браузера.' : state.loading ? 'Подключаемся к серверу.' : 'Профиль хранится на этом устройстве.'}</p>
    {state.error && !state.account && <ActionButton className="secondary" disabled={state.loading} onClick={() => void state.refresh()}>Повторить подключение</ActionButton>}
    {state.account && hasCompany && !state.account.company && <ActionButton className="secondary" disabled={state.loading} onClick={onSave}>{state.error ? 'Повторить сохранение' : 'Сохранить компанию на сервере'}</ActionButton>}
    {state.account?.company && !hasCompany && <ActionButton className="secondary" onClick={() => onRestore(state.account!.company!)}>Загрузить сохранённую компанию</ActionButton>}
  </section>;
}
