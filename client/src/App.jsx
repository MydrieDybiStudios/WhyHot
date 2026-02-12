import { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

// ========== АДАПТАЦИЯ ДЛЯ RENDER ==========
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const socket = io(API_URL, {
  transports: ['websocket', 'polling'],
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000
});
// ==========================================

function App() {
  const [user, setUser] = useState(null);
  
  useEffect(() => {
    const savedUser = localStorage.getItem('whyhot_user');
    if (savedUser) setUser(savedUser);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('whyhot_user');
    setUser(null);
  };

  return (
    <div className="h-screen w-screen bg-tgDark text-tgText flex overflow-hidden font-sans">
      {!user ? (
        <AuthScreen onLogin={(u) => setUser(u)} />
      ) : (
        <Messenger user={user} onLogout={handleLogout} />
      )}
    </div>
  );
}

function AuthScreen({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const endpoint = isRegister ? '/register' : '/login';
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');

      if (isRegister) {
        setIsRegister(false);
        alert('Регистрация успешна! Теперь войдите.');
      } else {
        localStorage.setItem('whyhot_user', data.username);
        onLogin(data.username);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center bg-tgDark">
      <div className="w-96 p-8 bg-tgPanel rounded-xl shadow-2xl flex flex-col items-center">
        <img src="/logo.png" alt="Logo" className="w-32 h-32 mb-6 rounded-full" />
        <h2 className="text-2xl font-bold mb-6 text-white">{isRegister ? 'Регистрация' : 'WhyHot'}</h2>
        {error && <div className="text-red-400 mb-4 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <input
            type="text"
            placeholder="Username"
            className="p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            className="p-3 rounded bg-tgDark border border-gray-700 outline-none focus:border-tgBlue text-white"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="submit"
            className="p-3 mt-2 rounded bg-tgBlue hover:bg-blue-600 font-bold uppercase text-sm transition text-white"
          >
            {isRegister ? 'Создать аккаунт' : 'Войти'}
          </button>
        </form>
        <p
          className="mt-6 text-tgHint text-sm cursor-pointer hover:text-tgBlue"
          onClick={() => setIsRegister(!isRegister)}
        >
          {isRegister ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
        </p>
      </div>
    </div>
  );
}

function Messenger({ user, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [activeChat, setActiveChat] = useState({ type: 'global', name: 'Global Chat' });
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [viewingProfile, setViewingProfile] = useState(null);
  const [currentUserData, setCurrentUserData] = useState({ username: user, avatar_url: '' });
  const [isRecording, setIsRecording] = useState(false);

  const bottomRef = useRef(null);
  const notificationAudio = useRef(new Audio('/notification.mp3'));
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    socket.emit('join', user);
    fetchData();

    socket.on('history', (history) => setMessages(history));
    socket.on('receiveMessage', (msg) => {
      setMessages((prev) => [...prev, msg]);
      if (msg.sender_username !== user) {
        notificationAudio.current.play().catch((e) => {});
      }
    });

    return () => {
      socket.off('history');
      socket.off('receiveMessage');
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    setMessages([]);
    socket.emit('getMessages', {
      type: activeChat.type,
      mate: activeChat.type === 'private' ? activeChat.name : null,
      me: user,
    });
  }, [activeChat]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!searchTerm) {
      setSearchResults([]);
      return;
    }
    const delay = setTimeout(() => {
      fetch(`${API_URL}/users/search?q=${searchTerm}&current=${user}`)
        .then((res) => res.json())
        .then((data) => setSearchResults(data));
    }, 300);
    return () => clearTimeout(delay);
  }, [searchTerm]);

  const fetchData = () => {
    fetchFriends();
    fetchRequests();
    fetchCurrentUserData();
  };

  const fetchFriends = async () => {
    try {
      const res = await fetch(`${API_URL}/friends?user=${user}`);
      const data = await res.json();
      setFriends(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchRequests = async () => {
    try {
      const res = await fetch(`${API_URL}/friends/requests?user=${user}`);
      const data = await res.json();
      setRequests(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCurrentUserData = async () => {
    try {
      const res = await fetch(`${API_URL}/user/${user}`);
      const data = await res.json();
      setCurrentUserData(data);
    } catch (e) {}
  };

  const sendMessageGlobal = (msgData) => {
    socket.emit('sendMessage', {
      ...msgData,
      sender_username: user,
      receiver_username: activeChat.type === 'private' ? activeChat.name : null,
    });
  };

  const handleSendText = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendMessageGlobal({ text, type: 'text' });
    setText('');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        sendMessageGlobal({ text: '', type: 'image', file_url: data.url });
      }
    } catch (err) {
      console.error('Upload failed', err);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], 'voice.webm', { type: 'audio/webm' });

        const formData = new FormData();
        formData.append('file', audioFile);

        try {
          const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
          const data = await res.json();
          if (data.url) sendMessageGlobal({ text: '', type: 'audio', file_url: data.url });
        } catch (err) {
          console.error('Voice upload error', err);
        }

        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Mic error', err);
      alert('Microphone access denied or error.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const sendFriendRequest = async (friendName) => {
    const res = await fetch(`${API_URL}/friends`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, friend: friendName }),
    });
    const data = await res.json();
    alert(data.message || 'Error');
    setSearchTerm('');
  };

  const respondToRequest = async (friendName, action) => {
    await fetch(`${API_URL}/friends/respond`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, friend: friendName, action }),
    });
    fetchData();
  };

  const displayMessages = messages.filter((msg) => {
    if (activeChat.type === 'global') {
      return !msg.receiver_username;
    } else {
      const isMyMsg = msg.sender_username === user && msg.receiver_username === activeChat.name;
      const isTheirMsg = msg.sender_username === activeChat.name && msg.receiver_username === user;
      return isMyMsg || isTheirMsg;
    }
  });

  return (
    <div className="flex w-full h-full relative">
      {/* MODALS */}
      {showSettings && (
        <SettingsModal
          user={currentUserData}
          onClose={() => setShowSettings(false)}
          onUpdate={(newData) => setCurrentUserData(newData)}
        />
      )}

      {viewingProfile && (
        <UserProfileModal
          username={viewingProfile}
          currentUser={user}
          onClose={() => setViewingProfile(null)}
          onMessage={(name) => {
            setActiveChat({ type: 'private', name });
            setViewingProfile(null);
          }}
          onAddFriend={(name) => {
            sendFriendRequest(name);
            setViewingProfile(null);
          }}
        />
      )}

      {/* SIDEBAR */}
      <div className="w-80 bg-tgPanel flex flex-col border-r border-black/20 z-20 shadow-xl">
        <div className="flex flex-col bg-tgPanel shadow-sm">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.png" className="w-8 h-8 rounded-full" />
              <span className="font-bold text-lg text-white">WhyHot</span>
            </div>
            <div className="flex items-center gap-2">
              <img
                src={currentUserData.avatar_url || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'}
                className="w-8 h-8 rounded-full object-cover cursor-pointer border border-white/20 hover:border-tgBlue transition"
                onClick={() => setShowSettings(true)}
                title="Settings"
              />
              <button onClick={onLogout} className="text-tgHint hover:text-white p-1" title="Logout">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                  <path d="M16 17v-3H9v-4h7V7l5 5-5 5M14 2a2 2 0 012 2v2h-2V4H5v16h9v-2h2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2h9z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="px-3 pb-3">
            <div className="bg-tgDark rounded-full flex items-center px-3 py-2 border border-transparent focus-within:border-tgBlue transition">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-tgHint">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
              </svg>
              <input
                className="bg-transparent text-white text-sm ml-2 w-full outline-none placeholder-tgHint"
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {searchTerm && (
            <div className="mb-2">
              <div className="px-4 py-2 text-xs text-tgHint uppercase font-bold">Search Results</div>
              {searchResults.map((u) => (
                <div
                  key={u.username}
                  className="px-4 py-2 flex items-center gap-3 hover:bg-black/10 cursor-pointer transition"
                >
                  <img src={u.avatar_url} className="w-10 h-10 rounded-full" />
                  <div className="flex-1 overflow-hidden">
                    <div className="font-semibold truncate text-white">{u.username}</div>
                  </div>
                  <button
                    onClick={() => sendFriendRequest(u.username)}
                    className="text-xs bg-tgBlue px-3 py-1.5 rounded-full text-white font-medium hover:bg-blue-500"
                  >
                    ADD
                  </button>
                </div>
              ))}
              {searchResults.length === 0 && <div className="px-4 py-2 text-sm text-tgHint">No users found</div>}
            </div>
          )}

          {requests.length > 0 && !searchTerm && (
            <div className="mb-2">
              <div className="px-4 py-2 text-xs text-tgHint uppercase font-bold text-tgBlue">Friend Requests</div>
              {requests.map((req) => (
                <div key={req.username} className="px-4 py-3 bg-black/20 mb-1 flex items-center gap-3">
                  <img src={req.avatar_url} className="w-10 h-10 rounded-full" />
                  <div className="flex-1">
                    <div className="font-semibold text-sm text-white">{req.username}</div>
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => respondToRequest(req.username, 'accept')}
                        className="text-xs bg-green-600 px-2 py-1 rounded text-white hover:bg-green-500"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => respondToRequest(req.username, 'decline')}
                        className="text-xs bg-red-600 px-2 py-1 rounded text-white hover:bg-red-500"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!searchTerm && (
            <>
              <div
                onClick={() => setActiveChat({ type: 'global', name: 'Global Chat' })}
                className={`px-4 py-3 flex items-center gap-4 cursor-pointer transition ${
                  activeChat.type === 'global' ? 'bg-bgActive' : 'hover:bg-black/10'
                }`}
                style={{ backgroundColor: activeChat.type === 'global' ? '#2b5278' : '' }}
              >
                <div className="w-12 h-12 bg-tgBlue rounded-full flex items-center justify-center text-xl text-white font-bold shadow-sm">
                  #
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-white">Global Chat</div>
                  <div className="text-sm text-tgHint">Public community</div>
                </div>
              </div>

              <div className="px-4 py-2 text-xs text-tgHint uppercase mt-4 font-bold">Private Messages</div>
              {friends.map((friend) => (
                <div
                  key={friend.username}
                  onClick={() => setActiveChat({ type: 'private', name: friend.username })}
                  className={`px-4 py-3 flex items-center gap-4 cursor-pointer transition border-l-2 ${
                    activeChat.type === 'private' && activeChat.name === friend.username
                      ? 'border-tgBlue bg-black/20'
                      : 'border-transparent hover:bg-black/10'
                  }`}
                >
                  <img src={friend.avatar_url} className="w-12 h-12 rounded-full object-cover bg-gray-700" />
                  <div className="flex-1 overflow-hidden">
                    <div className="font-semibold text-white">{friend.username}</div>
                    <div className="text-sm text-tgHint truncate">Click to open chat</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* CHAT AREA */}
      <div className="flex-1 flex flex-col bg-tgDark relative">
        <div className="h-16 bg-tgPanel flex items-center px-6 shadow border-b border-black/10 z-10 flex-shrink-0">
          <div
            className={`flex flex-col ${activeChat.type === 'private' ? 'cursor-pointer hover:opacity-80' : ''}`}
            onClick={() => activeChat.type === 'private' && setViewingProfile(activeChat.name)}
          >
            <span className="font-bold text-lg text-white">{activeChat.name}</span>
            <span className="text-sm text-tgHint">
              {activeChat.type === 'global' ? 'Many members' : 'Click to view profile'}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-[#0e1621] bg-[url('https://web.telegram.org/img/bg_0.png')] bg-repeat">
          <div className="flex flex-col justify-end min-h-full space-y-2">
            {displayMessages.map((msg, index) => {
              const isMe = msg.sender_username === user;
              return (
                <div key={index} className={`flex w-full group ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[65%] rounded-2xl px-4 py-2 relative shadow-sm text-base ${
                      isMe ? 'bg-tgMsgOut rounded-br-sm' : 'bg-tgMsgIn rounded-bl-sm'
                    }`}
                  >
                    {!isMe && activeChat.type === 'global' && (
                      <div
                        className="text-tgBlue text-sm font-bold mb-0.5 cursor-pointer hover:underline"
                        onClick={() => setViewingProfile(msg.sender_username)}
                      >
                        {msg.sender_username}
                      </div>
                    )}

                    {(!msg.type || msg.type === 'text') && (
                      <div className="whitespace-pre-wrap break-words">{msg.text}</div>
                    )}

                    {msg.type === 'image' && (
                      <img src={msg.file_url} className="max-w-full rounded-lg mb-1 border border-black/10 cursor-pointer" />
                    )}

                    {msg.type === 'audio' && (
                      <div className="flex items-center gap-2 min-w-[200px]">
                        <div className="bg-white/20 p-2 rounded-full">🎤</div>
                        <audio controls src={msg.file_url} className="h-8 max-w-[200px]" />
                      </div>
                    )}

                    <div
                      className={`text-[11px] text-right mt-1 opacity-70 flex items-center justify-end gap-1 ${
                        isMe ? 'text-blue-200' : 'text-gray-400'
                      }`}
                    >
                      {msg.timestamp}
                      {isMe && <span>✓✓</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </div>

        <form onSubmit={handleSendText} className="p-4 bg-tgPanel flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current.click()}
            className="text-tgHint hover:text-white transition p-2"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
              <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z" />
            </svg>
          </button>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} />

          <input
            className="flex-1 bg-black/20 text-white p-3 rounded-lg border-none focus:ring-0 placeholder-tgHint"
            placeholder="Write a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          {text.trim() ? (
            <button type="submit" className="p-3 text-tgBlue hover:text-blue-400 transition rotate-90 transform">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={stopRecording}
              className={`p-3 transition rounded-full ${
                isRecording
                  ? 'bg-red-500 scale-110 text-white shadow-lg animate-pulse'
                  : 'text-tgHint hover:text-white'
              }`}
              title="Hold to record"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function SettingsModal({ user, onClose, onUpdate }) {
  const [avatar, setAvatar] = useState(user.avatar_url);
  const [username, setUsername] = useState(user.username);
  const presets = [
    'https://cdn-icons-png.flaticon.com/512/147/147133.png',
    'https://cdn-icons-png.flaticon.com/512/147/147144.png',
    'https://cdn-icons-png.flaticon.com/512/147/147142.png',
    'https://cdn-icons-png.flaticon.com/512/1154/1154448.png',
    'https://cdn-icons-png.flaticon.com/512/1154/1154462.png',
    'https://cdn-icons-png.flaticon.com/512/4140/4140048.png'
  ];

  const handleSave = async () => {
    const res = await fetch(`${API_URL}/user/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentUsername: user.username, newUsername: username, newAvatar: avatar })
    });
    const data = await res.json();
    if (data.success) {
      onUpdate(data);
      onClose();
      if (data.username !== user.username) {
        alert('Username changed! Please re-login.');
        localStorage.removeItem('whyhot_user');
        window.location.reload();
      }
    } else {
      alert(data.error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="bg-tgPanel p-6 rounded-xl w-96 shadow-2xl border border-white/10 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-tgHint hover:text-white">
          ✕
        </button>
        <h3 className="text-xl font-bold mb-6 text-center text-white">Edit Profile</h3>
        <div className="mb-6 flex flex-col items-center">
          <img src={avatar} className="w-24 h-24 rounded-full mb-4 border-4 border-tgDark object-cover shadow-lg" />
          <div className="flex gap-3 justify-center">
            {presets.map((src) => (
              <img
                key={src}
                src={src}
                onClick={() => setAvatar(src)}
                className="w-8 h-8 rounded-full cursor-pointer hover:scale-110 transition border border-transparent hover:border-tgBlue"
              />
            ))}
          </div>
        </div>
        <div className="mb-4">
          <label className="text-xs text-tgHint uppercase font-bold tracking-wider">Avatar URL</label>
          <input
            className="w-full bg-tgDark p-3 rounded mt-2 outline-none border border-transparent focus:border-tgBlue text-white"
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
          />
        </div>
        <div className="mb-6">
          <label className="text-xs text-tgHint uppercase font-bold tracking-wider">Username</label>
          <input
            className="w-full bg-tgDark p-3 rounded mt-2 outline-none border border-transparent focus:border-tgBlue text-white"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm text-tgHint hover:text-white font-medium hover:bg-white/10 rounded transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 bg-tgBlue hover:bg-blue-500 rounded text-sm font-bold text-white transition shadow-lg"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function UserProfileModal({ username, currentUser, onClose, onMessage, onAddFriend }) {
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/user/${username}`)
      .then((r) => r.json())
      .then(setUserData);
  }, [username]);

  if (!userData) return null;

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-tgPanel p-8 rounded-xl w-80 shadow-2xl border border-white/10 flex flex-col items-center relative"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={userData.avatar_url}
          className="w-32 h-32 rounded-full mb-4 object-cover border-4 border-tgDark shadow-lg"
        />
        <h2 className="text-2xl font-bold text-white mb-1">{userData.username}</h2>
        <p className="text-tgHint text-sm mb-6">User</p>

        <div className="w-full flex flex-col gap-3">
          {currentUser !== username && (
            <>
              <button
                onClick={() => onMessage(username)}
                className="w-full py-2 bg-tgBlue rounded-lg text-white font-bold hover:bg-blue-500 transition shadow-lg"
              >
                Send Message
              </button>
              <button
                onClick={() => onAddFriend(username)}
                className="w-full py-2 bg-white/10 rounded-lg text-white font-bold hover:bg-white/20 transition"
              >
                Add Friend
              </button>
            </>
          )}
          {currentUser === username && <p className="text-white/50 text-sm italic">This is you.</p>}
        </div>
      </div>
    </div>
  );
}

export default App;
