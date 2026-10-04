"use client";

import { useRef, useState } from "react";

/**
 * Escolha de foto com redução no próprio aparelho (máx. 512 px, JPEG): envia arquivos leves mesmo
 * quando a foto vem direto da câmera do celular.
 */
export function PhotoInput({
  name, label = "Escolher foto", maxSide = 512, capture = "user", required = true,
}: { name: string; label?: string; maxSide?: number; capture?: "user" | "environment"; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !f.type.startsWith("image/")) return;
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
      if (!blob) return;
      const small = new File([blob], "foto.jpg", { type: "image/jpeg" });
      const dt = new DataTransfer();
      dt.items.add(small);
      e.target.files = dt.files;
      setPreview(URL.createObjectURL(blob));
    } catch {
      setPreview(URL.createObjectURL(f)); // sem suporte: envia o original
    }
  }

  return (
    <div className="photo-input">
      {preview && <img src={preview} alt="Pré-visualização" className="photo-preview" />}
      <label className="btn ghost small">
        {label}
        <input ref={input} type="file" name={name} accept="image/*" capture={capture} onChange={onChange} hidden required={required} />
      </label>
    </div>
  );
}
