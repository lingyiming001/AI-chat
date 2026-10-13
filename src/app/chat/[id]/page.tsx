"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Send,
  Sparkles,
  Coins,
  Image as ImageIcon,
  Mic,
  MessageSquare,
  Upload,
  Square,
  X,
  Eraser,
  Trash2,
} from "lucide-react";
import { type Feature } from "@/lib/model-catalog";
import { Nav } from "@/components/Nav";
import {
  api,
  fallbackAvatar,
  RoleCard,
  useSession,
} from "@/components/Session";
type Attachment = { id: string; url: string; mimeType: string };
type Message = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};
export default function Chat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const [chatDemo, setChatDemo] = useState<boolean | null>(null);
  const [character, setCharacter] = useState<RoleCard | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  async function manage(action: "clear" | "delete") {
    if (busy || !user || !window.confirm(action === "clear" ? "清空此对话全部消息？无法撤销，会话入口保留，已消费星币不会退回。" : "删除此对话及全部消息？无法撤销，已消费星币不会退回。")) return;
    setBusy(true); setError("");
    try {
      await api("/api/conversations", { method: "POST", body: JSON.stringify({ characterId: id, action }) });
      setMessages([]); retry.current = null;
      if (action === "delete") router.push("/conversations");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Feature>("CHAT");
  const [available, setAvailable] = useState<
    { feature: Feature; enabled: boolean; coins: number }[]
  >([]);
  const [audio, setAudio] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordStarting, setRecordStarting] = useState(false);
  const starting = useRef(false);
  const mounted = useRef(true);
  const captureStream = useRef<MediaStream | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const retry = useRef<{
    mode: Feature;
    content: string;
    audio: File | null;
    requestId: string;
  } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const userId = user?.id;
  useEffect(() => {
    mounted.current = true;
    void api<{ features: typeof available; demo: boolean }>("/api/features")
      .then((d) => {
        setAvailable(d.features);
        setChatDemo(d.demo);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      if (recordTimer.current) clearInterval(recordTimer.current);
      captureStream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function record() {
    if (starting.current) return;
    if (recording) {
      if (recorder.current?.state !== "inactive") recorder.current?.stop();
      return;
    }
    starting.current = true;
    setRecordStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
        throw new Error("此浏览器不支持录音，请上传音频文件");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      captureStream.current = stream;
      const mimeType = ["audio/webm", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      if (!mimeType) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("录音格式不受支持，请上传音频文件");
      }
      const r = new MediaRecorder(stream, { mimeType });
      recorder.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        if (recordTimer.current) clearInterval(recordTimer.current);
        stream.getTracks().forEach((t) => t.stop());
        captureStream.current = null;
        if (!mounted.current) return;
        const file = new File(chunks, "recording", { type: mimeType });
        if (file.size > 5 * 1024 * 1024) setError("音频不能超过5MB");
        else setAudio(file);
        setRecording(false);
      };
      r.onerror = () => {
        if (mounted.current) setError("录音失败，请重试");
        if (r.state !== "inactive") r.stop();
      };
      r.start(250);
      setRecording(true);
      setSeconds(0);
      setError("");
      let elapsed = 0;
      recordTimer.current = setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= 60 && r.state !== "inactive") r.stop();
      }, 1000);
    } catch (e) {
      captureStream.current?.getTracks().forEach((t) => t.stop());
      captureStream.current = null;
      if (mounted.current) setError((e as Error).message);
    } finally {
      starting.current = false;
      if (mounted.current) setRecordStarting(false);
    }
  }
  async function compose() {
    const content = input.trim();
    if (
      !user ||
      busy ||
      recording ||
      recordStarting ||
      (mode === "IMAGE" && !content) ||
      (mode === "VOICE" && !audio)
    )
      return;
    setBusy(true);
    setError("");
    const previous = messages;
    const cached = retry.current;
    const requestId =
      cached?.mode === mode &&
      cached.content === content &&
      cached.audio === audio
        ? cached.requestId
        : crypto.randomUUID();
    retry.current = { mode, content, audio, requestId };
    setMessages([
      ...previous,
      { role: "user", content: content || "语音消息" },
      { role: "assistant", content: "" },
    ]);
    try {
      const form = new FormData();
      form.set("feature", mode);
      form.set("content", content);
      form.set("characterId", id);
      form.set("requestId", requestId);
      if (audio && mode === "VOICE") form.set("audio", audio);
      const response = await fetch("/api/compose", {
        method: "POST",
        body: form,
      });
      const result = await response.json();
      if (!response.ok) {
        if (
          result.error?.includes("已退回") ||
          result.error?.includes("本次请求已失败")
        )
          retry.current = null;
        throw new Error(result.error || "生成失败");
      }
      setMessages([
        ...previous,
        { role: "user", content: result.content },
        {
          role: "assistant",
          content: result.reply,
          attachments: result.attachments,
        },
      ]);
      setInput("");
      setAudio(null);
      retry.current = null;
    } catch (e) {
      setError((e as Error).message);
      try {
        setMessages(
          (await api<{ messages: Message[] }>("/api/characters/" + id))
            .messages,
        );
      } catch {
        setMessages(previous);
      }
    } finally {
      setBusy(false);
      await refresh().catch(() => {});
    }
  }
  useEffect(() => {
    if (!loading)
      api<{ character: RoleCard; messages: Message[] }>("/api/characters/" + id)
        .then((d) => {
          setCharacter(d.character);
          setMessages(d.messages);
        })
        .catch((e) => setError(e.message));
  }, [id, userId, loading]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  async function send() {
    const content = input.trim();
    if (!content || busy || !user) return;
    setBusy(true);
    setError("");
    setInput("");
    const previous = messages;
    setMessages([
      ...previous,
      { role: "user", content },
      { role: "assistant", content: "" },
    ]);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterId: id,
          content,
          requestId: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let done = false;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === "start") setChatDemo(event.demo);
          if (event.type === "error") throw new Error(event.error);
          if (event.type === "delta") reply += event.delta;
          if (event.type === "done") {
            reply = event.reply;
            done = true;
          }
          setMessages([
            ...previous,
            { role: "user", content },
            { role: "assistant", content: reply },
          ]);
        }
      }
      if (!done) throw new Error("连接中断，请刷新确认消息和余额后重试");
    } catch (e) {
      setError((e as Error).message);
      setInput(content);
      try {
        const latest = await api<{ messages: Message[] }>(
          "/api/characters/" + id,
        );
        setMessages(latest.messages);
      } catch {
        setMessages(previous);
      }
    } finally {
      setBusy(false);
      await refresh().catch(() => {});
    }
  }
  return (
    <div className="shell">
      <Nav />
      <main className="main chat-main">
        <Link href="/" className="back">
          <ArrowLeft size={16} />
          发现角色
        </Link>
        {character ? (
          <div className="chat-layout">
            <section className="chat-panel">
              <header className="chat-header">
                <img
                  className="avatar"
                  src={character.avatarUrl || fallbackAvatar}
                  alt={character.name}
                />
                <div>
                  <h2>{character.name}</h2>
                  <span>
                    <i className="status-dot mint" />
                    AI 角色 ·{" "}
                    {chatDemo === null
                      ? "连接中"
                      : chatDemo
                        ? "本地演示"
                        : "真实模型"}
                  </span>
                </div>
                <Link href="/recharge" className="chat-balance">
                  <Coins size={16} />
                  {user?.balance ?? 0}
                </Link>
                {user && <div className="conversation-actions">
                  <button type="button" className="icon-button" title="清空消息" aria-label="清空消息" disabled={busy || recording || recordStarting} onClick={() => void manage("clear")}><Eraser size={17} /></button>
                  <button type="button" className="icon-button" title="删除对话" aria-label="删除对话" disabled={busy || recording || recordStarting} onClick={() => void manage("delete")}><Trash2 size={17} /></button>
                </div>}
              </header>
              <div className="messages" aria-live="polite">
                <div className="conversation-start">
                  <Sparkles size={24} />
                  <p>你与 {character.name} 的故事，从这里开始</p>
                </div>
                <div className="message assistant">{character.greeting}</div>
                {messages.map((m, i) => (
                  <div className={"message " + m.role} key={i}>
                    {m.content || <span className="thinking">正在思考…</span>}
                    {m.attachments?.map((a) => (
                      <div className="message-media" key={a.id}>
                        {a.mimeType.startsWith("image/") ? (
                          <a href={a.url} target="_blank" rel="noreferrer">
                            <img src={a.url} alt="AI 生成的角色画面" />
                          </a>
                        ) : (
                          <>
                            <small>AI 合成语音</small>
                            <audio
                              controls
                              preload="none"
                              src={a.url}
                              aria-label="AI 语音回复"
                            />
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                <div ref={bottom} />
              </div>
              {error && (
                <p role="alert" className="error chat-error">
                  {error}
                </p>
              )}
              {user ? (
                <>
                  <div
                    className="chat-modes"
                    role="tablist"
                    aria-label="聊天功能"
                  >
                    {[
                      {
                        feature: "CHAT" as const,
                        label: "对话",
                        icon: MessageSquare,
                      },
                      {
                        feature: "IMAGE" as const,
                        label: "绘图",
                        icon: ImageIcon,
                      },
                      { feature: "VOICE" as const, label: "语音", icon: Mic },
                    ].map(({ feature, label, icon: Icon }) => {
                      const enabled =
                        feature === "CHAT" ||
                        available.some(
                          (f) => f.feature === feature && f.enabled,
                        );
                      return (
                        <button
                          key={feature}
                          type="button"
                          role="tab"
                          aria-selected={mode === feature}
                          title={enabled ? label : label + "暂未启用"}
                          disabled={
                            !enabled || busy || recording || recordStarting
                          }
                          onClick={() => {
                            setMode(feature);
                            setError("");
                          }}
                        >
                          <Icon size={15} />
                          {label}
                          {!enabled && <small>未启用</small>}
                        </button>
                      );
                    })}
                  </div>
                  {mode === "VOICE" && (
                    <div className="voice-input">
                      <input
                        ref={fileInput}
                        type="file"
                        accept="audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/ogg,.m4a"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 5 * 1024 * 1024)
                              setError("音频不能超过5MB");
                            else {
                              setAudio(file);
                              setError("");
                            }
                          }
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        className={
                          "icon-button " + (recording ? "recording" : "")
                        }
                        disabled={busy || recordStarting}
                        title={recording ? "停止录音" : "开始录音"}
                        aria-label={recording ? "停止录音" : "开始录音"}
                        onClick={() => void record()}
                      >
                        {recording ? <Square size={17} /> : <Mic size={17} />}
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy || recording || recordStarting}
                        title="上传音频"
                        aria-label="上传音频"
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload size={17} />
                      </button>
                      <span>
                        {recordStarting
                          ? "等待麦克风授权"
                          : recording
                            ? `录音中 ${seconds}s`
                            : audio
                              ? audio.name +
                                " · " +
                                Math.ceil(audio.size / 1024) +
                                "KB"
                              : "待录音 / 上传"}
                      </span>
                      {audio && !recording && (
                        <button
                          className="icon-button"
                          type="button"
                          aria-label="清除音频"
                          title="清除音频"
                          disabled={busy}
                          onClick={() => setAudio(null)}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  )}
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (mode === "CHAT") void send();
                      else void compose();
                    }}
                  >
                    {mode !== "VOICE" && (
                      <textarea
                        aria-label="聊天输入"
                        placeholder={
                          mode === "IMAGE"
                            ? "描述你想生成的画面"
                            : "想和 " + character.name + " 聊些什么？"
                        }
                        value={input}
                        maxLength={4000}
                        rows={2}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            if (mode === "CHAT") void send();
                            else void compose();
                          }
                        }}
                      />
                    )}
                    {mode === "VOICE" && (
                      <span className="voice-ready">
                        {audio ? "语音消息已就绪" : "等待语音消息"}
                      </span>
                    )}
                    <button
                      className="send-button"
                      type="submit"
                      title="发送消息"
                      aria-label="发送消息"
                      disabled={
                        busy ||
                        recording ||
                        recordStarting ||
                        (mode === "VOICE" ? !audio : !input.trim())
                      }
                    >
                      <Send size={20} />
                    </button>
                  </form>
                </>
              ) : (
                <div className="chat-login">
                  <Link href="/login" className="button primary">
                    登录并开始对话
                  </Link>
                </div>
              )}
              <div className="chat-disclaimer">
                AI 生成内容仅供参考 ·{" "}
                {mode === "CHAT"
                  ? character.pricePerMessage
                  : available.find((f) => f.feature === mode)?.coins || 0}{" "}
                星币 / {mode === "CHAT" ? "条" : "次"}
              </div>
            </section>
            <aside className="character-detail">
              <img
                src={character.avatarUrl || fallbackAvatar}
                alt={character.name}
              />
              <span className="eyebrow">ABOUT THE CHARACTER</span>
              <h2>{character.name}</h2>
              <p className="accent">{character.title}</p>
              <p>{character.greeting}</p>
              <div className="tags">
                {character.tags.map((t) => (
                  <span key={t}># {t}</span>
                ))}
              </div>
              <div className="detail-price">
                <Coins size={18} />
                {character.pricePerMessage} 星币 / 条
              </div>
            </aside>
          </div>
        ) : (
          <div className="empty">{error || "正在打开对话…"}</div>
        )}
      </main>
    </div>
  );
}
