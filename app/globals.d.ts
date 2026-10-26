declare module "*.css";

declare namespace JSX {
  interface IntrinsicElements {
    "s-app-nav": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-page": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      heading?: string;
    };
    "s-section": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      heading?: string;
      subheading?: string;
      slot?: string;
    };
    "s-box": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      background?: string;
      border?: string;
      borderRadius?: string;
      padding?: string;
    };
    "s-grid": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      gridTemplateColumns?: string;
      gap?: string;
    };
    "s-grid-item": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-empty-state": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      heading?: string;
    };
    "s-spinner": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      size?: "small" | "large";
    };
    "s-stack": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      direction?: "block" | "inline";
      distribution?: "start" | "center" | "end" | "space-between" | "space-around" | "stretch";
      gap?: "none" | "xs" | "sm" | "md" | "lg" | "xl";
      wrap?: boolean;
      verticalAlign?: "start" | "center" | "end" | "baseline" | "stretch";
      justify?: "start" | "center" | "end" | "space-between" | "space-around";
    };
    "s-card": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      sectioned?: boolean;
    };
    "s-text": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      variant?: "bodySm" | "bodyMd" | "bodyLg" | "headingSm" | "headingMd" | "headingLg" | "subdued" | "bold";
      as?: "p" | "span" | "div";
    };
    "s-heading": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    };
    "s-button": React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> & {
      primary?: boolean;
      secondary?: boolean;
      plain?: boolean;
      loading?: boolean;
      disabled?: boolean;
      external?: boolean;
      url?: string;
      destructive?: boolean;
      size?: "slim" | "default";
      variant?: "primary" | "secondary" | "plain" | "tertiary";
      tone?: string;
      icon?: string;
    };
    "s-badge": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      status?: "success" | "warning" | "critical" | "info" | "default";
      tone?: "success" | "warning" | "critical" | "info" | "default";
      size?: "small" | "medium";
    };
    "s-banner": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      status?: "info" | "success" | "warning" | "critical";
      tone?: "info" | "success" | "warning" | "critical";
      title?: string;
      heading?: string;
    };
    "s-table": React.DetailedHTMLProps<React.TableHTMLAttributes<HTMLTableElement>, HTMLTableElement>;
    "s-table-head": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-table-body": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-table-row": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-table-head-cell": React.DetailedHTMLProps<React.ThHTMLAttributes<HTMLTableCellElement>, HTMLTableCellElement>;
    "s-table-cell": React.DetailedHTMLProps<React.TdHTMLAttributes<HTMLTableCellElement>, HTMLTableCellElement>;
    "s-unordered-list": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-list-item": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-link": React.DetailedHTMLProps<React.AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement> & {
      external?: boolean;
      url?: string;
    };
    "s-text-field": React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> & {
      label?: string;
      multiline?: boolean;
      rows?: number;
      type?: string;
    };
    "s-select": React.DetailedHTMLProps<React.SelectHTMLAttributes<HTMLSelectElement>, HTMLSelectElement> & {
      label?: string;
    };
    "s-checkbox": React.DetailedHTMLProps<React.InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> & {
      label?: string;
    };
    "s-modal": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
      src?: string;
      title?: string;
      heading?: string;
      open?: boolean;
      onClose?: () => void;
    };
    "s-divider": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>;
    "s-form": React.DetailedHTMLProps<React.FormHTMLAttributes<HTMLFormElement>, HTMLFormElement>;
  }
}
