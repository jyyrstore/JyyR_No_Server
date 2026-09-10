'use client';
import { useState } from 'react';

const permissions = [
  ['numbers:read', 'Read numbers'],
  ['messages:read', 'Read messages'],
  ['webhooks:read', 'Read webhooks'],
  ['webhooks:write', 'Manage webhooks'],
] as const;

export function CreateApiKeyForm(){
  const [name,setName]=useState('');
  const [selected,setSelected]=useState<string[]>(['numbers:read']);
  const [secret,setSecret]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  async function submit(e:React.FormEvent){
    e.preventDefault();setLoading(true);setError('');setSecret('');
    try{
      const r=await fetch('/api/v1/api-keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name,permissions:selected})});
      const j=await r.json();if(!r.ok)throw new Error(j.error??'Failed');
      setSecret(j.apiKey);setName('');setSelected(['numbers:read']);
    }catch(e){setError(e instanceof Error?e.message:'Failed')}finally{setLoading(false)}
  }
  function toggle(permission:string){setSelected((current)=>current.includes(permission)?current.filter((p)=>p!==permission):[...current,permission])}
  return <div className="glass mt-5 rounded-2xl p-5">
    <form onSubmit={submit} className="space-y-4">
      <input className="field" placeholder="Production client" value={name} onChange={e=>setName(e.target.value)} required minLength={2} maxLength={80}/>
      <div><div className="mb-2 text-xs muted">Permissions</div><div className="grid gap-2 sm:grid-cols-2">{permissions.map(([value,label])=><label key={value} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] p-3 text-sm"><input type="checkbox" checked={selected.includes(value)} onChange={()=>toggle(value)}/><span>{label}</span></label>)}</div></div>
      <button className="btn btn-primary" disabled={loading||selected.length===0}>{loading?'Creating…':'Create API key'}</button>
    </form>
    {secret&&<div className="mt-4 rounded-xl border border-purple-400/30 bg-purple-400/10 p-4"><div className="text-xs muted">Copy now — shown only once</div><code className="mt-2 block break-all text-sm text-purple-100">{secret}</code></div>}
    {error&&<p className="mt-3 text-sm text-red-300">{error}</p>}
  </div>
}
