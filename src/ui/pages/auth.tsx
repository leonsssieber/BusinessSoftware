import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Check } from "lucide-react";
import { api, ApiError, errorMessage } from "../api";
import { useAuth, type Session } from "../auth";
import type { Brand } from "../brand";
import { Button, ButtonLink } from "../components/button";
import { Alert, PageLoader } from "../components/display";
import { Field, Input } from "../components/form";
import { useDocumentTitle } from "../hooks";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

function AuthLayout({ brand, title, subtitle, children, aside }: { brand: Brand; title: string; subtitle?: ReactNode; children: ReactNode; aside?: boolean }) {
  useDocumentTitle(title, brand.name);
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div
        className="flex flex-col py-8"
        style={{ paddingLeft: "max(16px, env(safe-area-inset-left))", paddingRight: "max(16px, env(safe-area-inset-right))" }}
      >
        <Link to="/" className="mx-auto w-full max-w-sm">
          {brand.logo}
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-muted">{subtitle}</p> : null}
          <div className="mt-7">{children}</div>
        </div>
      </div>
      <div className="hidden border-l border-line bg-surface-2 lg:flex lg:items-center">
        <div className="mx-auto max-w-md px-10">
          <p className="font-display text-3xl leading-tight font-semibold">{brand.tagline}</p>
          {aside !== false ? (
            <ul className="mt-8 flex flex-col gap-4">
              {brand.pitch.map((p) => (
                <li key={p} className="flex gap-3 text-fg/90">
                  <Check className="mt-1 size-4 shrink-0 text-brand-ink" aria-hidden="true" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LoginPage({ brand }: { brand: Brand }) {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      setSession(await api.post<Session>("/api/auth/login", { email, password }));
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout brand={brand} title="Sign in" subtitle={<>New here? <Link className="font-medium text-brand-ink underline-offset-2 hover:underline" to={`/signup${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`}>Create an account</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" loading={pending} className="mt-1 w-full">
          Sign in
        </Button>
        <Link to="/forgot-password" className="text-center text-sm text-muted hover:text-fg">
          Forgot your password?
        </Link>
      </form>
    </AuthLayout>
  );
}

export function SignupPage({ brand, companyLabel = "Company name" }: { brand: Brand; companyLabel?: string }) {
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("invite");
  const [form, setForm] = useState({ name: "", orgName: "", email: "", password: "" });
  const [invite, setInvite] = useState<{ orgName: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!inviteToken) return;
    api
      .get<{ orgName: string; email: string }>(`/api/invites/${encodeURIComponent(inviteToken)}`)
      .then((info) => {
        setInvite(info);
        setForm((f) => ({ ...f, email: info.email }));
      })
      .catch((err) => setError(errorMessage(err)));
  }, [inviteToken]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const session = await api.post<Session>("/api/auth/signup", {
        ...form,
        ...(inviteToken ? { inviteToken } : {}),
      });
      setSession(session);
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Array.isArray((err.details as any)?.fields)) {
        const map: Record<string, string> = {};
        for (const f of (err.details as any).fields) map[f.path] = f.message;
        setFieldErrors(map);
      }
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <AuthLayout
      brand={brand}
      title={invite ? `Join ${invite.orgName}` : "Create your account"}
      subtitle={
        <>
          Already have an account?{" "}
          <Link className="font-medium text-brand-ink underline-offset-2 hover:underline" to="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Field label="Your name" error={fieldErrors.name}>
          {(id) => <Input id={id} autoComplete="name" required value={form.name} onChange={set("name")} />}
        </Field>
        {!invite ? (
          <Field label={companyLabel} error={fieldErrors.orgName}>
            {(id) => <Input id={id} autoComplete="organization" value={form.orgName} onChange={set("orgName")} />}
          </Field>
        ) : null}
        <Field label="Work email" error={fieldErrors.email}>
          {(id) => <Input id={id} type="email" autoComplete="email" required value={form.email} onChange={set("email")} readOnly={Boolean(invite)} />}
        </Field>
        <Field label="Password" hint="At least 10 characters." error={fieldErrors.password}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" required value={form.password} onChange={set("password")} />}
        </Field>
        <Button type="submit" loading={pending} className="mt-1 w-full">
          {invite ? "Create account and join" : "Create account"}
        </Button>
        <p className="text-center text-xs text-muted">Free plan, no card needed.</p>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage({ brand }: { brand: Brand }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post("/api/auth/password/forgot", { email });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout brand={brand} title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      {sent ? (
        <Alert tone="good" title="Check your email">
          If an account exists for {email}, a reset link is on its way. It works for one hour.
        </Alert>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {error ? <Alert tone="bad">{error}</Alert> : null}
          <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Button type="submit" loading={pending} className="w-full">
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="text-muted hover:text-fg">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPasswordPage({ brand }: { brand: Brand }) {
  const [params] = useSearchParams();
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const token = params.get("token") ?? "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      setSession(await api.post<Session>("/api/auth/password/reset", { token, password }));
      navigate("/app", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthLayout brand={brand} title="Choose a new password">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {!token ? <Alert tone="bad">This link is incomplete. Open the link from your email again.</Alert> : null}
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Field label="New password" hint="At least 10 characters.">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Repeat new password">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        <Button type="submit" loading={pending} disabled={!token} className="w-full">
          Save password and sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export function AcceptInvitePage({ brand }: { brand: Brand }) {
  const { token = "" } = useParams();
  const { session, setSession } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ orgName: string; email: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api
      .get<{ orgName: string; email: string }>(`/api/invites/${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch((err) => setError(errorMessage(err)));
  }, [token]);

  if (!info && !error) return <PageLoader />;

  return (
    <AuthLayout brand={brand} title={info ? `Join ${info.orgName}` : "Invite"} aside={false}>
      {error ? (
        <Alert tone="bad">{error}</Alert>
      ) : session ? (
        <div className="flex flex-col gap-4">
          <p>
            Accept as <strong>{session.user.email}</strong>?
          </p>
          <Button
            loading={pending}
            onClick={async () => {
              setPending(true);
              try {
                setSession(await api.post<Session>(`/api/invites/${encodeURIComponent(token)}/accept`));
                navigate("/app", { replace: true });
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setPending(false);
              }
            }}
          >
            Accept invite
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-muted">This invite is for {info?.email}.</p>
          <ButtonLink to={`/signup?invite=${encodeURIComponent(token)}`}>Create an account</ButtonLink>
          <ButtonLink variant="secondary" to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
            I already have an account
          </ButtonLink>
        </div>
      )}
    </AuthLayout>
  );
}
