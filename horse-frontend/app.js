(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const currentHorseOwner = urlParams.get("ref") || "Admin";

  const ownerNameEl = document.getElementById("ownerName");
  const statusEl = document.getElementById("statusText");
  const chatMessagesEl = document.getElementById("chatMessages");
  const messageInputEl = document.getElementById("messageInput");
  const sendButtonEl = document.getElementById("sendButton");
  const currentLinkEl = document.getElementById("currentLink");
  const copyButtonEl = document.getElementById("copyButton");

  // 默认使用占位地址，部署时请替换为实际 WS 地址，例如：
  //   ws://你的IP:8080
  const WS_BASE_URL = "ws://YOUR_SERVER_IP_OR_DOMAIN:8080";

  let socket = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 3;
  const messages = [];

  const uid = generateUid();

  function generateUid() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `guest_${Date.now().toString(36)}_${Math.random()
      .toString(16)
      .slice(2)}`;
  }

  function setStatus(text, type) {
    statusEl.textContent = text;
    statusEl.dataset.type = type || "";
  }

  function addMessage(role, text) {
    messages.push({
      id: Date.now() + Math.random().toString(16).slice(2),
      role,
      text,
    });
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
        meta.textContent = msg.role === "ai" ? "Horse 分身" : "你";
        bubble.appendChild(meta);
      }

      const textNode = document.createElement("div");
      textNode.textContent = msg.text;
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

  function connectWebSocket() {
    const url = `${WS_BASE_URL}?userId=${encodeURIComponent(
      uid
    )}&ref=${encodeURIComponent(currentHorseOwner)}`;

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
      setStatus(`已连接到 ${currentHorseOwner} 的 Horse 分身`, "connected");
      enableInput();
    });

    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (e) {
        // 非 JSON 则当作纯文本
      }

      let role = "ai";
      let text;

      if (payload && typeof payload === "object") {
        if (payload.type === "ai_message" && payload.text) {
          text = payload.text;
          role = "ai";
        } else if (payload.type === "system" && payload.text) {
          text = payload.text;
          role = "system";
        } else if (typeof payload.text === "string") {
          text = payload.text;
        }
      }

      if (!text) {
        text =
          typeof event.data === "string"
            ? event.data
            : "[收到未知格式消息]";
      }

      addMessage(role, text);
    });

    socket.addEventListener("close", () => {
      handleSocketClose();
    });

    socket.addEventListener("error", () => {
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
        "当前尚未连接到 Horse 分身，消息已记录但无法发送到后端。"
      );
      return;
    }

    const payload = {
      type: "user_message",
      userId: uid,
      ref: currentHorseOwner,
      text,
    };

    try {
      socket.send(JSON.stringify(payload));
    } catch (error) {
      console.error("发送消息失败", error);
      addMessage("system", "发送失败，请稍后重试。");
    }
  }

  function setupShareSection() {
    const origin = window.location.origin || "https://horse.amyclaw.com";
    const basePath = window.location.pathname || "/";
    const link = `${origin}${basePath}?ref=${encodeURIComponent(
      currentHorseOwner
    )}`;

    currentLinkEl.textContent = link;
    currentLinkEl.href = link;

    copyButtonEl.addEventListener("click", async () => {
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

  function init() {
    ownerNameEl.textContent = currentHorseOwner;

    addMessage(
      "ai",
      `马到成功！我是 ${currentHorseOwner} 的 Horse AI 分身。很高兴见到你！\n你想对 ${currentHorseOwner} 说点什么新年祝福吗？`
    );

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

