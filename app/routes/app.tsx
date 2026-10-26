import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useLocation, useRouteError, Link } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import "../styles/stockpilot.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

const navItems = [
  { label: "Dashboard", description: "Store overview", to: "/app", icon: "grid" },
  { label: "Suppliers", description: "Vendor directory", to: "/app/suppliers", icon: "users" },
  { label: "Reorder planning", description: "Restock priorities", to: "/app/reorder", icon: "refresh" },
  { label: "Purchase orders", description: "Order workflow", to: "/app/purchase-orders", icon: "clipboard" },
] as const;

function NavIcon({ name }: { name: (typeof navItems)[number]["icon"] }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 5v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 19v-4h-4" /></>,
    clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 10h6M9 14h4" /></>,
  };
  return <svg className="sp-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{paths[name]}</svg>;
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        {navItems.map((item) => <s-link key={item.to} href={item.to}>{item.label}</s-link>)}
      </s-app-nav>
      <div className="sp-app-shell">
        <header className="sp-app-header">
          <Link to="/app" className="sp-brand" aria-label="StockPilot home">
            <span className="sp-brand-mark"><NavIcon name="grid" /></span>
            <span><strong>StockPilot</strong><small>Inventory intelligence</small></span>
          </Link>
          <nav className="sp-primary-nav" aria-label="Main navigation">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to || (item.to !== "/app" && location.pathname.startsWith(item.to));
              return <Link key={item.to} to={item.to} reloadDocument className={`sp-primary-nav-item ${isActive ? "active" : ""}`} aria-current={isActive ? "page" : undefined}>
                <NavIcon name={item.icon} /><span><strong>{item.label}</strong><small>{item.description}</small></span>
              </Link>;
            })}
          </nav>
          <div className="sp-header-status"><span className="sp-status-dot" /> Live store sync</div>
        </header>
        <main className="sp-app-content"><Outlet /></main>
      </div>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
