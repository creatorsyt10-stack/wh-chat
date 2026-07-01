const firebaseConfig = {
  apiKey: "AIzaSyCd_rdHnWL5vqFT0KrXixmg9qwFCf3UBUs",
  authDomain: "whchat-app.firebaseapp.com",
  projectId: "whchat-app",
  storageBucket: "whchat-app.firebasestorage.app",
  databaseURL: "https://whchat-app-default-rtdb.firebaseio.com",
  messagingSenderId: "397811398705",
  appId: "1:397811398705:web:2c0abe0cf6b0b656e53d10",
  measurementId: "G-CS2SM6S12Q"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const realtimeDb = firebase.database();
const serverTimestamp = firebase.firestore.FieldValue.serverTimestamp;

const els = {
  currentUser: document.querySelector("#currentUser"), saveUser: document.querySelector("#saveUser"), identityStatus: document.querySelector("#identityStatus"),
  profileName: document.querySelector("#profileName"), profileAvatar: document.querySelector("#profileAvatar"),
  profileNameInput: document.querySelector("#profileNameInput"), saveProfileName: document.querySelector("#saveProfileName"),
  searchPanel: document.querySelector("#searchPanel"), searchUser: document.querySelector("#searchUser"), searchResults: document.querySelector("#searchResults"), chatList: document.querySelector("#chatList"), chatCount: document.querySelector("#chatCount"),
  activeAvatar: document.querySelector("#activeAvatar"), activeName: document.querySelector("#activeName"), activeMeta: document.querySelector("#activeMeta"), messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"), replyStrip: document.querySelector("#replyStrip"), replyText: document.querySelector("#replyText"), cancelReply: document.querySelector("#cancelReply"),
  typingStrip: document.querySelector("#typingStrip"), messageInput: document.querySelector("#messageInput"), sendMessage: document.querySelector("#sendMessage"), clearChat: document.querySelector("#clearChat"), themeToggle: document.querySelector("#themeToggle"),
  backToList: document.querySelector("#backToList"), pinChat: document.querySelector("#pinChat"), searchToggle: document.querySelector("#searchToggle"), searchClose: document.querySelector("#searchClose"), menuToggle: document.querySelector("#menuToggle"),
  settingsOverlay: document.querySelector("#settingsOverlay"), settingsClose: document.querySelector("#settingsClose"),
  chatFilters: document.querySelector("#chatFilters"), mobileNav: document.querySelector("#mobileNav")
};

const localKey = "firebase-private-chat";
let state = {
  uid: "",
  currentUserId: localStorage.getItem(localKey + ":userId") || "",
  displayName: localStorage.getItem(localKey + ":displayName") || "",
  activeUser: null,
  activeChatId: "",
  searchedUsers: JSON.parse(localStorage.getItem(localKey + ":searchedUsers") || "[]"),
  presence: {},
  chats: [],
  messages: [],
  theme: localStorage.getItem(localKey + ":theme") || "dark",
  searchOpen: false,
  settingsOpen: false,
  replyTo: null,
  replyMode: false,
  typing: {},
  typingSentAt: 0,
  typingStopTimer: null,
  lastReadAt: {},
  pinnedChats: JSON.parse(localStorage.getItem(localKey + ":pinnedChats") || "[]"),
  chatFilter: localStorage.getItem(localKey + ":chatFilter") || "all",
  mobileTab: localStorage.getItem(localKey + ":mobileTab") || "chats",
  typingUnsub: null,
  ready: false
};
let unsubscribeChats = null;
let unsubscribeMessages = null;
const presenceListeners = new Map();
let myPresenceRef = null;

function updateAppHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--app-height", height + "px");
}

function cleanId(value) { return String(value || "").trim().toLowerCase(); }
function isValidUserId(value) { return /^[a-z0-9_]{3,24}$/.test(value); }
function chatIdFor(userA, userB) { return [cleanId(userA), cleanId(userB)].sort().join("__"); }
function initials(user) { return (user?.name || user?.id || "?").split(/[\s_]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join(""); }
function formatTime(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat("hi-IN", { hour: "2-digit", minute: "2-digit" }).format(date);
}
function formatPresence(uid) {
  const presence = state.presence[uid];
  if (!uid || !presence) return "offline";
  if (presence.state === "online") return "online";
  if (!presence.lastChanged) return "offline";
  return "last seen " + formatTime(presence.lastChanged);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char]); }
