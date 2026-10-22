import { useEffect, useState, type FormEvent } from "react";
import { NavLink, Outlet, useSearchParams } from "react-router";
import { Check, Trash2, UserPlus } from "lucide-react";
import { api, errorMessage } from "../api";
import { useAuth, useSession, type Session } from "../auth";
import { Button } from "../components/button";
import { Alert, Badge, Card, CardHeader, PageHeader, PageLoader, Table, TD, TH } from "../components/display";
import { Field, Input, Select } from "../components/form";
import { useToast } from "../components/toast";
import { cn } from "../cn";
import { date, money } from "../format";
import { useResource } from "../hooks";

export function SettingsLayout({ extraTabs = [] }: { extraTabs?: { to: string; label: string }[] }) {
  const tabs = [
    { to: "/app/settings", label: "Profile", end: true },
    ...extraTabs.map((t) => ({ ...t, end: false })),
    { to: "/app/settings/team", label: "Team", end: false },
    { to: "/app/settings/billing", label: "Plan & billing", end: false },
  ];
  return (
    <div>
      <PageHeader title="Settings" />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Settings">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
                isActive ? "border-brand text-fg" : "border-transparent text-muted hover:text-fg",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

type ThemeChoice = "system" | "light" | "dark";

export function applyStoredTheme() {
  try {
    const t = localStorage.getItem("theme") as ThemeChoice | null;
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  } catch {
    /* storage unavailable */
  }
}

export function ProfileSettings() {
  const session = useSession();
  const { setSession } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(session.user.name);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pending, setPending] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(() => {
    try {
      return (localStorage.getItem("theme") as ThemeChoice) || "system";
    } catch {
      return "system";
    }
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Profile" />
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setPending("name");
            try {
              setSession(await api.patch<Session>("/api/auth/me", { name }));
              toast.success("Profile saved.");
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setPending(null);
            }
          }}
        >
          <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Email" hint="Contact support to change your sign-in email.">
            {(id) => <Input id={id} value={session.user.email} readOnly />}
          </Field>
          <div>
            <Button type="submit" loading={pending === "name"}>
              Save profile
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Password" />
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            setPending("pw");
            try {
              await api.post("/api/auth/password/change", pw);
              setPw({ current: "", next: "" });
              toast.success("Password changed. Other devices were signed out.");
            } catch (err) {
              toast.error(errorMessage(err));
            } finally {
              setPending(null);
            }
          }}
        >
          <Field label="Current password">
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />}
          </Field>
          <Field label="New password" hint="At least 10 characters.">
            {(id) => <Input id={id} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />}
          </Field>
          <div>
            <Button type="submit" variant="secondary" loading={pending === "pw"}>
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Appearance" />
        <div className="p-5">
          <Field label="Theme">
            {(id) => (
              <Select
                id={id}
                value={theme}
                onChange={(e) => {
                  const t = e.target.value as ThemeChoice;
                  setTheme(t);
                  try {
                    if (t === "system") localStorage.removeItem("theme");
                    else localStorage.setItem("theme", t);
                  } catch {
                    /* storage unavailable */
                  }
                  applyStoredTheme();
                }}
              >
                <option value="system">Match my device</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            )}
          </Field>
        </div>
      </Card>
    </div>
  );
}

interface TeamData {
  org: { id: string; name: string };
  members: { userId: string; name: string; email: string; role: string; joinedAt: string }[];
  invites: { id: string; email: string; role: string; createdAt: string; expiresAt: string }[];
  seats: { used: number; limit: number | null };
}

