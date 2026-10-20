import "server-only";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json(
      { error: "This demo endpoint is available only in development." },
      { status: 403 }
    );
  }

  const origin = request.headers.get("origin");

  if (origin !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid origin." }, { status: 403 });
  }

  const webhookUrl = process.env.N8N_GUEST_MESSAGE_WEBHOOK_URL;
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;

  if (!webhookUrl || !webhookSecret) {
    return Response.json(
      { error: "The n8n connection is not configured." },
      { status: 500 }
    );
  }

  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON request." },
      { status: 400 }
    );
  }

  if (!input || typeof input !== "object") {
    return Response.json(
      { error: "A message is required." },
      { status: 400 }
    );
  }

  const data = input as Record<string, unknown>;

  if (
    typeof data.message !== "string" ||
    !data.message.trim() ||
    data.message.length > 5000
  ) {
    return Response.json(
      { error: "Enter a message between 1 and 5000 characters." },
      { status: 400 }
    );
  }

  const guestName =
    typeof data.guest_name === "string"
      ? data.guest_name.trim().slice(0, 200) || "Test Guest"
      : "Test Guest";

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BurkyFlow-Secret": webhookSecret,
      },
      body: JSON.stringify({
        event_id: crypto.randomUUID(),
        channel: "demo",
        guest_name: guestName,
        message: data.message.trim(),
        received_at: new Date().toISOString(),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      return Response.json(
        {
          error: `n8n returned HTTP ${response.status}. Check the webhook listener and credentials.`,
        },
        { status: 502 }
      );
    }

    const task = await response.json();

    if (
      !task ||
      typeof task.title !== "string" ||
      typeof task.organization_id !== "string" ||
      typeof task.description !== "string" ||
      typeof task.category !== "string" ||
      task.priority !== "normal" ||
      task.status !== "open"
    ) {
      return Response.json(
        { error: "n8n did not return a valid task record." },
        { status: 502 }
      );
    }

    return Response.json({
      task: {
        id: crypto.randomUUID(),
        organization_id: task.organization_id,
        title: task.title,
        description: task.description,
        category: task.category,
        priority: task.priority,
        status: task.status,
      },
      persisted: false,
    });
  } catch {
    return Response.json(
      {
        error:
          "Could not read a task response from n8n. Check the connection, test listener, and response settings.",
      },
      { status: 502 }
    );
  }
}