// Sends the notes widget's content to a Notesnook account via its Inbox API
// (https://help.notesnook.com/inbox-api/getting-started). The inbox key is
// per-account, created from Notesnook's own Settings > Inbox screen -- this
// extension only ever POSTs to the fixed inbox.notesnook.com endpoint with it.

const INBOX_URL = "https://inbox.notesnook.com/";

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Plain textarea content -> minimal HTML, since the Inbox API only accepts
// content.type "html". Blank lines become paragraph breaks, single line
// breaks become <br>, so the note reads the same as it did in the textarea.
function textToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// The API requires a non-empty title -- it does not fill one in on its own --
// so this stands in for "no title" with the current local date and time.
export function defaultNoteTitle(date = new Date()) {
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export async function sendNoteToNotesnook(apiKey, text, tagId = null) {
  const body = {
    title: defaultNoteTitle(),
    type: "note",
    source: "nord-newtab",
    version: 1,
    content: { type: "html", data: textToHtml(text) },
    ...(tagId ? { tagIds: [tagId] } : {}),
  };

  let res;
  try {
    res = await fetch(INBOX_URL, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error("Could not reach Notesnook's inbox service.");
  }
  if (res.status === 401 || res.status === 403) throw new Error("Notesnook rejected the API key. Check it in settings.");
  if (!res.ok) throw new Error(`Notesnook returned ${res.status} ${res.statusText}.`);
}
