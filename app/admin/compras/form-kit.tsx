"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { emptyActionState, type ActionState } from "../../../lib/actions";
import { compressPhoto } from "./compress-photo";

/**
 * Submits a form to a server action WITHOUT React's automatic form reset, so a
 * validation error never wipes what was typed on the phone. `prepare` can add
 * fields (the compressed photo); `onSuccess` decides what to clear. The page
 * data is refreshed in place (no full reload, scroll and open forms survive).
 */
export function useActionForm<S extends ActionState>(
  action: (state: S, formData: FormData) => Promise<S>,
  options: { prepare?: (formData: FormData) => void; onSuccess?: (state: S, form: HTMLFormElement) => void } = {},
) {
  const router = useRouter();
  const [state, setState] = useState<S>(emptyActionState as S);
  const [pending, startTransition] = useTransition();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    options.prepare?.(formData);
    startTransition(async () => {
      let next: S;
      try {
        next = await action(emptyActionState as S, formData);
      } catch {
        next = { ...(emptyActionState as S), error: "No hubo conexión con el servidor. Revisa tu señal e intenta de nuevo." };
      }
      setState(next);
      if (next.success) {
        options.onSuccess?.(next, form);
        router.refresh();
      }
    });
  };

  const reset = useCallback(() => setState(emptyActionState as S), []);
  return { state, pending, onSubmit, reset };
}

/** One optional photo: compressed in the browser as soon as it is picked. */
export function usePhoto() {
  const [current, setCurrent] = useState<{ photo: File; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<string | null>(null);

  const replace = useCallback((photo: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = photo ? URL.createObjectURL(photo) : null;
    setCurrent(photo && previewRef.current ? { photo, preview: previewRef.current } : null);
  }, []);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const pick = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setError(null);
      setBusy(true);
      try {
        replace(await compressPhoto(file));
      } catch (problem) {
        replace(null);
        setError(problem instanceof Error ? problem.message : "No pudimos preparar esa foto.");
      } finally {
        setBusy(false);
      }
    },
    [replace],
  );

  const clear = useCallback(() => {
    replace(null);
    setError(null);
  }, [replace]);

  const photo = current?.photo ?? null;
  /** Adds the compressed photo (if any) to the outgoing form data. */
  const attach = useCallback(
    (formData: FormData) => {
      formData.delete("photo");
      if (photo) formData.set("photo", photo, photo.name);
    },
    [photo],
  );

  return { photo, preview: current?.preview ?? null, busy, error, pick, clear, attach };
}

const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

const GalleryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 18 5-5 4 4 3-3 4 4" strokeLinejoin="round" />
  </svg>
);

/**
 * Two ways in: the camera directly (capture="environment") or the gallery. The
 * file inputs have no `name`: the original multi-MB file is never sent, only
 * the compressed copy that `usePhoto().attach` adds.
 */
export function PhotoField({
  idPrefix,
  label,
  state,
  existingUrl,
  existingLabel,
  hasExisting = false,
  removeName,
  hint,
}: {
  idPrefix: string;
  label: string;
  state: ReturnType<typeof usePhoto>;
  existingUrl?: string | null;
  existingLabel?: string;
  hasExisting?: boolean;
  /** When set and there is an existing photo, shows a "quitar foto" checkbox with this field name. */
  removeName?: string;
  hint?: string;
}) {
  const shown = state.preview ?? existingUrl ?? null;
  return (
    <div className="field shopper-photo-field">
      <span>{label}</span>
      <div className="shopper-photo-row">
        <div className="shopper-photo-preview" aria-live="polite">
          {state.busy ? (
            <small>Preparando…</small>
          ) : shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" />
          ) : (
            <small>{existingLabel ?? "Sin foto"}</small>
          )}
        </div>
        <div className="shopper-photo-actions">
          <label className="button button-secondary button-small shopper-photo-button" htmlFor={`${idPrefix}-camera`}>
            <CameraIcon /> Tomar foto
          </label>
          <input
            id={`${idPrefix}-camera`}
            className="sr-only"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              void state.pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <label className="button button-secondary button-small shopper-photo-button" htmlFor={`${idPrefix}-gallery`}>
            <GalleryIcon /> Galería
          </label>
          <input
            id={`${idPrefix}-gallery`}
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={(event) => {
              void state.pick(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {state.photo ? (
            <button type="button" className="shopper-link-button" onClick={state.clear}>
              Quitar foto nueva
            </button>
          ) : null}
        </div>
      </div>
      {removeName && hasExisting && !state.photo ? (
        <label className="admin-switch" htmlFor={`${idPrefix}-remove`}>
          <input id={`${idPrefix}-remove`} type="checkbox" name={removeName} />
          <span>Quitar la foto guardada</span>
        </label>
      ) : null}
      {state.error ? (
        <small className="shopper-field-error" role="alert">
          {state.error}
        </small>
      ) : hint ? (
        <small className="admin-field-note">{hint}</small>
      ) : null}
    </div>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="form-message form-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="form-message form-success" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}
