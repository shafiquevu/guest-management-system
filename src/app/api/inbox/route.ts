import "server-only";

type InboxMessage = {
  external_message_id: string;
  direction: "inbound" | "outbound" | "unknown";
  body: string;
  message_at: string | null;
  is_read: boolean;
};

function isMessage(value: unknown): value is InboxMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;

  return (
    typeof message.external_message_id === "string" &&
    ["inbound", "outbound", "unknown"].includes(
      String(message.direction)
    ) &&
    typeof message.body === "string" &&
    (message.message_at === null ||
      typeof message.message_at === "string") &&
    typeof message.is_read === "boolean"
  );
}

export async function POST(request: Request) {
  const responseHeaders = {
    "Cache-Control": "no-store",
  };

  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { error: "This inbox preview is available only in development." },
      { status: 403, headers: responseHeaders }
    );
  }

  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json(
      { error: "Invalid origin." },
      { status: 403, headers: responseHeaders }
    );
  }

  const webhookUrl = process.env.N8N_BEDS24_INBOX_WEBHOOK_URL;
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    return Response.json(
      { error: "The Beds24 inbox connection is not configured." },
      { status: 500, headers: responseHeaders }
    );
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BurkyFlow-Secret": webhookSecret,
      },
      body: JSON.stringify({ action: "read_inbox" }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return Response.json(
        {
          error: `n8n returned HTTP ${response.status}. Check the inbox webhook listener and credentials.`,
        },
        { status: 502, headers: responseHeaders }
      );
    }

    const responseText = await response.text();

let result;

try {
  result = JSON.parse(responseText);
} catch {
  return Response.json(
    {
      error: `Invalid JSON response. Length: ${responseText.length}. Content-Type: ${response.headers.get("content-type") ?? "unknown"}.`,
    },
    { status: 502, headers: responseHeaders }
  );
}

    if (!Array.isArray(result?.conversations)) {
      throw new Error("Invalid conversations response.");
    }

    const conversations = result.conversations.map((value: unknown) => {
      if (!value || typeof value !== "object") {
        throw new Error("Invalid conversation.");
      }

      const conversation = value as Record<string, unknown>;

      if (
        typeof conversation.external_booking_id !== "string" ||
        typeof conversation.external_property_id !== "string" ||
        typeof conversation.channel !== "string" ||
        !Array.isArray(conversation.messages) ||
        !conversation.messages.every(isMessage)
      ) {
        throw new Error("Invalid conversation fields.");
      }

      return {
        provider: "beds24",
        guest_name:
  typeof conversation.guest_name === "string"
    ? conversation.guest_name
    : "Guest",
property_name:
  typeof conversation.property_name === "string"
    ? conversation.property_name
    : "Property",
check_in:
  typeof conversation.check_in === "string"
    ? conversation.check_in
    : null,
check_out:
  typeof conversation.check_out === "string"
    ? conversation.check_out
    : null,
        channel: conversation.channel,
        external_booking_id: conversation.external_booking_id,
        external_property_id: conversation.external_property_id,
        messages: conversation.messages,
        message_count: conversation.messages.length,
        unread_count: conversation.messages.filter(
          (message: InboxMessage) =>
            message.direction === "inbound" && !message.is_read
        ).length,
      };
    });

    return Response.json(
      { conversations },
      { headers: responseHeaders }
    );
  } catch (error) {
    const knownErrors = [
      "Invalid conversations response.",
      "Invalid conversation.",
      "Invalid conversation fields.",
    ];

    const detail =
      error instanceof SyntaxError
        ? "n8n returned a response that is not valid JSON."
        : error instanceof Error && knownErrors.includes(error.message)
          ? error.message
          : "The request to n8n failed or timed out.";

    return Response.json(
      { error: detail },
      { status: 502, headers: responseHeaders }
    );
  }
}