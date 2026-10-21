import { useEffect, useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Button, Field } from '../components/UI.jsx';

export function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    api('/api/auth/demo-mode').then((result) => {
      setDemoMode(result.enabled);
      if (result.enabled) setEmail(result.email);
      if (result.enabled) setPassword(result.password);
      else { setEmail(''); setPassword(''); }
    }).catch(() => {});
  }, []);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api('/api/auth/login', { method: 'POST', json: { email, password } });
      onLogin(result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-card">
        <div className="brand-lockup brand-login"><span className="brand-mark"><Sparkles size={20} /></span><span>Athena<span className="brand-dot">.</span>id</span></div>
        <p className="eyebrow">Growth workspace</p>
        <h1>Welcome back</h1>
        <p className="login-intro">Sign in to review campaigns, leads, and branch performance.</p>
        {error && <Alert>{error}</Alert>}
        <form className="form-stack" onSubmit={submit}>
          <Field label="Work email">
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={200} />
          </Field>
          <Button type="submit" loading={loading} icon={ArrowRight} className="button-full">Sign in</Button>
        </form>
        {demoMode && <div className="demo-credentials">
          <span className="demo-dot" />
          <div><strong>Synthetic demo workspace</strong><span>Development only · {email}</span></div>
        </div>}
      </section>
      <div className="login-footer">Athena.id · Clinic growth analytics</div>
    </main>
  );
}
