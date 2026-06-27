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
  searchUser: document.querySelector("#searchUser"), searchResults: document.querySelector("#searchResults"), chatList: document.querySelector("#chatList"), chatCount: document.querySelector("#chatCount"),
  activeAvatar: document.querySelector("#activeAvatar"), activeName: document.querySelector("#activeName"), activeMeta: document.querySelector("#activeMeta"), messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"), messageInput: document.querySelector("#messageInput"), sendMessage: document.querySelector("#sendMessage"), clearChat: document.querySelector("#clearChat"), themeToggle: document.querySelector("#themeToggle"),
  backToList: document.querySelector("#backToList")
};

const localKey = "firebase-private-chat";
let state = {
  uid: "",
  currentUserId: localStorage.getItem(localKey + ":userId") || "",
  activeUser: null,
  activeChatId: "",
  searchedUsers: JSON.parse(localStorage.getItem(localKey + ":searchedUsers") || "[]"),
  presence: {},
  chats: [],
  messages: [],
  theme: localStorage.getItem(localKey + ":theme") || "dark",
  ready: false
};
let unsubscribeChats = null;
let unsubscribeMessages = null;
const presenceListeners = new Map();
let myPresenceRef = null;

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
  if (!presence) return "status loading...";
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

function setStatus(text, kind = "") { els.identityStatus.textContent = text; els.identityStatus.dataset.kind = kind; }
function showEmpty(text) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = text; els.messages.append(empty); }

function renderShell() {
  document.body.classList.toggle("dark", state.theme === "dark");
  document.body.classList.toggle("chat-open", Boolean(state.activeUser && state.activeChatId));
  els.currentUser.value = state.currentUserId;
  els.searchUser.disabled = !state.ready || !state.currentUserId;
  renderUsers();
  renderChatList();
  renderActiveChat();
}

function renderChatList() {
  els.chatList.innerHTML = "";
  els.chatCount.textContent = state.chats.length;
  if (!state.currentUserId) return appendHint(els.chatList, "Pehle apni User ID save karein.");
  if (!state.chats.length) return appendHint(els.chatList, "Abhi koi live chat nahi hai.");
  state.chats.forEach((chat) => {
    const otherId = chat.participantIds.find((id) => id !== state.currentUserId) || "unknown";
    const otherUid = chat.participantUids?.find((uid) => uid !== state.uid) || "";
    listenToPresence(otherUid);
    const otherName = chat.participantNames?.[otherId] || otherId;
    const user = { id: otherId, name: otherName };
    const preview = otherUid && state.presence[otherUid]?.state === "online" ? "online" : (chat.lastMessage || formatPresence(otherUid));
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-item " + (chat.id === state.activeChatId ? "active" : "");
    button.innerHTML = '<span class="avatar">' + initials(user) + '</span><span><span class="item-title"><span>' + escapeHtml(otherName) + '</span><time>' + formatTime(chat.updatedAt) + '</time></span><span class="item-preview">' + escapeHtml(preview) + '</span></span>';
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
  if (!state.currentUserId) return showEmpty("Pehle apni User ID save karein, phir kisi user ko search karein.");
  if (!hasChat) return showEmpty("Left side me exact user ID search karke chat shuru karein.");
  if (!state.messages.length) return showEmpty(state.activeUser.name + " ko pehla message bhejein.");
  state.messages.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = "message " + (message.senderId === state.currentUserId ? "self" : "other");
    bubble.innerHTML = escapeHtml(message.text) + '<span class="message-meta">' + (message.senderId === state.currentUserId ? "Aap" : escapeHtml(state.activeUser.name)) + " - " + formatTime(message.createdAt) + "</span>";
    els.messages.append(bubble);
  });
  els.messages.scrollTop = els.messages.scrollHeight;
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
  setStatus("Live as " + userId, "ok");
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
  if (!state.currentUserId) return appendHint(els.searchResults, "Pehle apni User ID save karein.");
  if (!state.ready) return appendHint(els.searchResults, "Firebase connect ho raha hai...");

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
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  saveSearchedUser(otherUser);
  state.activeUser = { id: otherUser.id, name: otherUser.name || otherUser.id, uid: otherUser.uid };
  state.activeChatId = chatId;
  state.messages = [];
  els.searchUser.value = "";
  renderUsers();
  listenToMessages(chatId);
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
  await chatRef.collection("messages").add({ text: trimmed, senderId: state.currentUserId, senderUid: state.uid, receiverId: state.activeUser.id, createdAt: serverTimestamp() });
  await chatRef.set({ lastMessage: trimmed, updatedAt: serverTimestamp() }, { merge: true });
  els.messageInput.value = "";
  els.sendMessage.disabled = false;
}

async function clearChat() {
  if (!state.activeChatId) return;
  const snap = await db.collection("chats").doc(state.activeChatId).collection("messages").get();
  const batch = db.batch();
  snap.docs.forEach((item) => batch.delete(item.ref));
  batch.set(db.collection("chats").doc(state.activeChatId), { lastMessage: "", updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

els.saveUser.addEventListener("click", () => saveCurrentUser().catch((error) => setStatus(friendlyFirebaseError(error), "error")));
els.currentUser.addEventListener("keydown", (event) => { if (event.key === "Enter") saveCurrentUser().catch((error) => setStatus(friendlyFirebaseError(error), "error")); });
els.searchUser.addEventListener("input", () => searchUser().catch((error) => setStatus(friendlyFirebaseError(error), "error")));
els.composer.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(els.messageInput.value).catch((error) => setStatus(friendlyFirebaseError(error), "error")); });
els.clearChat.addEventListener("click", () => clearChat().catch((error) => setStatus(friendlyFirebaseError(error), "error")));
els.themeToggle.addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; localStorage.setItem(localKey + ":theme", state.theme); renderShell(); });
els.backToList.addEventListener("click", () => {
  state.activeUser = null;
  state.activeChatId = "";
  state.messages = [];
  if (unsubscribeMessages) unsubscribeMessages();
  renderShell();
});

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