export function TeamSettings() {
  const session = useSession();
  const toast = useToast();
  const team = useResource<TeamData>("/api/org");
  const [invite, setInvite] = useState({ email: "", role: "member" });
  const [orgName, setOrgName] = useState(session.org.name);
  const [pending, setPending] = useState<string | null>(null);
  const { refresh } = useAuth();
  const canManage = session.role === "owner" || session.role === "admin";

  if (team.loading && !team.data) return <PageLoader />;
  if (team.error || !team.data) return <Alert tone="bad">{team.error ?? "Could not load your team."}</Alert>;
  const { members, invites, seats } = team.data;
  const full = seats.limit !== null && seats.used >= seats.limit;

  return (
    <div className="flex flex-col gap-6">
      {canManage ? (
        <Card>
          <CardHeader title="Company" />
          <form
            className="flex flex-wrap items-end gap-3 p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending("org");
              try {
                await api.patch("/api/org", { name: orgName });
                await refresh();
                toast.success("Company name saved.");
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setPending(null);
              }
            }}
          >
            <Field label="Company name" className="min-w-60 flex-1">
              {(id) => <Input id={id} value={orgName} onChange={(e) => setOrgName(e.target.value)} />}
            </Field>
            <Button type="submit" variant="secondary" loading={pending === "org"}>
              Save
            </Button>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Team members"
          description={seats.limit === null ? `${seats.used} people` : `${seats.used} of ${seats.limit} seats used`}
        />
        <Table>
          <thead>
            <tr>
              <TH>Name</TH>
              <TH>Role</TH>
              <TH>Joined</TH>
              <TH className="w-10">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <TD>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted">{m.email}</p>
                </TD>
                <TD>
                  <Badge tone={m.role === "owner" ? "brand" : "neutral"}>{m.role}</Badge>
                </TD>
                <TD className="text-muted">{date(m.joinedAt)}</TD>
                <TD>
                  {canManage && m.userId !== session.user.id && m.role !== "owner" ? (
                    <button
                      type="button"
                      className="rounded-ui p-1.5 text-muted hover:bg-bad-soft hover:text-bad"
                      aria-label={`Remove ${m.name}`}
                      onClick={async () => {
                        try {
                          await api.delete(`/api/org/members/${m.userId}`);
                          toast.success(`${m.name} was removed.`);
                          await team.reload();
                        } catch (err) {
                          toast.error(errorMessage(err));
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </TD>
              </tr>
            ))}
            {invites.map((i) => (
              <tr key={i.id}>
                <TD>
                  <p className="font-medium">{i.email}</p>
                  <p className="text-xs text-muted">Invite sent {date(i.createdAt)}</p>
                </TD>
                <TD>
                  <Badge tone="warn">invited</Badge>
                </TD>
                <TD className="text-muted">Expires {date(i.expiresAt)}</TD>
                <TD>
                  {canManage ? (
                    <button
                      type="button"
                      className="rounded-ui p-1.5 text-muted hover:bg-bad-soft hover:text-bad"
                      aria-label={`Cancel invite for ${i.email}`}
                      onClick={async () => {
                        await api.delete(`/api/org/invites/${i.id}`);
                        await team.reload();
                      }}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </TD>
              </tr>
            ))}
          </tbody>
        </Table>
        {canManage ? (
          <form
            className="flex flex-wrap items-end gap-3 border-t border-line p-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending("invite");
              try {
                await api.post("/api/org/invites", invite);
                toast.success(`Invite sent to ${invite.email}.`);
                setInvite({ email: "", role: "member" });
                await team.reload();
              } catch (err) {
                toast.error(errorMessage(err));
              } finally {
                setPending(null);
              }
            }}
          >
            <Field label="Invite by email" className="min-w-60 flex-1">
              {(id) => <Input id={id} type="email" placeholder="teammate@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />}
            </Field>
            <Field label="Role">
              {(id) => (
                <Select id={id} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
              )}
            </Field>
            <Button type="submit" icon={<UserPlus className="size-4" />} loading={pending === "invite"} disabled={full || !invite.email}>
              Send invite
            </Button>
            {full ? <p className="w-full text-sm text-muted">All seats are in use. Upgrade your plan to invite more people.</p> : null}
          </form>
        ) : null}
      </Card>
    </div>
  );
}

interface BillingPlan {
  id: string;
  name: string;
  monthly: number;
  yearly: number;
  description: string;
  features: string[];
  highlighted?: boolean;
  purchasable: { month: boolean; year: boolean };
}

interface BillingData {
  plan: string;
  status: string;
  interval: string | null;
  periodEnd: string | null;
  hasSubscription: boolean;
  stripeEnabled: boolean;
  devPlanSwitch: boolean;
  plans: BillingPlan[];
  trialDays: number;
}

export function BillingSettings() {
  const session = useSession();
  const { refresh } = useAuth();
  const toast = useToast();
  const billing = useResource<BillingData>("/api/billing");
  const [period, setPeriod] = useState<"month" | "year">("month");
  const [pending, setPending] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const canManage = session.role === "owner" || session.role === "admin";

  useEffect(() => {
    const status = params.get("checkout");
    if (status === "success") {
      toast.success("Thanks! Your plan is active.");
      void refresh();
      void billing.reload();
    }
    if (status) setParams({}, { replace: true });
  }, []);

  if (billing.loading && !billing.data) return <PageLoader />;
  if (billing.error || !billing.data) return <Alert tone="bad">{billing.error ?? "Could not load billing."}</Alert>;
  const b = billing.data;

  async function choose(planId: string) {
    setPending(planId);
    try {
      if (b.devPlanSwitch) {
        await api.post("/api/billing/dev-plan", { plan: planId });
        await Promise.all([refresh(), billing.reload()]);
        toast.success("Plan switched (development mode, no charge).");
        return;
      }
      if (b.hasSubscription) {
        const { url } = await api.post<{ url: string }>("/api/billing/portal");
        window.location.href = url;
        return;
      }
      const { url } = await api.post<{ url: string }>("/api/billing/checkout", { plan: planId, interval: period });
      window.location.href = url;
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {b.devPlanSwitch ? (
        <Alert tone="info" title="Development mode">
          Stripe isn't configured, so plan buttons switch plans instantly without charging. Set STRIPE_SECRET_KEY and price ids to sell plans.
        </Alert>
      ) : null}
      {b.status === "past_due" ? (
        <Alert tone="warn" title="Payment failed">
          Update your card in Manage billing to keep your plan.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted">
          You're on the <strong className="text-fg capitalize">{b.plan}</strong> plan
          {b.periodEnd ? <> · renews {date(b.periodEnd)}</> : null}.
        </p>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-ui border border-line bg-surface p-0.5 text-sm" role="group" aria-label="Billing period">
            {(["month", "year"] as const).map((i) => (
              <button
                key={i}
                type="button"
                aria-pressed={period === i}
                onClick={() => setPeriod(i)}
                className={cn("rounded-[calc(var(--k-radius)-2px)] px-3 py-1.5", period === i ? "bg-brand text-brand-fg" : "text-muted hover:text-fg")}
              >
                {i === "month" ? "Monthly" : "Yearly · 2 months free"}
              </button>
            ))}
          </div>
          {b.hasSubscription && canManage ? (
            <Button variant="secondary" loading={pending === "portal"} onClick={() => choose("portal")}>
              Manage billing
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {b.plans.map((p) => {
          const current = p.id === b.plan;
          const price = period === "month" ? p.monthly : p.yearly;
          return (
            <Card key={p.id} className={cn("flex flex-col p-5", p.highlighted && !current && "border-brand/50 ring-1 ring-brand/30")}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {current ? <Badge tone="brand">Current plan</Badge> : p.highlighted ? <Badge tone="good">Most popular</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">{p.description}</p>
              <p className="mt-4 font-display text-3xl font-semibold tabular">
                {price === 0 ? "Free" : money(price, { whole: true })}
                {price ? <span className="text-base font-normal text-muted">/{period === "month" ? "mo" : "yr"}</span> : null}
              </p>
              <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {canManage && !current && p.monthly > 0 ? (
                <Button
                  className="mt-5 w-full"
                  variant={p.highlighted ? "primary" : "secondary"}
                  loading={pending === p.id}
                  disabled={!b.devPlanSwitch && !b.hasSubscription && !p.purchasable[period]}
                  onClick={() => choose(p.id)}
                >
                  {b.hasSubscription ? "Switch plan" : b.trialDays ? `Start ${b.trialDays}-day trial` : `Upgrade to ${p.name}`}
                </Button>
              ) : null}
            </Card>
          );
        })}
      </div>
      {!canManage ? <p className="text-sm text-muted">Ask an admin on your team to change the plan.</p> : null}
    </div>
  );
}