function friendlyFirebaseError(error) {
  const code = error?.code || "";
  if (code.includes("permission-denied")) return "Permission denied: Firestore Rules publish hue hain ya nahi check karein.";
  if (code.includes("operation-not-allowed")) return "Anonymous login Firebase Console me enable nahi hai.";
  if (code.includes("unavailable")) return "Firebase connect nahi ho pa raha. Internet connection check karein.";
  return error?.message || "Firebase error aaya.";
}

function safeChatId(chatId) { return String(chatId || "").replace(/[^a-zA-Z0-9_-]/g, "_"); }
function chatTypingPath(chatId) { return "typing/" + safeChatId(chatId); }
function isPinnedChat(chatId) { return state.pinnedChats.includes(chatId); }
function togglePinnedChat(chatId) {
  if (!chatId) return;
  state.pinnedChats = isPinnedChat(chatId)
    ? state.pinnedChats.filter((id) => id !== chatId)
    : [chatId, ...state.pinnedChats].slice(0, 50);
  localStorage.setItem(localKey + ":pinnedChats", JSON.stringify(state.pinnedChats));
  renderChatList();
}
function clearReply() {
  state.replyMode = false;
  state.replyTo = null;
  if (els.replyText) els.replyText.textContent = "";
  if (els.replyStrip) els.replyStrip.hidden = true;
}
function setReply(message) {
  state.replyMode = true;
  const nextText = String(message?.text || "").trim();
  state.replyTo = message && (nextText || message.deleted) ? {
    id: message.id,
    text: nextText || "Message deleted",
    senderId: message.senderId,
    senderName: message.senderId === state.currentUserId ? "Aap" : (state.activeUser?.name || message.senderId)
  } : null;
  if (els.replyStrip) {
    const showReply = Boolean(state.replyMode && state.replyTo);
    els.replyStrip.hidden = !showReply;
    if (els.replyText) els.replyText.textContent = showReply ? state.replyTo.text : "";
  }
}
function typingRefForCurrentChat() {
  if (!state.activeChatId) return null;
  return realtimeDb.ref(chatTypingPath(state.activeChatId) + "/" + state.uid);
}
function markTyping(isTyping) {
  if (!state.activeChatId || !state.uid) return;
  const ref = typingRefForCurrentChat();
  if (!ref) return;
  ref.set({
    typing: Boolean(isTyping),
    name: state.displayName || state.currentUserId,
    updatedAt: firebase.database.ServerValue.TIMESTAMP
  });
}
function scheduleStopTyping() {
  clearTimeout(state.typingStopTimer);
  state.typingStopTimer = setTimeout(() => markTyping(false), 1400);
}
function stopTypingNow() {
  clearTimeout(state.typingStopTimer);
  markTyping(false);
}
function renderTypingIndicator() {
  if (!els.typingStrip) return;
  const otherTyping = Object.values(state.typing).find((item) => item?.typing && item.uid !== state.uid);
  if (!otherTyping) {
    els.typingStrip.hidden = true;
    els.typingStrip.textContent = "";
    return;
  }
  els.typingStrip.hidden = false;
  els.typingStrip.textContent = (otherTyping.name || "User") + " typing...";
}
function updateReadReceipt(chatId) {
  if (!chatId || !state.uid) return;
  db.collection("chats").doc(chatId).set({
    lastReadBy: { [state.uid]: serverTimestamp() }
  }, { merge: true });
}

function setStatus(text, kind = "") { els.identityStatus.textContent = text; els.identityStatus.dataset.kind = kind; }
function showEmpty(text) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = text; els.messages.append(empty); }

