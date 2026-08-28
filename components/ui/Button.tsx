import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary" | "accent" | "danger";
  size?: "default" | "small";
  fullWidth?: boolean;
  href?: string;
};

export function Button({ children, variant = "primary", size = "default", fullWidth, href, className = "", ...props }: Props) {
  const classes = `button button-${variant} ${size === "small" ? "button-small" : ""} ${fullWidth ? "button-full" : ""} ${className}`;
  if (href) return <Link className={classes} href={href}>{children}</Link>;
  return <button className={classes} {...props}>{children}</button>;
}
