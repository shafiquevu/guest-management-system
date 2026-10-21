"use client";

import { useState } from "react";

type Message = {
  external_message_id: string;
  direction: "inbound" | "outbound" | "unknown";
  body: string;
  message_at: string | null;
  is_read: boolean;
};

type Conversation = {
    guest_name: string;
property_name: string;
check_in: string | null;
check_out: string | null;
  provider: string;
  channel: string;
  external_booking_id: string;
  external_property_id: string;
  messages: Message[];
  message_count: number;
  unread_count: number;
};

export default function Beds24Inbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function loadMessages() {
    setLoading(true);
    setFeedback("Loading messages from Beds24...");

    try {
      const response = await fetch("/api/inbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Could not load messages.");
      }

      if (!Array.isArray(result.conversations)) {
        throw new Error("Invalid inbox response.");
      }

      setConversations(result.conversations);
      setFeedback(
        result.conversations.length
          ? "Messages loaded successfully."
          : "No conversations were returned."
      );
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Could not connect to the server."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bg-slate-100 px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">Beds24 Inbox Preview</h2>
            <p className="mt-2 text-sm text-slate-600">
              Live API data for the booking configured in n8n.
            </p>
          </div>

          <button
            type="button"
            onClick={loadMessages}
            disabled={loading}
            className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Loading..." : "Load Beds24 Messages"}
          </button>
        </div>

        <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Read-only preview. Loading does not mark messages as read.
          Messages stay in page memory and are not saved in browser
          storage or Supabase.
        </p>

        <p role="status" className="my-4 text-sm text-slate-600">
          {feedback}
        </p>

        <div className="space-y-6">
          {conversations.map((conversation) => (
            <article
              key={`${conversation.external_property_id}:${conversation.external_booking_id}`}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <header className="border-b border-slate-200 p-5">
                <h3 className="text-lg font-semibold">
                 {conversation.guest_name} · {conversation.property_name}
                </h3>

                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                  <span>Channel: {conversation.channel}</span>
                  <span>Booking: {conversation.external_booking_id}</span>
<span>
  Stay: {conversation.check_in ?? "Unknown"} to{" "}
  {conversation.check_out ?? "Unknown"}
</span>
                  <span>
                    Property: {conversation.external_property_id}
                  </span>
                  <span>{conversation.message_count} messages</span>
                  <span>{conversation.unread_count} unread guest messages</span>
                </div>
              </header>

              <div className="flex max-h-[600px] flex-col gap-4 overflow-y-auto p-5">
                {conversation.messages.map((message) => (
                  <div
                    key={message.external_message_id}
                    className={`max-w-[95%] rounded-2xl p-4 sm:max-w-[75%] ${
                      message.direction === "outbound"
                        ? "self-end bg-blue-600 text-white"
                        : message.direction === "inbound"
                          ? "self-start bg-slate-100 text-slate-900"
                          : "self-start border border-amber-200 bg-amber-50 text-slate-900"
                    }`}
                  >
                    <p className="mb-2 text-xs font-semibold opacity-75">
                      {message.direction === "outbound"
                        ? "Host"
                        : message.direction === "inbound"
                          ? "Guest"
                          : "Unknown sender"}
                    </p>

                    <p className="whitespace-pre-wrap break-words text-sm leading-6">
                      {message.body || "[No text content]"}
                    </p>

                    <p className="mt-2 text-xs opacity-70">
                      {message.message_at
                        ? new Date(message.message_at).toLocaleString(
                            "en-GB"
                          )
                        : "Time unavailable"}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}