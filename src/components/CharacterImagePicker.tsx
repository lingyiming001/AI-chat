"use client";
import { useRef, useState } from "react";
import { Upload, X, LoaderCircle } from "lucide-react";
import { fallbackAvatar } from "./Session";
export function CharacterImagePicker({ initial = "", onBusyChange }: {
  initial?: string; onBusyChange: (busy: boolean) => void;
}) {
  const [url, setUrl] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    if (!file.size || file.size > 5 * 1024 * 1024) { setError("请选择 5MB 以内的图片"); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("仅支持 JPG、PNG、WebP 图片"); return; }
    setBusy(true); onBusyChange(true);
    try {
      const form = new FormData(); form.set("image", file);
      const response = await fetch("/api/admin/character-images", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "上传失败，请重试");
      setUrl(data.url);
    } catch (error) { setError(error instanceof Error ? error.message : "上传失败，请重试"); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <div className="field">
    <span>封面图片</span>
    <input type="hidden" name="avatarUrl" value={url} />
    <div className="character-image-picker">
      <img key={url} src={url || fallbackAvatar} alt="角色封面预览" onError={(event) => { if (!event.currentTarget.dataset.fallback) { event.currentTarget.dataset.fallback = "1"; event.currentTarget.src = fallbackAvatar; } }} />
      <div className="character-image-actions">
        <button type="button" className="button" disabled={busy} onClick={() => ref.current?.click()}>{busy ? <LoaderCircle size={16} /> : <Upload size={16} />}{busy ? "上传中" : "上传图片"}</button>
        <button type="button" className="icon-button" title="移除封面" aria-label="移除封面" disabled={busy || !url} onClick={() => { setUrl(""); setError(""); }}><X size={18} /></button>
      </div>
    </div>
    <input ref={ref} hidden type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择本地封面图片" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
    <details><summary>使用网络图片</summary><input aria-label="网络图片地址" type="url" placeholder="https://" value={url.startsWith("/api/") ? "" : url} disabled={busy} onChange={(event) => setUrl(event.target.value)} /></details>
    {error && <span role="alert" className="error">{error}</span>}
  </div>;
}
