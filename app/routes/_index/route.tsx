import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData?.errors;

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>StockPilot — Intelligent Inventory & Procurement</h1>
        <p className={styles.text}>
          Autonomous stockout prevention, AI-driven demand analytics, and streamlined purchase order workflows for high-growth Shopify merchants.
        </p>
        {showForm && (
          <Form className={styles.form} method="post">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-shop-domain.myshopify.com"
              />
              <span style={{ fontSize: "12px", color: errors?.shop ? "#d72c0d" : "#6d7175" }}>
                {errors?.shop ?? "Enter your myshopify.com store domain to log in"}
              </span>
            </label>
            <button className={styles.button} type="submit">
              Log in to StockPilot
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Stockout Prevention</strong>. Proactive demand velocity tracking alerts you before critical inventory runs out.
          </li>
          <li>
            <strong>Supplier & Catalog Management</strong>. Configure vendor lead times, minimum order quantities, and unit cost catalogs.
          </li>
          <li>
            <strong>AI Insights & 1-Click POs</strong>. Understand demand anomalies with Groq AI and generate purchase orders grouped by vendor in one click.
          </li>
        </ul>
      </div>
    </div>
  );
}
