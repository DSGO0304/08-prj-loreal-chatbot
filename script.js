// ========= CONFIG =========
const WORKER_URL = "https://shiny-moon-5e30.dsofiagomezo.workers.dev/";

// ---- SYSTEM PROMPT (L’Oréal-only) ----
const SYSTEM_PROMPT = `
You are "L’Oréal Beauty Chat"—an assistant that ONLY answers questions about
L’Oréal products, beauty routines, and recommendations (skincare, haircare,
makeup, suncare, fragrance). If asked unrelated topics, politely refuse and
say you can only help with L’Oréal beauty questions.

Personalize by asking for skin/hair type, concerns, climate, fragrance
preferences, and budget. Give concise, step-by-step guidance and mention
L’Oréal lines (e.g., Revitalift, Elvive, Infallible) when helpful. No medical claims.
`;

// ========= LIGHT MEMORY (persisted) =========
const MEMORY_KEY = "loreal_profile_v1";
function loadProfile() {
  try {
    return (
      JSON.parse(localStorage.getItem(MEMORY_KEY)) || {
        name: null,
        lastQuestions: [],
      }
    );
  } catch {
    return { name: null, lastQuestions: [] };
  }
}
function saveProfile(p) {
  localStorage.setItem(MEMORY_KEY, JSON.stringify(p));
}
const profile = loadProfile();

// ========= DOM =========
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const lastQEl = document.getElementById("lastQuestion");

// ========= CONVERSATION STATE =========
const messages = [{ role: "system", content: SYSTEM_PROMPT }];

// Greeting
addMessage(
  "👋 Hi! I’m your L’Oréal beauty assistant. Ask me about products or routines and I’ll tailor suggestions for you.",
  "bot"
);

// ========= EVENTS =========
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const userText = userInput.value.trim();
  if (!userText) return;

  // Prevent sending while offline
  if (!navigator.onLine) {
    addMessage(
      "⚠️ You’re offline. Please reconnect before sending messages.",
      "bot"
    );
    setComposerEnabled(true);
    return;
  }

  // Update banner & UI
  if (lastQEl) lastQEl.textContent = `Your last question: “${userText}”`;
  addMessage(renderWithNameChip(profile.name, userText), "user");

  // Composer off while fetching
  userInput.value = "";
  setComposerEnabled(false);

  // Update memory (detect name)
  maybeCaptureName(userText);

  // Track last questions (max 5)
  if (userText) {
    profile.lastQuestions.unshift(userText);
    profile.lastQuestions = profile.lastQuestions.slice(0, 5);
    saveProfile(profile);
  }

  // Build context system note (lightweight, per turn)
  const contextNote = makeContextNote(profile);
  const turnMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "system", content: contextNote },
    ...messages.filter((m) => m.role !== "system"), // keep prior user/assistant turns
    { role: "user", content: userText },
  ];

  try {
    // Call Worker → OpenAI
    const resp = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: turnMessages }),
    });

    const raw = await resp.text();
    // DEVTOOLS: inspect the exact raw response returned by the Worker
    console.log("Worker raw:", raw);

    if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}: ${raw}`);

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Non-JSON from worker: ${raw}`);
    }

    const botText =
      data.reply ??
      data.choices?.[0]?.message?.content ??
      "Sorry—no response was returned.";

    addMessage(botText, "bot");

    // Persist the canonical conversation (without the per-turn context note)
    messages.push({ role: "user", content: userText });
    messages.push({ role: "assistant", content: botText });
  } catch (err) {
    console.error(err);
    addMessage(`⚠️ <strong>Error:</strong> ${sanitize(err.message)}`, "bot");
  } finally {
    setComposerEnabled(true);
  }
});

// ========= ONLINE / OFFLINE HANDLING =========
// Notify the user when connectivity changes
window.addEventListener("online", () => addMessage("✅ Back online.", "bot"));
window.addEventListener("offline", () =>
  addMessage("⚠️ You are offline. I’ll try again when you reconnect.", "bot")
);

// ========= HELPERS =========
function maybeCaptureName(text) {
  // capture patterns: "my name is Ana", "me llamo Ana", "soy Ana"
  const m =
    text.match(/\bmy name is\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,40})\b/i) ||
    text.match(/\bme llamo\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,40})\b/i) ||
    text.match(/^\s*(?:soy|i am)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ' -]{2,40})\b/i);
  if (m && m[1]) {
    profile.name = capitalizeName(m[1].trim());
    saveProfile(profile);
    addMessage(
      `Nice to meet you, <strong>${sanitize(
        profile.name
      )}</strong>! I’ll remember your name for this chat.`,
      "bot"
    );
  }
}

function makeContextNote(p) {
  const namePart = p.name ? `User name: ${p.name}.` : "";
  const lastQPart = p.lastQuestions.length
    ? `Recent questions: ${p.lastQuestions.map((q) => `"${q}"`).join(", ")}.`
    : "";
  return `Context note for assistant: ${namePart} ${lastQPart}`.trim();
}

function renderWithNameChip(name, text) {
  return name
    ? `<span class="name-chip">${sanitize(name)}</span>\n${sanitize(text)}`
    : sanitize(text);
}

function addMessage(html, who = "bot") {
  const div = document.createElement("div");
  div.className = `msg ${who}`;
  div.innerHTML = html;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function setComposerEnabled(enabled) {
  userInput.disabled = !enabled;
  const btn = document.getElementById("sendBtn");
  if (btn) btn.disabled = !enabled;
  if (enabled) userInput.focus();
}

function sanitize(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;strong&gt;/g, "<strong>")
    .replace(/&lt;\/strong&gt;/g, "</strong>");
}

function capitalizeName(n) {
  return n
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
