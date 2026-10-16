import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LiveKitRoom, RoomAudioRenderer, ControlBar } from "@livekit/components-react";
import "@livekit/components-styles";
import { Headphones, LogOut, Mic, Plus, Shield, Trash2 } from "lucide-react";
import { api, setToken } from "./api";
import "./styles.css";

function AuthScreen({ onAuthed, initialError }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError || "");
  const [providers, setProviders] = useState([]);

  useEffect(() => {
    api("/auth/providers").then((data) => setProviders(data.providers)).catch(() => setError("暂时无法加载登录方式"));
  }, []);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  const localEnabled = providers.some((provider) => provider.id === "local");
  const mutsakiEnabled = providers.some((provider) => provider.id === "mutsaki");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      const data = await api(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ username, password })
      });
      setToken(data.token);
      onAuthed(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-panel">
        <div>
          <p className="eyebrow">Koe Voice</p>
          <h1>MC 服务器语音大厅</h1>
        </div>

        {error && <p className="error">{error}</p>}
        {mutsakiEnabled && (
          <a className="primary oauth-button" href="/api/auth/mutsaki/start">使用 Mutsaki 账号登录</a>
        )}
        {localEnabled && (
          <form className="local-auth" onSubmit={submit}>
            {mutsakiEnabled && <p className="auth-divider">或使用本地账号</p>}
            <label>
              用户名
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label>
              密码
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </label>
            <button className="primary" type="submit">{mode === "login" ? "登录" : "注册"}</button>
            <button className="link-button" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
              {mode === "login" ? "没有账号，去注册" : "已有账号，去登录"}
            </button>
          </form>
        )}
        <p className="legal-links"><a href="/source">源代码</a> · <a href="/LICENSE">AGPL-3.0 许可证</a> · 无担保</p>
      </div>
    </main>
  );
}

function RoomCreator({ onCreated }) {
  const [name, setName] = useState("");

  async function createRoom(event) {
    event.preventDefault();
    if (!name.trim()) return;
    const room = await api("/rooms", {
      method: "POST",
      body: JSON.stringify({ name })
    });
    setName("");
    onCreated(room);
  }

  return (
    <form className="room-creator" onSubmit={createRoom}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="房间名" />
      <button title="创建房间" type="submit"><Plus size={18} /></button>
    </form>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [voice, setVoice] = useState(null);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");

  const canCreate = user?.role === "owner" || user?.canCreateRoom;

  useEffect(() => {
    boot();
  }, []);

  async function boot() {
    const params = new URLSearchParams(window.location.search);
    const mutsakiReturn = params.get("auth") === "mutsaki";
    const oauthError = params.get("auth_error");
    if (mutsakiReturn || oauthError) {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
    if (oauthError) setAuthError(oauthError === "cancelled" ? "已取消 Mutsaki 授权" : "Mutsaki 登录失败，请重试");
    try {
      if (mutsakiReturn) {
        const data = await api("/auth/mutsaki/complete", { method: "POST" });
        setToken(data.token);
        setUser(data.user);
      } else {
        const me = await api("/me");
        setUser(me.user);
      }
    } catch (err) {
      setToken(null);
      if (mutsakiReturn) setAuthError(err.message);
      return;
    }
    try {
      const roomData = await api("/rooms");
      setRooms(roomData.rooms);
      setActiveRoom(roomData.rooms[0]);
    } catch (err) {
      setError(err.message);
    }
  }

  function onAuthed(user) {
    setUser(user);
    refreshRooms().catch((err) => setError(err.message));
  }

  async function refreshRooms() {
    const data = await api("/rooms");
    setRooms(data.rooms);
    if (!activeRoom && data.rooms.length) setActiveRoom(data.rooms[0]);
  }

  async function joinRoom(room) {
    setError("");
    setActiveRoom(room);
    try {
      const tokenData = await api(`/rooms/${room.id}/voice-token`, { method: "POST" });
      setVoice(tokenData);
    } catch (err) {
      setError(err.message);
    }
  }

  async function deleteRoom(room) {
    await api(`/rooms/${room.id}`, { method: "DELETE" });
    setVoice(null);
    setActiveRoom(null);
    await refreshRooms();
  }

  function logout() {
    setToken(null);
    setUser(null);
    setVoice(null);
  }

  if (!user) return <AuthScreen onAuthed={onAuthed} initialError={authError} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Headphones />
          <div>
            <strong>Koe</strong>
            <span>MC Voice</span>
          </div>
        </div>

        <div className="user-box">
          <div>
            <strong>{user.displayName || user.username}</strong>
            <span>{user.provider === "mutsaki" ? "Mutsaki" : "本地账号"} · {user.role === "owner" ? "Owner" : canCreate ? "Creator" : "Member"}</span>
          </div>
          <button title="退出登录" onClick={logout}><LogOut size={18} /></button>
        </div>

        {canCreate && <RoomCreator onCreated={refreshRooms} />}

        <nav className="room-list">
          {rooms.map((room) => (
            <button className={activeRoom?.id === room.id ? "room active" : "room"} key={room.id} onClick={() => joinRoom(room)}>
              <span>{room.isPublic ? <Shield size={16} /> : <Mic size={16} />}</span>
              <strong>{room.name}</strong>
            </button>
          ))}
        </nav>
        <p className="legal-links"><a href="/source">源代码</a> · <a href="/LICENSE">AGPL-3.0 许可证</a> · 无担保</p>
      </aside>

      <section className="stage">
        <header className="stage-header">
          <div>
            <p className="eyebrow">当前房间</p>
            <h1>{activeRoom?.name || "选择一个房间"}</h1>
          </div>
          {activeRoom && !activeRoom.isPublic && (user.role === "owner" || activeRoom.createdBy === user.id) && (
            <button className="danger" title="删除房间" onClick={() => deleteRoom(activeRoom)}>
              <Trash2 size={18} />
            </button>
          )}
        </header>

        {error && <p className="error">{error}</p>}

        {!voice && (
          <div className="empty-state">
            <Headphones size={48} />
            <h2>选择左侧房间进入语音</h2>
            <p>公共房间一直开放，授权用户可以创建额外房间。</p>
          </div>
        )}

        {voice && (
          <LiveKitRoom token={voice.token} serverUrl={voice.livekitUrl} connect audio video={false} className="voice-room">
            <RoomAudioRenderer />
            <VoiceRoomInfo room={activeRoom} user={user} />
            <ControlBar controls={{ camera: false, screenShare: false, chat: false }} />
          </LiveKitRoom>
        )}
      </section>
    </main>
  );
}

function VoiceRoomInfo({ room, user }) {
  const title = useMemo(() => room?.name || "语音房", [room]);
  return (
    <div className="voice-info">
      <Mic size={32} />
      <h2>{title}</h2>
      <p>{user.displayName || user.username} 已连接语音</p>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
