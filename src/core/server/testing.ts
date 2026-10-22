import type { Hono } from "hono";
import { createDisabledAi, type AiClient } from "./ai.js";
import { createCoreContext } from "./bootstrap.js";
import type { AppEnv, CoreContext } from "./context.js";
import { Db, type Migration } from "./db.js";
import { loadEnv, type CoreEnv } from "./env.js";
import { createMemoryMailer } from "./mail.js";
import type { ProductInfo } from "./product.js";

export const TEST_ORIGIN = "http://localhost";

export interface TestContext extends CoreContext {
  mailer: ReturnType<typeof createMemoryMailer>;
  clock: { set(d: Date | string): void; advance(ms: number): void };
}

export function createTestContext(opts: {
  product: ProductInfo;
  migrations: Migration[];
  ai?: AiClient;
  env?: Partial<CoreEnv>;
}): TestContext {
  let current = new Date("2026-10-20T09:00:00.000Z");
  const env: CoreEnv = {
    ...loadEnv({ NODE_ENV: "test", APP_URL: TEST_ORIGIN }, { port: 0, dataDir: "/tmp/unused" }),
    ...opts.env,
  };
  const mailer = createMemoryMailer();
  const ctx = createCoreContext({
    env,
    product: opts.product,
    migrations: opts.migrations,
    db: new Db(":memory:"),
    mailer,
    ai: opts.ai ?? createDisabledAi(),
    stripe: null,
    now: () => current,
  });
  return {
    ...ctx,
    mailer,
    clock: {
      set: (d) => {
        current = new Date(d);
      },
      advance: (ms) => {
        current = new Date(current.getTime() + ms);
      },
    },
  };
}

export interface TestResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** A browser-like client for `app.request` that keeps cookies and sends a same-origin Origin header. */
export class TestClient {
  private cookies = new Map<string, string>();

  constructor(private app: Hono<AppEnv>) {}

  async request<T = any>(method: string, path: string, data?: unknown, headers: Record<string, string> = {}): Promise<TestResponse<T>> {
    const h: Record<string, string> = { Origin: TEST_ORIGIN, ...headers };
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    let reqBody: BodyInit | undefined;
    if (data instanceof FormData) reqBody = data;
    else if (data !== undefined) {
      h["Content-Type"] = "application/json";
      reqBody = JSON.stringify(data);
    }
    const res = await this.app.request(path, { method, headers: h, body: reqBody });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()) || /expires=Thu, 01 Jan 1970/i.test(a.trim()));
      if (!value || expired) this.cookies.delete(name.trim());
      else this.cookies.set(name.trim(), value);
    }
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get<T = any>(path: string, headers?: Record<string, string>) {
    return this.request<T>("GET", path, undefined, headers);
  }
  post<T = any>(path: string, data?: unknown, headers?: Record<string, string>) {
    return this.request<T>("POST", path, data ?? {}, headers);
  }
  patch<T = any>(path: string, data?: unknown) {
    return this.request<T>("PATCH", path, data ?? {});
  }
  put<T = any>(path: string, data?: unknown) {
    return this.request<T>("PUT", path, data ?? {});
  }
  delete<T = any>(path: string) {
    return this.request<T>("DELETE", path);
  }

  async signup(over: Partial<{ name: string; email: string; password: string; orgName: string }> = {}) {
    const res = await this.post("/api/auth/signup", {
      name: "Dana Builder",
      email: `dana${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: "correct horse battery",
      orgName: "Builder Electric",
      ...over,
    });
    if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }
}
