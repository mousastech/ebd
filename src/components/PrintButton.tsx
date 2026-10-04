"use client";

export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button type="button" className="ghost small noprint" onClick={() => window.print()}>
      {label}
    </button>
  );
}
