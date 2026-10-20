"use client";

import { useState } from "react";

type Channel = "Airbnb" | "Booking.com" | "WhatsApp" | "Gmail";

type Message = {
  id: string;
  direction: "incoming" | "outgoing";
  body: string;
  time: string;
};

type Conversation = {
  id: string;
  guest: string;
  property: string;
  channel: Channel;
  reservation: string;
  stay: string;
  status: "Open" | "Resolved";
  unread: boolean;
  messages: Message[];
};

const initialConversations: Conversation[] = [
  {
    id: "conversation-1",
    guest: "Sarah Wilson",
    property: "City Centre Apartment",
    channel: "Airbnb",
    reservation: "DEMO-1001",
    stay: "20–23 Oct 2026",
    status: "Open",
    unread: true,
    messages: [
      {
        id: "message-1",
        direction: "incoming",
        body: "Hi! Could you please share the check-in instructions?",
        time: "10:30",
      },
    ],
  },
  {
    id: "conversation-2",
    guest: "James Carter",
    property: "Riverside Studio",
    channel: "Booking.com",
    reservation: "DEMO-1002",
    stay: "21–24 Oct 2026",
    status: "Open",
    unread: true,
    messages: [
      {
        id: "message-2",
        direction: "incoming",
        body: "Is parking available at the property?",
        time: "10:15",
      },
    ],
  },
  {
    id: "conversation-3",
    guest: "Aisha Ahmed",
    property: "Garden View Flat",
    channel: "WhatsApp",
    reservation: "DEMO-1003",
    stay: "19–22 Oct 2026",
    status: "Open",
    unread: false,
    messages: [
      {
        id: "message-3",
        direction: "incoming",
        body: "The Wi-Fi is not connecting. Can someone help?",
        time: "09:50",
      },
    ],
  },
  {
    id: "conversation-4",
    guest: "Daniel Brown",
    property: "City Centre Apartment",
    channel: "Gmail",
    reservation: "DEMO-1004",
    stay: "25–28 Oct 2026",
    status: "Open",
    unread: false,
    messages: [
      {
        id: "message-4",
        direction: "incoming",
        body: "Could you confirm the check-out time for my booking?",
        time: "09:20",
      },
    ],
  },
];

const channels: Channel[] = [
  "Airbnb",
  "Booking.com",
  "WhatsApp",
  "Gmail",
];

export default function GuestInbox() {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState("conversation-1");
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState("All channels");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const filteredConversations = conversations.filter((conversation) => {
    const matchesChannel =
      channel === "All channels" || conversation.channel === channel;

    const searchableText =
      `${conversation.guest} ${conversation.property} ${conversation.reservation}`;

    return (
      matchesChannel &&
      searchableText.toLowerCase().includes(search.toLowerCase())
    );
  });

  const selected = filteredConversations.find(
    (conversation) => conversation.id === selectedId
  );

  const draft = selected ? drafts[selected.id] ?? "" : "";

  function openConversation(id: string) {
    setSelectedId(id);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === id
          ? { ...conversation, unread: false }
          : conversation
      )
    );
  }

  function addDemoReply() {
    if (!selected || selected.status === "Resolved" || !draft.trim()) return;

    const conversationId = selected.id;

    const message: Message = {
      id: crypto.randomUUID(),
      direction: "outgoing",
      body: draft.trim(),
      time: new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              unread: false,
              messages: [...conversation.messages, message],
            }
          : conversation
      )
    );

    setDrafts((current) => ({ ...current, [conversationId]: "" }));
  }

  function toggleStatus() {
    if (!selected) return;

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === selected.id
          ? {
              ...conversation,
              status:
                conversation.status === "Open" ? "Resolved" : "Open",
            }
          : conversation
      )
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">
              Guest Operations
            </p>
            <h1 className="mt-1 text-2xl font-bold">BurkyFlow Inbox</h1>
          </div>

          <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900">
            Demo Mode
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Sample data only. Replies stay in this browser session and are
          not sent to guests or saved to Supabase. Refreshing resets the demo.
        </p>

        <div className="grid min-h-[650px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[320px_1fr]">
          <aside className="border-b border-slate-200 lg:border-r lg:border-b-0">
            <div className="space-y-3 border-b border-slate-200 p-4">
              <h2 className="text-lg font-semibold">Conversations</h2>

              <label className="block">
                <span className="sr-only">Search conversations</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search guest, property or booking"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="sr-only">Filter by channel</span>
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option>All channels</option>
                  {channels.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="max-h-[420px] overflow-y-auto lg:max-h-[650px]">
              {filteredConversations.length === 0 && (
                <p className="p-5 text-sm text-slate-500">
                  No conversations found.
                </p>
              )}

              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => openConversation(conversation.id)}
                  aria-pressed={selectedId === conversation.id}
                  className={`w-full border-b border-slate-100 p-4 text-left transition ${
                    selectedId === conversation.id
                      ? "bg-blue-50"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{conversation.guest}</span>
                    {conversation.unread && (
                      <span
                        aria-label="Unread"
                        className="h-2 w-2 rounded-full bg-blue-600"
                      />
                    )}
                  </div>

                  <p className="mt-1 text-xs text-slate-500">
                    {conversation.property}
                  </p>

                  <p className="mt-3 truncate text-sm text-slate-600">
                    {conversation.messages[
                      conversation.messages.length - 1
                    ]?.body}
                  </p>

                  <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                    <span className="rounded bg-slate-100 px-2 py-1 text-slate-600">
                      {conversation.channel}
                    </span>
                    <span className="text-slate-500">
                      {conversation.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {selected ? (
            <section className="flex min-w-0 flex-col">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-5">
                <div>
                  <h2 className="text-xl font-semibold">{selected.guest}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {selected.channel} · {selected.property}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={toggleStatus}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                >
                  {selected.status === "Open" ? "Mark Resolved" : "Reopen"}
                </button>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600">
                <span>Booking: {selected.reservation}</span>
                <span>Stay: {selected.stay}</span>
                <span>Status: {selected.status}</span>
              </div>

              <div
                aria-label="Conversation messages"
                className="flex max-h-[480px] flex-1 flex-col gap-4 overflow-y-auto p-5"
              >
                {selected.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[90%] rounded-2xl p-4 sm:max-w-[75%] ${
                      message.direction === "outgoing"
                        ? "self-end bg-blue-600 text-white"
                        : "self-start bg-slate-100 text-slate-800"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {message.body}
                    </p>
                    <p className="mt-2 text-xs opacity-70">
                      {message.time}
                      {message.direction === "outgoing" && " · Local demo"}
                    </p>
                  </div>
                ))}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  addDemoReply();
                }}
                className="mt-auto border-t border-slate-200 p-5"
              >
                <label
                  htmlFor="reply"
                  className="mb-2 block text-sm font-medium"
                >
                  Demo Reply
                </label>

                <textarea
                  id="reply"
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selected.id]: event.target.value,
                    }))
                  }
                  disabled={selected.status === "Resolved"}
                  placeholder={
                    selected.status === "Resolved"
                      ? "Reopen this conversation to reply."
                      : "Type a sample reply..."
                  }
                  rows={3}
                  className="w-full resize-y rounded-xl border border-slate-300 p-3 text-sm disabled:bg-slate-100"
                />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-slate-500">
                    External channels are not connected.
                  </p>

                  <button
                    type="submit"
                    disabled={!draft.trim() || selected.status === "Resolved"}
                    className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    Add Demo Reply
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <section className="flex min-h-64 items-center justify-center p-8 text-center text-slate-500">
              Select a conversation from the list.
            </section>
          )}
        </div>
      </div>
    </main>
  );
}