function isMobileViewport() {
  return window.matchMedia("(max-width: 760px)").matches;
}
function renderChatFilters() {
  if (!els.chatFilters) return;
  els.chatFilters.querySelectorAll("[data-filter]").forEach((button) => {
    const active = button.dataset.filter === state.chatFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
function renderMobileNav() {
  if (!els.mobileNav) return;
  els.mobileNav.querySelectorAll("[data-nav]").forEach((button) => {
    const active = button.dataset.nav === state.mobileTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
function getVisibleChats() {
  const chats = [...state.chats].sort((a, b) => Number(isPinnedChat(b.id)) - Number(isPinnedChat(a.id)));
  if (state.chatFilter === "pinned") return chats.filter((chat) => isPinnedChat(chat.id));
  if (state.chatFilter === "online") {
    return chats.filter((chat) => chat.participantUids?.some((uid) => uid !== state.uid && state.presence[uid]?.state === "online"));
  }
  return chats;
}

function renderShell() {
  document.body.classList.toggle("dark", state.theme === "dark");
  document.body.classList.toggle("chat-open", Boolean(state.activeUser && state.activeChatId));
  document.body.classList.toggle("search-open", state.searchOpen);
  els.currentUser.value = state.currentUserId;
  if (els.profileNameInput) els.profileNameInput.value = state.displayName;
  els.searchUser.disabled = !state.ready || !state.currentUserId;
  const profileLabel = state.displayName || "Your profile";
  els.profileName.textContent = profileLabel;
  els.profileAvatar.textContent = initials({ id: state.currentUserId, name: state.displayName || state.currentUserId }) || "?";
  if (els.searchPanel) els.searchPanel.hidden = !state.searchOpen && !isMobileViewport();
  if (els.pinChat) {
    els.pinChat.disabled = !state.activeChatId;
    els.pinChat.textContent = state.activeChatId && isPinnedChat(state.activeChatId) ? "★" : "☆";
  }
  renderUsers();
  renderChatList();
  renderActiveChat();
  renderSettings();
  renderChatFilters();
  renderMobileNav();
}

function renderChatList() {
  els.chatList.innerHTML = "";
  const chats = getVisibleChats();
  els.chatCount.textContent = chats.length;
  if (!state.currentUserId) return appendHint(els.chatList, "Pehle apni User ID save karein.");
  if (!chats.length) {
    return appendHint(els.chatList, state.chatFilter === "all" ? "Abhi koi live chat nahi hai." : "Is filter me koi chat nahi hai.");
  }
  chats.forEach((chat) => {
    const otherId = chat.participantIds.find((id) => id !== state.currentUserId) || "unknown";
    const otherUid = chat.participantUids?.find((uid) => uid !== state.uid) || "";
    listenToPresence(otherUid);
    const otherName = chat.participantNames?.[otherId] || otherId;
    const user = { id: otherId, name: otherName };
    const isOtherOnline = otherUid && state.presence[otherUid]?.state === "online";
    const senderName = chat.lastMessageSenderName || chat.participantNames?.[chat.lastMessageSenderId] || otherName;
    const preview = chat.lastMessage ? ((chat.lastMessageSenderId ? (chat.lastMessageSenderId === state.currentUserId ? "You" : senderName) + ": " : "") + chat.lastMessage) : (isOtherOnline ? "online" : formatPresence(otherUid));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-item " + (chat.id === state.activeChatId ? "active" : "");
    button.innerHTML = '<span class="avatar">' + initials(user) + '</span><span><span class="item-title"><span>' + escapeHtml(otherName) + (isPinnedChat(chat.id) ? ' <span class="pin-mark">Pinned</span>' : '') + '</span><time>' + formatTime(chat.updatedAt) + '</time></span><span class="item-preview">' + escapeHtml(preview) + '</span></span>';
    button.addEventListener("click", () => openChat({ ...user, uid: otherUid }));
    els.chatList.append(button);
  });
}

function renderActiveChat() {
  const hasChat = Boolean(state.activeUser && state.activeChatId);
  els.messageInput.disabled = !hasChat;
  els.sendMessage.disabled = !hasChat;
  els.clearChat.disabled = !hasChat;
  els.activeAvatar.textContent = hasChat ? initials(state.activeUser) : "?";
  els.activeName.textContent = hasChat ? state.activeUser.name : "User search karke chat shuru karein";
  els.activeMeta.textContent = hasChat ? formatPresence(state.activeUser.uid) : "Firebase real-time private thread ready hoga.";
  els.messages.innerHTML = "";
  if (els.replyStrip) {
    const showReply = Boolean(hasChat && state.replyMode && state.replyTo);
    els.replyStrip.hidden = !showReply;
    if (els.replyText) els.replyText.textContent = showReply ? state.replyTo.text : "";
  }
  if (!hasChat) {
    if (els.typingStrip) {
      els.typingStrip.hidden = true;
      els.typingStrip.textContent = "";
    }
  } else {
    renderTypingIndicator();
    updateReadReceipt(state.activeChatId);
  }
  if (!state.currentUserId) return showEmpty("Pehle apni User ID save karein, phir kisi user ko search karein.");
  if (!hasChat) return showEmpty("Left side me exact user ID search karke chat shuru karein.");
  if (!state.messages.length) return showEmpty(state.activeUser.name + " ko pehla message bhejein.");
  state.messages.forEach((message) => {
    els.messages.append(renderMessage(message));
  });
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderMessage(message) {
  const isMine = message.senderId === state.currentUserId;
  const bubble = document.createElement("div");
  bubble.className = "message " + (isMine ? "self" : "other") + (message.deleted ? " deleted" : "");

  const replyBlock = message.replyTo?.text
    ? '<div class="reply-preview"><span>' + escapeHtml(message.replyTo.senderName || "Reply") + '</span><p>' + escapeHtml(message.replyTo.text) + '</p></div>'
    : "";
  const content = message.deleted ? "Message deleted" : escapeHtml(message.text || "");
  const status = isMine && state.activeChatId
    ? ((state.lastReadAt?.[state.activeUser?.uid] && state.lastReadAt[state.activeUser.uid] >= (message.createdAt?.toMillis ? message.createdAt.toMillis() : 0)) ? "seen" : "sent")
    : "";

  bubble.innerHTML =
    replyBlock +
    '<div class="message-text">' + content + '</div>' +
    '<div class="message-actions">' +
      '<button type="button" data-action="reply">Reply</button>' +
      (isMine && !message.deleted ? '<button type="button" data-action="edit">Edit</button><button type="button" data-action="delete">Delete</button>' : '') +
      '<span class="message-meta">' + (isMine ? "Aap" : escapeHtml(state.activeUser.name)) + " - " + formatTime(message.createdAt) + (status ? ' <span class="receipt">' + status + '</span>' : '') + '</span>' +
    '</div>';

  bubble.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      if (action === "reply") setReply(message);
      if (action === "edit") editMessage(message);
      if (action === "delete") deleteMessage(message);
    });
  });
  return bubble;
}

function renderSettings() {
  if (!els.settingsOverlay) return;
  els.settingsOverlay.hidden = !state.settingsOpen;
}

function openSettings() {
  state.settingsOpen = true;
  state.mobileTab = "tools";
  localStorage.setItem(localKey + ":mobileTab", state.mobileTab);
  renderSettings();
}

function closeSettings() {
  state.settingsOpen = false;
  state.mobileTab = "chats";
  localStorage.setItem(localKey + ":mobileTab", state.mobileTab);
  renderSettings();
}

function goBackToChats() {
  state.activeUser = null;
  state.activeChatId = "";
  state.messages = [];
  state.typing = {};
  clearReply();
  stopTypingNow();
  if (state.typingUnsub) {
    state.typingUnsub();
    state.typingUnsub = null;
  }
  if (unsubscribeMessages) unsubscribeMessages();
  state.mobileTab = "chats";
  localStorage.setItem(localKey + ":mobileTab", state.mobileTab);
  renderShell();
}

async function saveDisplayName() {
  const name = String(els.profileNameInput.value || "").trim().slice(0, 32);
  state.displayName = name;
  localStorage.setItem(localKey + ":displayName", name);
  setStatus(name ? "Profile name updated." : "Profile name cleared.", "ok");
  renderShell();
}

function listenToTyping(chatId) {
  if (!chatId) return;
  if (state.typingUnsub) state.typingUnsub();
  const ref = realtimeDb.ref(chatTypingPath(chatId));
  const handler = ref.on("value", (snapshot) => {
    const data = snapshot.val() || {};
    state.typing = Object.entries(data).map(([uid, item]) => ({ uid, ...item }));
    renderTypingIndicator();
  });
  state.typingUnsub = () => ref.off("value", handler);
}

async function editMessage(message) {
  if (!message || message.senderId !== state.currentUserId || !state.activeChatId) return;
  const nextText = prompt("Message edit karein", message.text || "");
  if (nextText == null) return;
  const trimmed = String(nextText).trim();
  if (!trimmed) return;
  await db.collection("chats").doc(state.activeChatId).collection("messages").doc(message.id).set({
    text: trimmed,
    editedAt: serverTimestamp()
  }, { merge: true });
}

async function deleteMessage(message) {
  if (!message || message.senderId !== state.currentUserId || !state.activeChatId) return;
  if (!confirm("Ye message delete karna hai?")) return;
  await db.collection("chats").doc(state.activeChatId).collection("messages").doc(message.id).set({
    text: "",
    deleted: true,
    deletedAt: serverTimestamp()
  }, { merge: true });
}

function appendHint(container, text) {
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = text;
  container.append(hint);
}

function setupMyPresence() {
  if (!state.uid || !state.currentUserId) return;
  if (myPresenceRef) myPresenceRef.off();

  myPresenceRef = realtimeDb.ref("status/" + state.uid);
  const connectedRef = realtimeDb.ref(".info/connected");
  connectedRef.on("value", (snapshot) => {
    if (snapshot.val() !== true) return;
    myPresenceRef.onDisconnect().set({
      state: "offline",
      userId: state.currentUserId,
      lastChanged: firebase.database.ServerValue.TIMESTAMP
    });
    myPresenceRef.set({
      state: "online",
      userId: state.currentUserId,
      lastChanged: firebase.database.ServerValue.TIMESTAMP
    });
  });

  window.addEventListener("beforeunload", () => {
    myPresenceRef.set({
      state: "offline",
      userId: state.currentUserId,
      lastChanged: firebase.database.ServerValue.TIMESTAMP
    });
  });
}

function listenToPresence(uid) {
  if (!uid || uid === state.uid || presenceListeners.has(uid)) return;
  const ref = realtimeDb.ref("status/" + uid);
  const handler = ref.on("value", (snapshot) => {
    state.presence[uid] = snapshot.val() || { state: "offline" };
    renderChatList();
    renderActiveChat();
  });
  presenceListeners.set(uid, { ref, handler });
}

async function saveCurrentUser() {
  if (!state.uid) return setStatus("Firebase sign-in abhi ready nahi hai.", "error");
  const userId = cleanId(els.currentUser.value);
  if (!isValidUserId(userId)) return setStatus("ID 3-24 characters ho: small letters, numbers, underscore.", "error");
  const userRef = db.collection("users").doc(userId);
  const snap = await userRef.get();
  if (snap.exists && snap.data().uid !== state.uid) return setStatus("Ye User ID kisi aur ne le li hai. Dusri ID try karein.", "error");
  await userRef.set({ id: userId, name: userId, uid: state.uid, updatedAt: serverTimestamp() }, { merge: true });
  state.currentUserId = userId;
  localStorage.setItem(localKey + ":userId", userId);
  setStatus("Profile saved successfully.", "ok");
  setupMyPresence();
  listenToChats();
  renderShell();
}

function listenToChats() {
  if (unsubscribeChats) unsubscribeChats();
  if (!state.currentUserId) return;
  unsubscribeChats = db.collection("chats").where("participantIds", "array-contains", state.currentUserId).limit(30).onSnapshot((snapshot) => {
    state.chats = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => {
      const dateA = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
      const dateB = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
      return dateB - dateA;
    });
    state.chats.forEach((chat) => {
      if (chat.lastReadBy) {
        state.lastReadAt = {
          ...state.lastReadAt,
          ...Object.fromEntries(Object.entries(chat.lastReadBy).map(([uid, value]) => [uid, value?.toMillis ? value.toMillis() : 0]))
        };
      }
    });
    renderChatList();
  }, (error) => setStatus("Chats load nahi ho paayi: " + error.message, "error"));
}

function listenToMessages(chatId) {
  if (unsubscribeMessages) unsubscribeMessages();
  unsubscribeMessages = db.collection("chats").doc(chatId).collection("messages").orderBy("createdAt", "asc").limit(200).onSnapshot((snapshot) => {
    state.messages = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderActiveChat();
  }, (error) => setStatus("Messages load nahi ho paaye: " + error.message, "error"));
}

async function searchUser() {
  const queryId = cleanId(els.searchUser.value);
  els.searchResults.innerHTML = "";
  if (!queryId) return renderUsers();
  if (!/^[a-z0-9_]{1,24}$/.test(queryId)) {
    return appendHint(els.searchResults, "Sirf small letters, numbers, underscore use karein.");
  }
  if (queryId === state.currentUserId) {
    return appendHint(els.searchResults, "Apni hi ID par chat open nahi hogi.");
  }

  const snap = await db.collection("users")
    .orderBy("id")
    .startAt(queryId)
    .endAt(queryId + "\uf8ff")
    .limit(8)
    .get();
  const users = snap.docs
    .map((item) => item.data())
    .filter((user) => user.id && user.id !== state.currentUserId);

  if (!users.length) {
    return appendHint(els.searchResults, "Is ID se koi user nahi mila.");
  }

  users.forEach((user) => els.searchResults.append(createUserButton(user)));
}

function renderUsers() {
  els.searchResults.innerHTML = "";
  const searchVisible = state.searchOpen || isMobileViewport();
  if (!state.currentUserId) return appendHint(els.searchResults, "Pehle apni User ID save karein.");
  if (!state.ready) return appendHint(els.searchResults, "Firebase connect ho raha hai...");
  if (!searchVisible) return appendHint(els.searchResults, "Search khol kar user ID type karein.");

  const users = state.searchedUsers
    .filter((user) => user.id && user.id !== state.currentUserId)
    .slice(0, 30);

  if (!users.length) {
    return appendHint(els.searchResults, "Jis user se chat karni hai uski ID search karein.");
  }

  users.forEach((user) => els.searchResults.append(createUserButton(user)));
}

function createUserButton(user) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "result-item";
  button.innerHTML = '<span class="avatar">' + initials(user) + '</span><span><span class="item-title"><span>' + escapeHtml(user.name || user.id) + '</span></span><span class="item-preview">' + escapeHtml(user.id) + '</span></span>';
  button.addEventListener("click", () => openChat(user));
  return button;
}

async function openChat(otherUser) {
  if (!state.currentUserId || !otherUser?.id) return;
  listenToPresence(otherUser.uid);
  const chatId = chatIdFor(state.currentUserId, otherUser.id);
  const chatRef = db.collection("chats").doc(chatId);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) {
    await chatRef.set({
      participantIds: [state.currentUserId, otherUser.id].sort(),
      participantUids: [state.uid, otherUser.uid].sort(),
      participantNames: { [state.currentUserId]: state.currentUserId, [otherUser.id]: otherUser.name || otherUser.id },
      lastMessage: "",
      lastMessageSenderId: "",
      lastMessageSenderName: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  saveSearchedUser(otherUser);
  state.activeUser = { id: otherUser.id, name: otherUser.name || otherUser.id, uid: otherUser.uid };
  state.activeChatId = chatId;
  state.messages = [];
  clearReply();
  state.mobileTab = "chats";
  localStorage.setItem(localKey + ":mobileTab", state.mobileTab);
  els.searchUser.value = "";
  renderUsers();
  listenToMessages(chatId);
  listenToTyping(chatId);
  renderShell();
  els.messageInput.focus();
}

function saveSearchedUser(user) {
  const nextUser = { id: user.id, name: user.name || user.id, uid: user.uid };
  state.searchedUsers = [
    nextUser,
    ...state.searchedUsers.filter((item) => item.id !== nextUser.id)
  ].slice(0, 30);
  localStorage.setItem(localKey + ":searchedUsers", JSON.stringify(state.searchedUsers));
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || !state.activeChatId || !state.activeUser) return;
  els.sendMessage.disabled = true;
  const chatRef = db.collection("chats").doc(state.activeChatId);
  await chatRef.collection("messages").add({
    text: trimmed,
    senderId: state.currentUserId,
    senderUid: state.uid,
    senderName: state.displayName || state.currentUserId,
    receiverId: state.activeUser.id,
    replyTo: state.replyTo,
    createdAt: serverTimestamp()
  });
  await chatRef.set({
    lastMessage: trimmed,
    lastMessageSenderId: state.currentUserId,
    lastMessageSenderName: state.displayName || state.currentUserId,
    updatedAt: serverTimestamp()
  }, { merge: true });
  els.messageInput.value = "";
  clearReply();
  stopTypingNow();
  els.sendMessage.disabled = false;
}

async function clearChat() {
  if (!state.activeChatId) return;
  const snap = await db.collection("chats").doc(state.activeChatId).collection("messages").get();
  const batch = db.batch();
  snap.docs.forEach((item) => batch.delete(item.ref));
  batch.set(db.collection("chats").doc(state.activeChatId), { lastMessage: "", updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  clearReply();
}

els.saveUser.addEventListener("click", () => saveCurrentUser().catch((error) => setStatus(friendlyFirebaseError(error), "error")));
els.saveProfileName.addEventListener("click", () => saveDisplayName().catch((error) => setStatus(friendlyFirebaseError(error), "error")));
els.currentUser.addEventListener("keydown", (event) => { if (event.key === "Enter") saveCurrentUser().catch((error) => setStatus(friendlyFirebaseError(error), "error")); });
els.profileNameInput.addEventListener("keydown", (event) => { if (event.key === "Enter") saveDisplayName().catch((error) => setStatus(friendlyFirebaseError(error), "error")); });
els.searchUser.addEventListener("input", () => searchUser().catch((error) => setStatus(friendlyFirebaseError(error), "error")));
els.searchUser.addEventListener("focus", () => { state.searchOpen = true; renderShell(); });
els.searchToggle.addEventListener("click", () => { state.searchOpen = true; renderShell(); setTimeout(() => els.searchUser.focus(), 0); });
els.searchClose.addEventListener("click", () => { state.searchOpen = false; els.searchUser.value = ""; renderShell(); });
els.chatFilters?.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.chatFilter = button.dataset.filter || "all";
    localStorage.setItem(localKey + ":chatFilter", state.chatFilter);
    renderShell();
  });
});
els.mobileNav?.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    const nav = button.dataset.nav || "chats";
    if (nav === "tools") {
      openSettings();
      return;
    }
    if (nav === "chats") {
      state.mobileTab = "chats";
      localStorage.setItem(localKey + ":mobileTab", state.mobileTab);
      closeSettings();
      if (state.activeUser && state.activeChatId && isMobileViewport()) {
        goBackToChats();
        return;
      }
      renderShell();
      return;
    }
    state.mobileTab = nav;
    localStorage.setItem(localKey + ":mobileTab", state.mobileTab);
    setStatus(nav === "calls" ? "Calls screen phase 2 me aayega." : "Updates screen phase 2 me aayega.", "ok");
    renderShell();
  });
});
els.composer.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(els.messageInput.value).catch((error) => setStatus(friendlyFirebaseError(error), "error")); });
els.cancelReply?.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); clearReply(); });
els.replyStrip?.addEventListener("click", () => { if (state.replyTo) clearReply(); });
els.clearChat.addEventListener("click", () => clearChat().catch((error) => setStatus(friendlyFirebaseError(error), "error")));
els.themeToggle.addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; localStorage.setItem(localKey + ":theme", state.theme); renderShell(); });
els.menuToggle.addEventListener("click", () => { openSettings(); els.currentUser.focus(); });
els.settingsClose.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); closeSettings(); });
els.settingsOverlay.addEventListener("click", (event) => { if (event.target === els.settingsOverlay) closeSettings(); });
els.backToList.addEventListener("click", (event) => { event.preventDefault(); goBackToChats(); });
if (els.pinChat) {
  els.pinChat.addEventListener("click", (event) => {
    event.preventDefault();
    if (!state.activeChatId) return;
    togglePinnedChat(state.activeChatId);
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettings();
    state.searchOpen = false;
    renderShell();
  }
});
els.messageInput.addEventListener("focus", () => {
  document.body.classList.add("keyboard-open");
  updateAppHeight();
  setTimeout(() => {
    updateAppHeight();
    els.messages.scrollTop = els.messages.scrollHeight;
  }, 250);
});
els.messageInput.addEventListener("input", () => {
  if (!state.activeChatId) return;
  markTyping(true);
  scheduleStopTyping();
});
els.messageInput.addEventListener("blur", () => {
  document.body.classList.remove("keyboard-open");
  updateAppHeight();
  stopTypingNow();
});

updateAppHeight();
window.addEventListener("resize", updateAppHeight);
window.visualViewport?.addEventListener("resize", updateAppHeight);
window.visualViewport?.addEventListener("scroll", updateAppHeight);

renderShell();
renderUsers();
auth.signInAnonymously().catch((error) => setStatus("Firebase sign-in failed: " + friendlyFirebaseError(error), "error"));
auth.onAuthStateChanged((user) => {
  if (!user) return;
  state.uid = user.uid;
  state.ready = true;
  setStatus(state.currentUserId ? "Live as " + state.currentUserId : "Firebase ready. Apni User ID save karein.", "ok");
  if (state.currentUserId) {
    setupMyPresence();
    listenToChats();
  }
  renderShell();
});
