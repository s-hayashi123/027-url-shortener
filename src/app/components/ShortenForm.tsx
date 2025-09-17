"use client";

import { SubmitButton } from "./SubmitButton";
import { createShortLink } from "../action";
import { useActionState } from "react";

type CreateShortLinkState = {
  message: string;
  shortId?: string;
  retry?: boolean;
};

export function ShortenForm({ disabled = false }: { disabled?: boolean }) {
  const [state, formAction] = useActionState<CreateShortLinkState, FormData>(
    createShortLink,
    { message: "" }
  );
  const shortHref = state?.shortId ? `/${state.shortId}` : "";
  return (
    <form action={formAction} className="flex w-full max-w-xl flex-col gap-3">
      <input
        type="url"
        name="url"
        required
        placeholder="https://example.com/article"
        className="w-full rounded-md border px-3 py-2"
        disabled={disabled}
      />
      <SubmitButton disabled={disabled} />
      {state?.message && (
        <p className="text-sm text-gray-600">{state.message}</p>
      )}
      {state?.shortId && (
        <p className="text-sm">
          <a className="text-blue-600 underline" href={shortHref}>
            {shortHref}
          </a>
        </p>
      )}
    </form>
  );
}
