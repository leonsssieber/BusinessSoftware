import type { CoreContext } from "@core/server/context";
import { createCoreApp } from "@core/server/http";
import { miscRoutes } from "./routes/misc";
import { orderRoutes } from "./routes/orders";
import { portalRoutes } from "./routes/portal";
import { rfqRoutes } from "./routes/rfqs";
import { supplierRoutes } from "./routes/suppliers";

export function buildQuoteRunnerApp(ctx: CoreContext, staticRoot: string | null = null) {
  return createCoreApp({
    ctx,
    staticRoot,
    csrfExempt: ["/api/portal", "/api/inbound", "/api/tools"],
    largeBodyPaths: ["/api/rfqs/", "/api/inbound"],
    adminStats: (c) => ({
      requests: c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM rfqs")?.n ?? 0,
      quotes: c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM quotes")?.n ?? 0,
      suppliers: c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM suppliers")?.n ?? 0,
      purchaseOrders: c.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM purchase_orders")?.n ?? 0,
    }),
    routes: (api) => {
      api.route("/suppliers", supplierRoutes());
      api.route("/rfqs", rfqRoutes());
      api.route("/orders", orderRoutes());
      api.route("/portal", portalRoutes());
      api.route("/", miscRoutes());
    },
  });
}
