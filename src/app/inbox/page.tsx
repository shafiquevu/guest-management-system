import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { Inbox } from "@/components/inbox/inbox";

export default function InboxPage() {
  return (
    <AppShell>
      {/* Inbox reads ?c=<id> with useSearchParams, which needs a Suspense boundary. */}
      <Suspense>
        <Inbox />
      </Suspense>
    </AppShell>
  );
}
