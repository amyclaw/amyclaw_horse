(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const currentHorseOwner = urlParams.get("ref") || "Admin";
  // 默认走简单协议 /horse-ws；仅当显式传 proto=gateway 时走网关 /ws
  const forceSimple = urlParams.get("proto") !== "gateway";

  const ownerNameEl = document.getElementById("ownerName");
  const statusEl = document.getElementById("statusText");
  const chatMessagesEl = document.getElementById("chatMessages");
  const messageInputEl = document.getElementById("messageInput");
  const sendButtonEl = document.getElementById("sendButton");
  const currentLinkEl = document.getElementById("currentLink");
  const copyButtonEl = document.getElementById("copyButton");
  const createLinkInputEl = document.getElementById("createLinkInput");
  const createLinkButtonEl = document.getElementById("createLinkButton");
  const createLinkSectionEl = document.getElementById("createLinkSection");
  const shareLinkSectionEl = document.getElementById("shareLinkSection");
  const shareButtonEl = document.getElementById("shareButton");

  // 通过 Nginx 反向代理访问 WebSocket（/ws -> 127.0.0.1:2026）
  // 使用当前页面的协议和主机，自动适配 http/https
  // 优先使用公网域名 horse.amyclaw.com
  const hostname = window.location.hostname;
  // 如果当前访问的是 IP 地址，但公网域名已配置，使用域名
  const wsHost = (hostname === '10.8.52.122' || hostname === '127.0.0.1') 
    ? 'horse.amyclaw.com' 
    : hostname;
  
  // WebSocket 协议选择：
  // - 如果当前是 HTTPS，尝试使用 wss://
  // - 如果 wss:// 失败，可以降级到 ws://（如果外部代理支持）
  // - 如果当前是 HTTP，使用 ws://
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const WS_BASE_URL = `${protocol}//${wsHost}/ws`;

  let socket = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 3;
  const messages = [];
  let autoGreetingSent = false; // 每个会话只自动触发一次拜年消息
  let wsMode = null; // 'gateway' | 'simple'，null=未确定。simple 即 fd33ec1 的 horse-agent 协议（open 即连，user_message/ai_message）
  let simpleModeTimer = null; // open 后若未收到 connect.challenge 则切到 simple
  let fallbackToSimple = false; // 网关 connect 被拒或超时后自动改用 /horse-ws，由 horse-agent 提供开屏词和 AI 回复

  // 生成或恢复用户唯一 ID（保存在 localStorage，确保刷新后能恢复对话历史）
  function getOrCreateUid() {
    const storageKey = `horse_uid_${currentHorseOwner}`;
    let uid = localStorage.getItem(storageKey);
    if (!uid) {
      uid = generateUid();
      localStorage.setItem(storageKey, uid);
    }
    return uid;
  }

  function generateUid() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `guest_${Date.now().toString(36)}_${Math.random()
      .toString(16)
      .slice(2)}`;
  }

  const uid = getOrCreateUid();
  // 为每个用户创建唯一的 sessionKey（基于 ref 和 uid）
  // 格式：agent:main:horse_<ref>_<uid>
  // 这样每个用户访问同一个 ref 时会有独立的对话历史
  // 刷新页面后，如果 uid 保存在 localStorage，可以恢复相同的 sessionKey，从而恢复对话历史
  const sessionKey = `agent:main:horse_${currentHorseOwner}_${uid.slice(0, 8)}`;

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.dataset.type = type || "";
  }

  /** 按 horse_logic 规则生成预填拜年语：50 字内、以 ref 为主语、含引导句 */
  function getPreFillGreeting(ref) {
    const name = (ref && String(ref).trim()) || "马主";
    return `${name}给您拜年了！祝您和您的家人龙年大吉、万事如意。你想对 ${name} 说点什么新年祝福吗？`;
  }

  function addMessage(role, text, options) {
    const msg = {
      id: Date.now() + Math.random().toString(16).slice(2),
      role,
      text,
    };
    if (options && options.preFilled) msg.preFilled = true;
    messages.push(msg);
    renderMessages();
  }

  function renderMessages() {
    chatMessagesEl.innerHTML = "";
    messages.forEach((msg) => {
      const row = document.createElement("div");
      row.className = `message-row ${msg.role}`;

      const bubble = document.createElement("div");
      bubble.className = `bubble ${msg.role}`;

      if (msg.role === "ai" || msg.role === "user") {
        const meta = document.createElement("span");
        meta.className = `bubble-meta ${msg.role}`;
        meta.textContent = msg.role === "ai" ? `${currentHorseOwner} 的AI分身` : "你";
        bubble.appendChild(meta);
      } else if (msg.role === "system") {
        // 系统消息不显示 meta
      }

      const textNode = document.createElement("div");
      textNode.textContent = msg.text;
      // 如果是思考中状态，添加特殊样式
      if (msg.thinking) {
        textNode.className = "thinking-text";
        textNode.style.opacity = "0.6";
        textNode.style.fontStyle = "italic";
      }
      bubble.appendChild(textNode);

      row.appendChild(bubble);
      chatMessagesEl.appendChild(row);
    });

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function disableInput() {
    messageInputEl.disabled = true;
    sendButtonEl.disabled = true;
  }

  function enableInput() {
    messageInputEl.disabled = false;
    sendButtonEl.disabled = false;
  }

  function connectWebSocket(useWss = null) {
    // OpenClaw Gateway 需要 token 参数进行认证
    // 如果 useWss 为 null，根据当前协议自动选择
    // 如果 useWss 为 false，强制使用 ws://（用于降级）
    let wsProtocol;
    if (useWss === false) {
      wsProtocol = 'ws:';
    } else if (useWss === true) {
      wsProtocol = 'wss:';
    } else {
      wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    }
    
    const useSimple = forceSimple || fallbackToSimple;
    // 简单模式用 /horse-ws，避免被 location /ws 前缀匹配到网关（3012）；服务器必须有 location /horse-ws -> 2026
    const wsPath = useSimple ? "/horse-ws" : "/ws";
    const wsUrl = `${wsProtocol}//${wsHost}${wsPath}`;
    const url = useSimple
      ? `${wsUrl}?userId=${encodeURIComponent(uid)}&ref=${encodeURIComponent(currentHorseOwner)}`
      : `${wsUrl}?token=openclaw20260207&userId=${encodeURIComponent(uid)}&ref=${encodeURIComponent(currentHorseOwner)}`;

    setStatus(`正在和 ${currentHorseOwner} 的马厩建立连接...`, "connecting");

    try {
      socket = new WebSocket(url);
    } catch (error) {
      console.error("WebSocket 创建失败", error);
      handleSocketError();
      return;
    }

    socket.addEventListener("open", () => {
      reconnectAttempts = 0;
      if (useSimple) {
        wsMode = "simple";
        setStatus(`已连接到 ${currentHorseOwner} 的AI分身`, "connected");
        enableInput();
        if (!autoGreetingSent) {
          autoGreetingSent = true;
          setStatus("正在请求 AI 生成首条拜年语…", "connecting");
          const sendFirst = () => {
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({
                type: "user_message",
                userId: uid,
                ref: currentHorseOwner,
                text: "[首屏]",
              }));
            }
          };
          sendFirst();
        }
        return;
      }
      wsMode = null;
      simpleModeTimer = setTimeout(() => {
        if (wsMode !== null) return;
        wsMode = "simple";
        simpleModeTimer = null;
        setStatus(`已连接到 ${currentHorseOwner} 的AI分身`, "connected");
        enableInput();
        if (!autoGreetingSent && socket && socket.readyState === WebSocket.OPEN) {
          autoGreetingSent = true;
          setStatus("正在请求 AI 生成首条拜年语…", "connecting");
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: "user_message",
              userId: uid,
              ref: currentHorseOwner,
              text: "[首屏]",
            }));
          }
        }
      }, 800);
      setStatus(`正在完成连接握手...`, "connecting");
    });

    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
        // 调试：记录所有收到的消息
        console.log("收到 WebSocket 消息:", payload);
      } catch (e) {
        // 非 JSON 则当作纯文本
        console.log("收到非 JSON 消息:", event.data);
      }

      // 处理 OpenClaw Gateway 的 connect.challenge 事件（强制简单连接时忽略，不调 sign-device）
      if (payload && payload.type === "event" && payload.event === "connect.challenge") {
        if (forceSimple || fallbackToSimple) return;
        if (simpleModeTimer) { clearTimeout(simpleModeTimer); simpleModeTimer = null; }
        wsMode = "gateway";
        const nonce = payload.payload.nonce;
        const timestamp = payload.payload.ts;
        
        // 从服务器获取设备签名
        // 需要传递完整的连接参数以构建正确的 payload
        fetch('/api/sign-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce: nonce,
            timestamp: timestamp,
            clientId: "cli",
            clientMode: "cli",
            role: "operator",
            scopes: ["operator.read", "operator.write"],
            token: "openclaw20260207"
          })
        })
        .then(res => res.json())
        .then(deviceData => {
          const connectRequest = {
            type: "req",
            id: `connect_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 3,
              client: {
                id: "cli",
                version: "1.0.0",
                platform: "web",
                mode: "operator",
              },
              role: "operator",
              scopes: ["operator.read", "operator.write"],
              caps: [],
              commands: [],
              permissions: {},
              auth: {
                token: "openclaw20260207",
              },
              locale: "zh-CN",
              userAgent: "Horse-Web/1.0.0",
              device: {
                id: deviceData.deviceId,
                publicKey: deviceData.publicKey,
                signature: deviceData.signature,
                signedAt: deviceData.signedAt,
                nonce: deviceData.nonce,
              },
            },
          };
          try {
            socket.send(JSON.stringify(connectRequest));
            setStatus(`正在完成连接握手...`, "connecting");
          } catch (error) {
            console.error("发送 connect 请求失败", error);
          }
        })
        .catch(error => {
          console.error("获取设备签名失败", error);
          setStatus("获取设备签名失败，请稍后重试", "error");
        });
        
        return; // 不显示 challenge 消息给用户
      }

      // 处理 connect 被拒（打印完整错误便于排查，并自动降级到简单模式由 horse-agent 提供开屏词和 AI）
      if (payload && payload.type === "res" && payload.ok === false && payload.id && String(payload.id).startsWith("connect_")) {
        const err = payload.error || {};
        console.error("[Horse] connect 被拒:", err.code || "", err.message || "", payload.error);
        if (simpleModeTimer) { clearTimeout(simpleModeTimer); simpleModeTimer = null; }
        fallbackToSimple = true;
        setStatus("正在改用简单模式重连…", "connecting");
        if (socket) {
          try { socket.close(1000, "gateway-failed"); } catch (_) {}
          socket = null;
        }
        setTimeout(() => connectWebSocket(), 300);
        return;
      }

      // 处理 connect 响应（连接成功）
      if (payload && payload.type === "res" && payload.ok === true && payload.payload && payload.payload.type === "hello-ok") {
        if (simpleModeTimer) { clearTimeout(simpleModeTimer); simpleModeTimer = null; }
        wsMode = "gateway";
        setStatus(`已连接到 ${currentHorseOwner} 的AI分身`, "connected");
        enableInput();
        if (!autoGreetingSent) {
          autoGreetingSent = true;
          setStatus("正在请求 AI 生成首条拜年语…", "connecting");
          if (socket && socket.readyState === WebSocket.OPEN) {
            const requestId = `greeting_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            const idempotencyKey = `greeting_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            socket.send(JSON.stringify({
              type: "req",
              id: requestId,
              method: "chat.send",
              params: {
                sessionKey: sessionKey,
                message: "[首屏]",
                idempotencyKey: idempotencyKey,
              },
            }));
          }
        }
        return;
      }

      // 自动拜年请求的响应：不显示给用户，只用于触发「思考中」
      if (payload && payload.type === "res" && payload.id && payload.id.startsWith("greeting_")) {
        if (payload.ok && payload.payload && payload.payload.status === "started") {
          setStatus("AI 正在生成拜年语...", "thinking");
          const thinkingMessage = {
            id: `thinking_${Date.now()}`,
            role: "ai",
            text: "思考中...",
            thinking: true,
          };
          messages.push(thinkingMessage);
          renderMessages();
        }
        return;
      }

      // 处理 chat.send 响应（用户点击发送触发的，非 greeting_）
      if (payload && payload.type === "res" && payload.id && payload.id.startsWith("chat_send_")) {
        if (payload.ok && payload.payload && payload.payload.status === "started") {
          setStatus("AI 正在思考中...", "thinking");
          const thinkingMessage = {
            id: `thinking_${Date.now()}`,
            role: "ai",
            text: "思考中...",
            thinking: true,
          };
          messages.push(thinkingMessage);
          renderMessages();
        }
        return;
      }

      // 处理 chat 事件（AI 回复）
      if (payload && payload.type === "event" && payload.event === "chat") {
        const chatData = payload.payload;
        console.log("收到 chat 事件:", chatData);
        
        const thinkingIndex = messages.findIndex(msg => msg.thinking);
        if (thinkingIndex !== -1) {
          messages.splice(thinkingIndex, 1);
        }
        
        let messageText = null;
        if (chatData && chatData.message) {
          const msg = chatData.message;
          if (msg.text) {
            messageText = msg.text;
          } else if (msg.content) {
            if (typeof msg.content === "string") {
              messageText = msg.content;
            } else if (Array.isArray(msg.content)) {
              messageText = msg.content
                .filter(item => item.type === "text" && item.text)
                .map(item => item.text)
                .join("\n");
            }
          } else if (typeof msg === "string") {
            messageText = msg;
          }
        }
        
        // 若有预填拜年语，用 AI 回复替换它
        const preFilledIdx = messages.findIndex(m => m.role === "ai" && m.preFilled);
        if (preFilledIdx !== -1 && messageText) {
          messages[preFilledIdx].text = messageText;
          delete messages[preFilledIdx].preFilled;
          renderMessages();
          setStatus(`已连接到 ${currentHorseOwner} 的AI分身`, "connected");
          return;
        }
        
        if (chatData.state === "delta" && messageText) {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage && lastMessage.role === "ai" && !lastMessage.thinking) {
            lastMessage.text = messageText;
            renderMessages();
          } else {
            addMessage("ai", messageText);
          }
          return;
        }
        
        if (chatData.state === "final" && messageText) {
          addMessage("ai", messageText);
          setStatus(`已连接到 ${currentHorseOwner} 的AI分身`, "connected");
          return;
        }
        
        // 如果没有 state，尝试直接提取
        if (messageText) {
          addMessage("ai", messageText);
          setStatus(`已连接到 ${currentHorseOwner} 的AI分身`, "connected");
          return;
        }
      }

      // 处理 agent 事件（AI 回复的另一种格式）
      if (payload && payload.type === "event" && payload.event === "agent") {
        const agentData = payload.payload;
        console.log("收到 agent 事件:", agentData);
        
        // 只处理 assistant stream 类型的事件
        if (agentData.stream === "assistant" && agentData.data) {
          // 移除"思考中"占位消息
          const thinkingIndex = messages.findIndex(msg => msg.thinking);
          if (thinkingIndex !== -1) {
            messages.splice(thinkingIndex, 1);
          }
          
          // 提取文本内容
          let text = null;
          if (agentData.data.text) {
            text = agentData.data.text;
          } else if (agentData.data.content) {
            if (typeof agentData.data.content === "string") {
              text = agentData.data.content;
            } else if (Array.isArray(agentData.data.content)) {
              text = agentData.data.content
                .filter(item => item.type === "text" && item.text)
                .map(item => item.text)
                .join("\n");
            }
          }
          
          if (text) {
            // 流式更新最后一条 AI 消息
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && lastMessage.role === "ai" && !lastMessage.thinking) {
              lastMessage.text = text;
              renderMessages();
            } else {
              addMessage("ai", text);
            }
            setStatus(`已连接到 ${currentHorseOwner} 的AI分身`, "connected");
          }
          return;
        }
        
        // 处理 lifecycle 事件（完成）
        if (agentData.stream === "lifecycle" && agentData.data && agentData.data.status === "completed") {
          setStatus(`已连接到 ${currentHorseOwner} 的AI分身`, "connected");
          return;
        }
      }

      // 处理所有其他事件类型（调试用）
      if (payload && payload.type === "event") {
        console.log("收到未处理的事件:", payload.event, payload.payload);
        // 尝试从 payload 中提取文本
        if (payload.payload) {
          const p = payload.payload;
          if (p.text) {
            addMessage("ai", p.text);
            return;
          }
          if (p.message) {
            addMessage("ai", p.message);
            return;
          }
          if (typeof p === "string") {
            addMessage("ai", p);
            return;
          }
        }
        // 如果无法提取，暂时忽略（避免显示错误消息）
        return;
      }

      let role = "ai";
      let text;

      if (payload && typeof payload === "object") {
        if (payload.type === "ai_message") {
          const raw = typeof payload.text === "string" ? payload.text : "";
          text = raw.trim() || `${currentHorseOwner} 给您拜年啦！衷心祝愿您和全家在马年里龙马精神、红红火火！愿新的一年里，您家中喜气盈门，事业一马当先，福气、财气、好运统统奔腾而来，万事顺遂，阖家大吉！`;
          role = "ai";
          // 若存在预填拜年语，用首条 AI 回复替换它；若 AI 返回无效内容（如 NO、过短）则保留预填
          const preFilledIdx = messages.findIndex(m => m.role === "ai" && m.preFilled);
          if (preFilledIdx !== -1) {
            const invalidFirstReply = /^(no|nope|不|拒绝)$/i.test(text) || (text.length > 0 && text.length < 12);
            if (invalidFirstReply) {
              delete messages[preFilledIdx].preFilled;
              renderMessages();
              return;
            }
            messages[preFilledIdx].text = text;
            delete messages[preFilledIdx].preFilled;
            renderMessages();
            return;
          }
        } else if (payload.type === "system" && payload.text) {
          text = payload.text;
          role = "system";
        } else if (typeof payload.text === "string") {
          text = payload.text;
        }
      }

      if (text === undefined || text === null) {
        // 对于未知格式，记录但不显示（避免干扰用户）
        console.log("收到未知格式消息，已忽略:", payload);
        return;
      }
      // ai_message 允许空字符串时显示兜底拜年语
      if (role === "ai" && !String(text).trim()) {
        text = `${currentHorseOwner} 给您拜年啦！衷心祝愿您和全家在马年里龙马精神、红红火火！愿新的一年里，您家中喜气盈门，事业一马当先，福气、财气、好运统统奔腾而来，万事顺遂，阖家大吉！`;
      }

      addMessage(role, text);
    });

    socket.addEventListener("close", (event) => {
      // 网关 connect 被拒后我们主动 close(1000, "gateway-failed") 并已安排降级重连，此处不再重试
      if (event.code === 1000 && event.reason === "gateway-failed") {
        return;
      }
      // 如果是 wss:// 连接失败且错误码是协议错误，尝试降级到 ws://
      if (wsProtocol === 'wss:' && event.code === 1002 && useWss !== false) {
        console.log("wss:// 连接失败，尝试降级到 ws://");
        socket = null;
        setTimeout(() => connectWebSocket(false), 500);
        return;
      }
      handleSocketClose();
    });

    socket.addEventListener("error", (error) => {
      // 如果是 wss:// 连接错误且还未尝试降级，尝试降级到 ws://
      if (wsProtocol === 'wss:' && useWss !== false) {
        console.log("wss:// 连接错误，尝试降级到 ws://", error);
        if (socket) {
          socket.close();
          socket = null;
        }
        setTimeout(() => connectWebSocket(false), 500);
        return;
      }
      handleSocketError();
    });
  }

  function handleSocketClose() {
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts += 1;
      setStatus(
        `连接已断开，正在重试（${reconnectAttempts}/${maxReconnectAttempts}）...`,
        "reconnecting"
      );
      disableInput();
      setTimeout(connectWebSocket, 1200 * reconnectAttempts);
    } else {
      setStatus(
        "暂时联系不上马主的分身，请稍后再试或联系管理员。",
        "error"
      );
      disableInput();
    }
  }

  function handleSocketError() {
    setStatus(
      "连接遇到异常，稍后自动重试。如果持续失败，请联系管理员。",
      "error"
    );
  }

  function sendCurrentInput() {
    const text = messageInputEl.value.trim();
    if (!text) return;

    addMessage("user", text);
    messageInputEl.value = "";

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      addMessage(
        "system",
        "当前尚未连接到马主的AI分身，消息已记录但无法发送到后端。"
      );
      return;
    }

    let payload;
    if (wsMode === "simple") {
      payload = { type: "user_message", userId: uid, ref: currentHorseOwner, text };
    } else {
      const requestId = `chat_send_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const idempotencyKey = `horse_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      payload = {
        type: "req",
        id: requestId,
        method: "chat.send",
        params: { sessionKey: sessionKey, message: text, idempotencyKey: idempotencyKey },
      };
    }

    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.error("发送消息失败", error);
      addMessage("system", "发送失败，请稍后重试。");
    }
  }

  function setupShareSection() {
    // 用户名 + 创建链接区域始终显示，方便任何人创建自己的专属链接
    createLinkSectionEl.style.display = "block";
    // 若 URL 中有 ref 且非 Admin，同时显示当前链接的分享区域
    if (currentHorseOwner && currentHorseOwner !== "Admin") {
      showShareLinkSection();
    } else {
      shareLinkSectionEl.style.display = "none";
    }

    // 创建链接按钮事件
    createLinkButtonEl.addEventListener("click", () => {
      const name = createLinkInputEl.value.trim();
      if (!name) {
        alert("请输入你的名字");
        return;
      }
      // 验证名字（只允许字母、数字、中文、下划线、连字符）
      if (!/^[\u4e00-\u9fa5a-zA-Z0-9_-]+$/.test(name)) {
        alert("名字只能包含中文、英文、数字、下划线和连字符");
        return;
      }
      // 跳转到新链接
      const origin = window.location.origin || "https://horse.amyclaw.com";
      const basePath = window.location.pathname || "/";
      const newUrl = `${origin}${basePath}?ref=${encodeURIComponent(name)}`;
      window.location.href = newUrl;
    });

    // 回车键创建链接
    createLinkInputEl.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        createLinkButtonEl.click();
      }
    });

    // 复制链接按钮事件
    copyButtonEl.addEventListener("click", async () => {
      const link = currentLinkEl.href;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(link);
        } else {
          // 兼容较老环境的降级方案
          const tempInput = document.createElement("input");
          tempInput.value = link;
          document.body.appendChild(tempInput);
          tempInput.select();
          document.execCommand("copy");
          document.body.removeChild(tempInput);
        }
        copyButtonEl.textContent = "已复制";
        setTimeout(() => {
          copyButtonEl.textContent = "复制链接";
        }, 1600);
      } catch (error) {
        console.error("复制失败", error);
        copyButtonEl.textContent = "复制失败";
        setTimeout(() => {
          copyButtonEl.textContent = "复制链接";
        }, 1600);
      }
    });

    // 一键分享按钮事件
    shareButtonEl.addEventListener("click", async () => {
      const link = currentLinkEl.href;
      const title = `${currentHorseOwner} 的AI分身`;
      const text = `来给 ${currentHorseOwner} 拜年吧！`;

      try {
        if (navigator.share) {
          // 使用 Web Share API（移动端）
          await navigator.share({
            title: title,
            text: text,
            url: link,
          });
        } else {
          // 降级方案：复制链接并提示
          await navigator.clipboard.writeText(link);
          alert(`链接已复制到剪贴板：\n${link}\n\n可以粘贴分享给朋友了！`);
        }
      } catch (error) {
        // 用户取消分享或其他错误
        if (error.name !== "AbortError") {
          console.error("分享失败", error);
          // 降级到复制
          await navigator.clipboard.writeText(link);
          alert(`链接已复制到剪贴板：\n${link}`);
        }
      }
    });
  }

  function showCreateLinkSection() {
    createLinkSectionEl.style.display = "block";
    shareLinkSectionEl.style.display = "none";
  }

  function showShareLinkSection() {
    shareLinkSectionEl.style.display = "block";
    
    const origin = window.location.origin || "https://horse.amyclaw.com";
    const basePath = window.location.pathname || "/";
    const link = `${origin}${basePath}?ref=${encodeURIComponent(
      currentHorseOwner
    )}`;

    currentLinkEl.textContent = link;
    currentLinkEl.href = link;
  }

  function setupInputEvents() {
    sendButtonEl.addEventListener("click", () => {
      sendCurrentInput();
      messageInputEl.focus();
    });

    messageInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendCurrentInput();
      }
    });
  }

  const chatCardTitleEl = document.getElementById("chatCardTitle");

  function init() {
    ownerNameEl.textContent = currentHorseOwner;
    if (chatCardTitleEl) chatCardTitleEl.textContent = `${currentHorseOwner} 的AI助理`;
    // 页面打开即显示预填拜年语（不依赖连接），符合 horse_logic 规则
    addMessage("ai", getPreFillGreeting(currentHorseOwner), { preFilled: true });
    setupShareSection();
    setupInputEvents();
    connectWebSocket();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

