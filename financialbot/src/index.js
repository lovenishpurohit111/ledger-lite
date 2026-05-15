const VERSION = "financialbot-debug-2026-05-15-progress-images";

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response(VERSION, { status: 200 });
    }

    if (request.method !== "POST") return ok();

    try {
      const update = await request.json();
      console.log("incoming update", JSON.stringify(update));

      const message = update.message || update.edited_message;
      const chatId = message?.chat?.id;
      const messageText = message?.text;

      if (!chatId) {
        console.error("missing chat id", JSON.stringify(update));
        return ok();
      }

      if (typeof messageText === "string" && messageText.trim()) {
        await sendTelegram(env, "sendMessage", {
          chat_id: chatId,
          text: `You said: ${messageText.trim()}`
        });
        return ok();
      }

      const upload = getSupportedUpload(message);
      if (!upload) {
        await sendTelegram(env, "sendMessage", {
          chat_id: chatId,
          text: "Please upload a PDF or clear image of a financial statement."
        });
        return ok();
      }

      await sendTelegram(env, "sendMessage", {
        chat_id: chatId,
        text: upload.kind === "photo"
          ? "Processing your financial statement... For best Excel quality, send screenshots as a file/document instead of a compressed photo."
          : "Processing your financial statement..."
      });

      const inputs = {
        chat_id: String(chatId),
        file_id: upload.file_id,
        file_name: upload.file_name,
        reply_to_message_id: String(message.message_id || "")
      };

      const dispatch = await dispatchWorkflow(env, inputs);
      if (!dispatch.ok) {
        const body = await dispatch.text();
        console.error("github dispatch failed", dispatch.status, body.slice(0, 500));
        await sendTelegram(env, "sendMessage", {
          chat_id: chatId,
          text: "Could not start conversion. Please try again later."
        });
      } else {
        console.log("github dispatch queued", JSON.stringify(inputs));
      }

      return ok();
    } catch (error) {
      console.error("worker error", error?.stack || String(error));
      return ok();
    }
  }
};

function ok() {
  return new Response("OK", { status: 200 });
}

function getSupportedUpload(message) {
  const document = message?.document;
  if (isSupportedDocument(document)) {
    return {
      file_id: document.file_id,
      file_name: document.file_name || defaultName(document.mime_type),
      kind: "document"
    };
  }

  const photo = Array.isArray(message?.photo) ? message.photo.at(-1) : null;
  if (photo?.file_id) {
    return {
      file_id: photo.file_id,
      file_name: "financial-statement.jpg",
      kind: "photo"
    };
  }

  return null;
}

function isSupportedDocument(document) {
  if (!document?.file_id) return false;
  const fileName = String(document.file_name || "").toLowerCase();
  const mime = String(document.mime_type || "").toLowerCase();

  return (
    mime === "application/pdf" ||
    mime === "image/jpeg" ||
    mime === "image/png" ||
    mime === "image/webp" ||
    fileName.endsWith(".pdf") ||
    fileName.endsWith(".jpg") ||
    fileName.endsWith(".jpeg") ||
    fileName.endsWith(".png") ||
    fileName.endsWith(".webp")
  );
}

function defaultName(mime) {
  if (mime === "application/pdf") return "financial-statement.pdf";
  if (mime === "image/png") return "financial-statement.png";
  if (mime === "image/webp") return "financial-statement.webp";
  return "financial-statement.jpg";
}

async function sendTelegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.error("missing TELEGRAM_BOT_TOKEN");
    return new Response("missing token", { status: 500 });
  }

  const url = new URL("https://api.telegram.org");
  url.pathname = `/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const body = await res.text();

  if (!res.ok) {
    console.error("telegram api failed", res.status, body.slice(0, 500));
  } else {
    console.log("telegram api ok", res.status, body.slice(0, 300));
  }

  return res;
}

async function dispatchWorkflow(env, inputs) {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;

  return fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "financialbot-worker",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      ref: env.GITHUB_REF || "main",
      inputs
    })
  });
}
