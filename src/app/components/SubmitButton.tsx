"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ disabled = false }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50"
    >
      {pending ? "生成中..." : "短縮URLを作成"}
    </button>
  );
}
