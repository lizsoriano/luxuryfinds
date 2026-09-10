"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";

/**
 * GET form that re-runs the server query as you type (400 ms debounce) and
 * immediately when a select/checkbox changes. Filtering stays server-side —
 * lists are paginated in the database, so there is nothing to filter in memory —
 * and the form still works with JavaScript disabled through its submit button.
 */
export function FilterForm({
  action,
  children,
  className = "admin-toolbar",
  delay = 400,
}: {
  action: string;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const submitNow = () => {
    if (timer.current) clearTimeout(timer.current);
    formRef.current?.requestSubmit();
  };

  const handleInput = (event: FormEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    const isFreeText =
      target instanceof HTMLInputElement && ["text", "search", "number", "date"].includes(target.type);
    if (!isFreeText) {
      submitNow();
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(submitNow, delay);
  };

  return (
    <form ref={formRef} method="get" action={action} className={className} onInput={handleInput}>
      {children}
    </form>
  );
}
